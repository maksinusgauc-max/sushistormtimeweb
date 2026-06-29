// ═══════════════════════════════════════════════════════════
// Вебхук оплаты Т-Банка. Путь: server/routes/payment-webhook.js
//
// При подтверждённой оплате (CONFIRMED/AUTHORIZED) достаёт отложенный
// заказ из pending_orders и ТОЛЬКО ТОГДА отправляет его во ФронтПад
// и пишет в историю клиента. Не оплачен — в кассу не уходит.
//
// Защита от повторных уведомлений: заказ «захватывается» атомарно
// (status pending → processing), повторный вызов уже ничего не делает.
// ═══════════════════════════════════════════════════════════

import { genToken } from '../tbank.js';
import { pool } from '../db.js';
import { submitToFrontpad } from '../frontpad.js';
import { recordOrderForUser } from '../session.js';

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

    const status = String(body.Status || '');
    const orderId = String(body.OrderId || '').slice(0, 64);

    // Нас интересует только успешная оплата отложенного заказа.
    if (orderId && (status === 'CONFIRMED' || status === 'AUTHORIZED')) {
      // Атомарно «захватываем» заказ: pending → processing (защита от повторов).
      const claim = await pool.query(
        "update pending_orders set status = 'processing' where id = $1 and status = 'pending' returning user_id, payload",
        [orderId]
      );

      if (claim.rows.length) {
        const row = claim.rows[0];
        const p = row.payload || {};

        const fp = await submitToFrontpad({
          name: p.name, phone: p.phone, street: p.street,
          home: p.home, apart: p.apart, pod: p.pod, et: p.et,
          descr: p.descr, items: p.items,
        });

        if (fp.ok) {
          await pool.query(
            "update pending_orders set status = 'sent', fp_order = $2 where id = $1",
            [orderId, String(fp.order_number || '')]
          );
          // История клиента (если был авторизован при оформлении).
          if (row.user_id) {
            try {
              await recordOrderForUser(row.user_id, {
                num: fp.order_number,
                total: p.total,
                histItems: p.histItems,
                status: 'Оплачен',
              });
            } catch (e) {
              console.error('Webhook history error:', e);
            }
          }
        } else {
          // Оплата прошла, но ФронтПад не принял — требуется ручная обработка.
          await pool.query("update pending_orders set status = 'fp_failed' where id = $1", [orderId]);
          console.error('ОПЛАЧЕН, но ФронтПад отклонил заказ', orderId, fp.error);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    return res.status(200).send('OK');
  }
}
