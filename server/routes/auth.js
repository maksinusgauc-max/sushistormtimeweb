// ═══════════════════════════════════════════════════════════
// Аккаунты на сервере. Путь: server/routes/auth.js
//
// Эндпоинты (монтируются в server.js на /api):
//   POST /api/auth/register   — регистрация + вход
//   POST /api/auth/login      — вход
//   POST /api/auth/logout     — выход
//   GET  /api/auth/me         — кто я (по cookie) + история заказов
//   PATCH /api/account/profile  — имя/телефон
//   POST  /api/account/password — смена пароля
//   PUT   /api/account/address  — сохранить адрес
//   POST  /api/account/orders   — добавить заказ в историю
//
// Сессия — в httpOnly-cookie 'ss_sid' (токен недоступен из JS).
// Пароли — scrypt (встроенный в Node), сравнение за постоянное время.
// ═══════════════════════════════════════════════════════════

import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { rateLimit } from '../ratelimit.js';

const router = express.Router();

const COOKIE = 'ss_sid';
const SESSION_DAYS = 30;

// ── Хеширование пароля (scrypt) ──
function scrypt(password, salt) {
  return new Promise(function (resolve, reject) {
    crypto.scrypt(password, salt, 64, function (err, dk) {
      if (err) reject(err); else resolve(dk.toString('hex'));
    });
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt);
  return { salt: salt, hash: hash };
}
async function verifyPassword(password, salt, hash) {
  const calc = await scrypt(password, salt);
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Валидация ──
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')); }
function validPhone(p) { return /^[\d\s+\-()]{10,18}$/.test(String(p || '')); }
function strongPass(p) {
  p = String(p || '');
  return p.length >= 8 && /[a-zA-Zа-яА-Я]/.test(p) && /\d/.test(p);
}

// ── Cookie ──
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}
function isSecure(req) {
  return req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}
function setSessionCookie(req, res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isSecure(req),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}
function clearSessionCookie(req, res) {
  res.cookie(COOKIE, '', { httpOnly: true, secure: isSecure(req), sameSite: 'lax', path: '/', maxAge: 0 });
}

// ── Создание сессии ──
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'insert into sessions (token, user_id, expires_at) values ($1, $2, $3)',
    [token, userId, expires]
  );
  return token;
}

// ── Текущий пользователь по cookie (или null) ──
async function getUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = await pool.query(
    'select user_id from sessions where token = $1 and expires_at > now()',
    [token]
  );
  if (!s.rows.length) return null;
  const u = await pool.query('select * from users where id = $1', [s.rows[0].user_id]);
  return u.rows[0] || null;
}

// ── Форматирование даты заказа (Москва) ──
const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

// ── Публичная форма пользователя (без хеша пароля) ──
async function publicUser(user) {
  const o = await pool.query(
    'select order_num, total, items_text, items_json, status, created_at ' +
    'from user_orders where user_id = $1 order by created_at desc limit 50',
    [user.id]
  );
  const orders = o.rows.map(function (r) {
    return {
      num: r.order_num,
      date: dateFmt.format(new Date(r.created_at)),
      items: r.items_text || '',
      total: r.total,
      status: r.status,
      itemIds: r.items_json || [],
    };
  });
  return {
    name: user.name,
    phone: user.phone || '',
    email: user.email,
    address: user.address || null,
    orders: orders,
  };
}

// ── IP клиента (за прокси Timeweb) ──
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  return String(fwd).split(',')[0].trim();
}

// ═══════════════════ AUTH ═══════════════════

router.post('/auth/register', async function (req, res) {
  if (await rateLimit('auth:' + clientIp(req), 10, 60)) return res.status(429).json({ error: 'too_many' });
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const pass = String(body.pass || '');

    if (name.length < 2) return res.status(400).json({ error: 'bad_name' });
    if (!validEmail(email)) return res.status(400).json({ error: 'bad_email' });
    if (phone && !validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });
    if (!strongPass(pass)) return res.status(400).json({ error: 'weak_pass' });

    const exists = await pool.query('select 1 from users where email = $1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'email_taken' });

    const h = await hashPassword(pass);
    const ins = await pool.query(
      'insert into users (email, name, phone, pass_hash, pass_salt) values ($1,$2,$3,$4,$5) returning *',
      [email, name.slice(0, 50), phone.slice(0, 18), h.hash, h.salt]
    );
    const user = ins.rows[0];
    const token = await createSession(user.id);
    setSessionCookie(req, res, token);
    return res.status(200).json({ ok: true, user: await publicUser(user) });
  } catch (e) {
    console.error('register error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/auth/login', async function (req, res) {
  if (await rateLimit('auth:' + clientIp(req), 10, 60)) return res.status(429).json({ error: 'too_many' });
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const pass = String(body.pass || '');
    if (!email || !pass) return res.status(400).json({ error: 'bad_input' });

    const u = await pool.query('select * from users where email = $1', [email]);
    const user = u.rows[0];
    // Проверяем пароль даже при отсутствии юзера — не сливаем, есть ли такой email.
    const okPass = user
      ? await verifyPassword(pass, user.pass_salt, user.pass_hash)
      : await verifyPassword(pass, 'x', '00');
    if (!user || !okPass) return res.status(401).json({ error: 'bad_credentials' });

    const token = await createSession(user.id);
    setSessionCookie(req, res, token);
    return res.status(200).json({ ok: true, user: await publicUser(user) });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/auth/logout', async function (req, res) {
  try {
    const token = readCookie(req, COOKIE);
    if (token) await pool.query('delete from sessions where token = $1', [token]);
    clearSessionCookie(req, res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('logout error:', e);
    clearSessionCookie(req, res);
    return res.status(200).json({ ok: true });
  }
});

router.get('/auth/me', async function (req, res) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(200).json({ user: null });
    return res.status(200).json({ user: await publicUser(user) });
  } catch (e) {
    console.error('me error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ═══════════════════ ACCOUNT (требуют входа) ═══════════════════

router.patch('/account/profile', async function (req, res) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'bad_name' });
    if (phone && !validPhone(phone)) return res.status(400).json({ error: 'bad_phone' });

    const upd = await pool.query(
      'update users set name=$1, phone=$2, updated_at=now() where id=$3 returning *',
      [name.slice(0, 50), phone.slice(0, 18), user.id]
    );
    return res.status(200).json({ ok: true, user: await publicUser(upd.rows[0]) });
  } catch (e) {
    console.error('profile error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/account/password', async function (req, res) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const body = req.body || {};
    const oldP = String(body.oldPass || '');
    const newP = String(body.newPass || '');

    const okOld = await verifyPassword(oldP, user.pass_salt, user.pass_hash);
    if (!okOld) return res.status(401).json({ error: 'bad_old_pass' });
    if (!strongPass(newP)) return res.status(400).json({ error: 'weak_pass' });

    const h = await hashPassword(newP);
    await pool.query(
      'update users set pass_hash=$1, pass_salt=$2, updated_at=now() where id=$3',
      [h.hash, h.salt, user.id]
    );
    // Выйти со всех остальных устройств: чистим прочие сессии, кроме текущей.
    const token = readCookie(req, COOKIE);
    await pool.query('delete from sessions where user_id=$1 and token <> $2', [user.id, token || '']);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('password error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.put('/account/address', async function (req, res) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const b = req.body || {};
    const address = {
      street: String(b.street || '').slice(0, 150),
      entry: String(b.entry || '').slice(0, 10),
      floor: String(b.floor || '').slice(0, 20),
      note: String(b.note || '').slice(0, 200),
    };
    await pool.query('update users set address=$1, updated_at=now() where id=$2',
      [JSON.stringify(address), user.id]);
    return res.status(200).json({ ok: true, address: address });
  } catch (e) {
    console.error('address error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

router.post('/account/orders', async function (req, res) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const b = req.body || {};
    const itemsJson = Array.isArray(b.itemIds)
      ? b.itemIds.slice(0, 100).map(function (x) {
          return { id: parseInt(x.id, 10) || 0, qty: Math.max(1, Math.min(99, parseInt(x.qty, 10) || 1)) };
        })
      : [];
    await pool.query(
      'insert into user_orders (user_id, order_num, total, items_text, items_json, status) ' +
      'values ($1,$2,$3,$4,$5,$6)',
      [
        user.id,
        String(b.num || '').slice(0, 40),
        Math.max(0, parseInt(b.total, 10) || 0),
        String(b.items || '').slice(0, 1000),
        JSON.stringify(itemsJson),
        String(b.status || 'Принят').slice(0, 40),
      ]
    );
    return res.status(200).json({ ok: true, user: await publicUser(user) });
  } catch (e) {
    console.error('orders error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
