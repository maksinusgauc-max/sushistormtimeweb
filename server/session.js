// ═══════════════════════════════════════════════════════════
// Сессия по cookie (общий модуль). Путь: server/session.js
// Используется в auth-роутах и при записи заказа в историю.
// ═══════════════════════════════════════════════════════════

import { pool } from './db.js';

const COOKIE = 'ss_sid';

export function readSessionToken(req) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq) === COOKIE) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

// Пользователь по cookie-сессии (или null). Минимум полей.
export async function getUserByReq(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const s = await pool.query(
    'select user_id from sessions where token = $1 and expires_at > now()',
    [token]
  );
  if (!s.rows.length) return null;
  const u = await pool.query('select id, name from users where id = $1', [s.rows[0].user_id]);
  return u.rows[0] || null;
}

// Записать заказ в историю, если клиент авторизован. Возвращает true/false.
export async function recordUserOrder(req, order) {
  const user = await getUserByReq(req);
  if (!user) return false;

  const hist = Array.isArray(order.histItems) ? order.histItems.slice(0, 100) : [];
  const itemsText = hist.map(function (h) { return h.name; }).filter(Boolean).join(', ').slice(0, 1000);
  const itemsJson = hist.map(function (h) {
    return { id: parseInt(h.id, 10) || 0, qty: Math.max(1, Math.min(99, parseInt(h.qty, 10) || 1)) };
  });

  await pool.query(
    'insert into user_orders (user_id, order_num, total, items_text, items_json, status) ' +
    'values ($1,$2,$3,$4,$5,$6)',
    [
      user.id,
      String(order.num || '').slice(0, 40),
      Math.max(0, parseInt(order.total, 10) || 0),
      itemsText,
      JSON.stringify(itemsJson),
      String(order.status || 'Принят').slice(0, 40),
    ]
  );
  return true;
}
