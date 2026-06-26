// ═══════════════════════════════════════════════════════════
// Вебхук подтверждения оплаты Т-Банка. Путь: server/routes/payment-webhook.js
//
// Т-Банк присылает POST с результатом платежа и подписью (Token).
// Мы проверяем подпись тем же алгоритмом, что и при Init, и при статусе
// CONFIRMED/AUTHORIZED помечаем заказ в истории как «Оплачен».
// В ответ Т-Банк ждёт ровно текст "OK", иначе будет слать повторы.
//
// NotificationURL задаётся автоматически при Init (origin сайта),
// либо его можно прописать в личном кабинете Т-Бизнес.
// ═══════════════════════════════════════════════════════════

import { genToken } from '../tbank.js';
import { pool } from '../db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const TERMINAL = process.env.TBANK_TERMINAL_KEY;
  const PASSWORD = process.env.TBANK_PASSWORD;
  if (!TERMINAL || !PASSWORD) {
    return res.status(503).send('not_configured');
  }

  try {
    const body = req.body || {};

    // ── Проверка подписи ──
    const check = Object.assign({}, body);
    delete check.Token;
    const expected = genToken(check, PASSWORD);
    if (!body.Token || String(body.Token) !== expected) {
      console.error('Webhook: неверная подпись, OrderId=', body.OrderId);
      return res.status(403).send('bad token');
    }
    if (String(body.TerminalKey) !== String(TERMINAL)) {
      return res.status(403).send('bad terminal');
    }

    // ── Обновление статуса заказа ──
    const status = String(body.Status || '');
    const orderId = String(body.OrderId || '').slice(0, 40);
    if (orderId && (status === 'CONFIRMED' || status === 'AUTHORIZED')) {
      try {
        await pool.query("update user_orders set status = 'Оплачен' where order_num = $1", [orderId]);
      } catch (e) {
        console.error('Webhook DB error:', e);
      }
    }

    // Т-Банк ждёт ровно "OK"
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    // Отвечаем 200, чтобы не провоцировать бесконечные повторы при нашей ошибке.
    return res.status(200).send('OK');
  }
}
