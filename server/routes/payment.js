// ═══════════════════════════════════════════════════════════
// Онлайн-оплата через Т-Бизнес (Т-Банк). Путь: server/routes/payment.js
// Ключи: TBANK_TERMINAL_KEY, TBANK_PASSWORD.
// Доп. (54-ФЗ, чек): TBANK_TAXATION (по умолч. usn_income), TBANK_VAT (none),
//   TBANK_RECEIPT (по умолч. ВЫКЛ — чек пробивается вручную на терминале).
// Док: https://www.tbank.ru/kassa/dev/payments/ (метод Init + Receipt)
//
// Сумму к оплате сервер сверяет с реальными ценами из таблицы menu:
// нельзя оплатить меньше стоимости блюд. Чек (Receipt) строится из
// настоящих позиций + строки «Доставка и сервисный сбор» на разницу.
// ═══════════════════════════════════════════════════════════

import { genToken } from '../tbank.js';
import { pool } from '../db.js';

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')); }

// Собрать чек 54-ФЗ из реальных цен БД. Возвращает {receipt, subtotalRub} или null.
async function buildReceipt(items, rubTotal, contact) {
  if (!Array.isArray(items) || !items.length) return null;

  const ids = items.map(function (it) { return parseInt(it.id, 10) || 0; }).filter(Boolean);
  if (!ids.length) return null;

  const q = await pool.query('select id, name, price from menu where id = any($1)', [ids]);
  const byId = {};
  q.rows.forEach(function (r) { byId[r.id] = r; });

  const TAX = process.env.TBANK_VAT || 'none';            // ставка НДС позиции
  const TAXATION = process.env.TBANK_TAXATION || 'usn_income';

  const recItems = [];
  let subtotalRub = 0;
  for (const it of items) {
    const id = parseInt(it.id, 10) || 0;
    const row = byId[id];
    if (!row) continue; // позиции нет в БД — пропускаем (на чек не ставим выдумку)
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    const priceRub = Math.max(0, parseInt(row.price, 10) || 0);
    subtotalRub += priceRub * qty;
    recItems.push({
      Name: String(row.name).slice(0, 128),
      Price: priceRub * 100,
      Quantity: qty,
      Amount: priceRub * qty * 100,
      Tax: TAX,
      PaymentMethod: 'full_payment',
      PaymentObject: 'commodity',
    });
  }
  if (!recItems.length) return null;

  // Разница (доставка + сервисный сбор) — отдельной строкой, чтобы сумма чека = сумме оплаты.
  const extrasRub = Math.round(rubTotal) - subtotalRub;
  if (extrasRub > 0) {
    recItems.push({
      Name: 'Доставка и сервисный сбор',
      Price: extrasRub * 100,
      Quantity: 1,
      Amount: extrasRub * 100,
      Tax: TAX,
      PaymentMethod: 'full_payment',
      PaymentObject: 'service',
    });
  }

  const receipt = { Taxation: TAXATION, Items: recItems };
  if (contact.email && validEmail(contact.email)) receipt.Email = String(contact.email).slice(0, 64);
  else if (contact.phone) receipt.Phone = String(contact.phone).slice(0, 20);
  else return null; // без контакта чек не примут

  return { receipt: receipt, subtotalRub: subtotalRub };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TERMINAL = process.env.TBANK_TERMINAL_KEY;
  const PASSWORD = process.env.TBANK_PASSWORD;
  if (!TERMINAL || !PASSWORD) {
    return res.status(503).json({ error: 'not_configured' });
  }

  try {
    const { amount, description, return_url, order_id, items, phone, email } = req.body || {};

    const rub = Number(amount);
    if (!rub || rub <= 0 || rub > 1000000) {
      return res.status(400).json({ error: 'bad_amount' });
    }
    if (!return_url || !/^https?:\/\//.test(String(return_url))) {
      return res.status(400).json({ error: 'bad_return_url' });
    }
    const kopecks = Math.round(rub * 100);

    const successUrl = String(return_url);
    const failUrl = successUrl.indexOf('paid=') !== -1
      ? successUrl.split('paid=').join('payfail=')
      : successUrl;

    let notifyUrl = '';
    try { notifyUrl = new URL(successUrl).origin + '/api/payment-webhook'; } catch (e) {}

    // ── Чек 54-ФЗ + сверка суммы с реальными ценами БД (best-effort) ──
    let receipt = null;
    try {
      const built = await buildReceipt(items, rub, { phone: phone, email: email });
      if (built) {
        // Защита от занижения: нельзя платить меньше реальной стоимости блюд.
        if (rub + 0.001 < built.subtotalRub) {
          return res.status(400).json({ error: 'amount_too_low' });
        }
        receipt = built.receipt;
      }
    } catch (e) {
      console.error('Receipt build error (продолжаем без чека):', e);
    }

    const params = {
      TerminalKey: TERMINAL,
      Amount: kopecks,
      OrderId: order_id ? String(order_id).slice(0, 36) : ('ord-' + Date.now()),
      Description: String(description || 'Заказ Суши Шторм').slice(0, 140),
      SuccessURL: successUrl,
      FailURL: failUrl,
    };
    if (notifyUrl) params.NotificationURL = notifyUrl;
    // Token считается ТОЛЬКО по корневым скалярным полям — объект Receipt в него не входит.
    params.Token = genToken(params, PASSWORD);
    // Чек 54-ФЗ отправляем Т-Банку ТОЛЬКО если включён флаг TBANK_RECEIPT.
    // По умолчанию ВЫКЛЮЧЕНО: чек пробивается вручную на терминале и крепится к заказу.
    var receiptOn = ['on', '1', 'true', 'yes'].indexOf(String(process.env.TBANK_RECEIPT || '').toLowerCase()) !== -1;
    if (receipt && receiptOn) params.Receipt = receipt;

    const r = await fetch('https://securepay.tinkoff.ru/v2/Init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await r.json();
    if (data && data.Success && data.PaymentURL) {
      return res.status(200).json({ ok: true, url: data.PaymentURL, payment_id: data.PaymentId });
    }

    console.error('T-Bank error:', data);
    return res.status(502).json({ error: 'tbank_error', detail: (data && (data.Message || data.Details)) || 'unknown' });
  } catch (e) {
    console.error('Payment handler error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
