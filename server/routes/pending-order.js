// ═══════════════════════════════════════════════════════════
// Отложенный заказ (онлайн-оплата). Путь: server/routes/pending-order.js
//
// Сохраняет заказ как «ожидает оплаты» и возвращает order_id.
// Во ФронтПад НЕ отправляет — это сделает вебхук после оплаты.
// ═══════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { pool } from '../db.js';
import { rateLimit } from '../ratelimit.js';
import { getUserByReq } from '../session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.FRONTPAD_SECRET) {
    return res.status(500).json({ error: 'Сервер не настроен' });
  }

  try {
    const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    const ip = String(fwd).split(',')[0].trim();
    if (await rateLimit('order:' + ip, 5, 60)) {
      return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
    }

    const b = req.body || {};
    const { name, phone, street, home, apart, pod, et, descr, items, histItems, total } = b;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Слишком много позиций' });
    }
    if (!name || !phone || !street) {
      return res.status(400).json({ error: 'Некорректные данные заказа' });
    }
    if (!/^[\d\s+\-()]{10,18}$/.test(String(phone))) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    const user = await getUserByReq(req);
    const id = 'web-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');

    const payload = {
      name: String(name).slice(0, 100),
      phone: String(phone).slice(0, 20),
      street: String(street).slice(0, 150),
      home: home ? String(home).slice(0, 20) : '',
      apart: apart ? String(apart).slice(0, 20) : '',
      pod: pod ? String(pod).slice(0, 10) : '',
      et: et ? String(et).slice(0, 10) : '',
      descr: descr ? String(descr).slice(0, 500) : '',
      items: items.slice(0, 50).map(function (it) {
        return { article: String(it.article), qty: Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1)) };
      }),
      histItems: Array.isArray(histItems) ? histItems.slice(0, 100) : [],
      total: Math.max(0, parseInt(total, 10) || 0),
    };

    await pool.query(
      'insert into pending_orders (id, user_id, payload, status) values ($1,$2,$3,$4)',
      [id, user ? user.id : null, JSON.stringify(payload), 'pending']
    );

    return res.status(200).json({ ok: true, order_id: id });
  } catch (e) {
    console.error('Pending order error:', e);
    return res.status(500).json({ error: 'Не удалось подготовить заказ. Попробуйте ещё раз.' });
  }
}
