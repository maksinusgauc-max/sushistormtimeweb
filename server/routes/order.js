// ═══════════════════════════════════════════════════════════
// Приём заказа → ФронтПад. Путь: server/routes/order.js
// Используется для оплаты ПРИ ПОЛУЧЕНИИ и для киоска — заказ уходит
// в кассу сразу. Онлайн-оплата идёт через /api/pending-order + вебхук.
// ═══════════════════════════════════════════════════════════

import { rateLimit } from '../ratelimit.js';
import { recordUserOrder } from '../session.js';
import { submitToFrontpad } from '../frontpad.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SECRET = process.env.FRONTPAD_SECRET;
  if (!SECRET) {
    return res.status(500).json({ error: 'Сервер не настроен: нет FRONTPAD_SECRET' });
  }

  try {
    const { source, name, phone, street, home, apart, pod, et, descr, items } = req.body || {};
    const isKiosk = source === 'kiosk';

    if (!isKiosk) {
      const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
      const ip = String(fwd).split(',')[0].trim();
      if (await rateLimit('order:' + ip, 5, 60)) {
        return res.status(429).json({ error: 'Слишком много заказов подряд. Подождите минуту или позвоните: 8 (929) 854-11-44' });
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Слишком много позиций' });
    }
    if (!isKiosk) {
      if (!name || !phone || !street) {
        return res.status(400).json({ error: 'Некорректные данные заказа' });
      }
      if (!/^[\d\s+\-()]{10,18}$/.test(String(phone))) {
        return res.status(400).json({ error: 'Некорректный телефон' });
      }
    } else if (phone && !/^[\d\s+\-()]{10,18}$/.test(String(phone))) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const result = await submitToFrontpad({ name, phone, street, home, apart, pod, et, descr, items });

    if (result.ok) {
      // Запись в историю клиента (если авторизован) — оплата при получении.
      if (!isKiosk) {
        try {
          await recordUserOrder(req, {
            num: result.order_number,
            total: req.body && req.body.total,
            histItems: req.body && req.body.histItems,
            status: 'Принят',
          });
        } catch (e) {
          console.error('history record error:', e);
        }
      }
      return res.status(200).json({ ok: true, order_number: result.order_number });
    }

    return res.status(502).json({ error: 'ФронтПад отклонил заказ', detail: result.error || 'unknown' });
  } catch (e) {
    console.error('Order handler error:', e);
    return res.status(500).json({ error: 'Ошибка сервера, попробуйте позвонить: 8 (929) 854-11-44' });
  }
}
