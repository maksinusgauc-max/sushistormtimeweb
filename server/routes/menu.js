// ═══════════════════════════════════════════════════════════
// Меню сайта через PostgreSQL (бывш. api/menu.js на Supabase).
// Путь: server/routes/menu.js
//
// GET   /api/menu  — публичное чтение меню (для сайта).
// PATCH /api/menu  — правка позиции (цена / наличие / порядок),
//                    только с заголовком x-admin-pass === ADMIN_PASS.
//
// При ошибке БД отдаём 5xx — фронт тихо откатывается на menu.js.
// ═══════════════════════════════════════════════════════════

import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// ── Публичное чтение меню ──
router.get('/', async function (req, res) {
  try {
    const result = await pool.query(
      'select * from menu order by cat asc, sort asc, id asc'
    );
    // короткий кэш на фронте/CDN, чтобы не дёргать БД на каждый заход
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json(result.rows);
  } catch (e) {
    console.error('Menu GET error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// ── Правка позиции (только администратор) ──
router.patch('/', async function (req, res) {
  const ADMIN_PASS = process.env.ADMIN_PASS;
  const pass = req.headers['x-admin-pass'];
  if (!ADMIN_PASS || pass !== ADMIN_PASS) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const body = req.body || {};
    const id = parseInt(body.id, 10);
    if (!id) return res.status(400).json({ error: 'no_id' });

    // собираем динамический UPDATE только из переданных полей
    const sets = [];
    const vals = [];
    let i = 1;
    if (body.price !== undefined) {
      sets.push('price = $' + i++);
      vals.push(Math.max(0, parseInt(body.price, 10) || 0));
    }
    if (body.available !== undefined) {
      sets.push('available = $' + i++);
      vals.push(!!body.available);
    }
    if (body.sort !== undefined) {
      sets.push('sort = $' + i++);
      vals.push(parseInt(body.sort, 10) || 0);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    sets.push('updated_at = now()');
    vals.push(id);
    const sql = 'update menu set ' + sets.join(', ') + ' where id = $' + i + ' returning *';

    const result = await pool.query(sql, vals);
    if (!result.rows.length) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json({ ok: true, row: result.rows[0] });
  } catch (e) {
    console.error('Menu PATCH error:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;
