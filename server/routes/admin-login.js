// ═══════════════════════════════════════════════════════════
// Вход сотрудника (киоск/админка). Путь: server/routes/admin-login.js
// Пароль: ADMIN_PASS (+ опц. ADMIN_LOGIN, по умолчанию 'admin').
// ═══════════════════════════════════════════════════════════

import { rateLimit } from '../ratelimit.js';

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (!ADMIN_PASS) {
    return res.status(503).json({ error: 'not_configured' });
  }

  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const ip = String(fwd).split(',')[0].trim();
  if (await rateLimit('admin-login:' + ip, 8, 60)) {
    return res.status(429).json({ error: 'too_many' });
  }

  try {
    const { login, pass } = req.body || {};
    const ok =
      safeEqual(String(login || '').toLowerCase(), String(ADMIN_LOGIN).toLowerCase()) &&
      safeEqual(String(pass || ''), ADMIN_PASS);

    await new Promise(function (r) { setTimeout(r, 250); });

    if (ok) return res.status(200).json({ ok: true });
    return res.status(401).json({ ok: false });
  } catch (e) {
    console.error('Admin login error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
