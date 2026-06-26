// ═══════════════════════════════════════════════════════════
// Точка входа: Express-сервер «Суши Шторм».
// Путь: server/server.js  (запуск: npm start → node server/server.js)
//
// Раздаёт статику фронта из корня репозитория (index.html, menu.js,
// kiosk.html, admin.html, site-admin.html, privacy.html, img/ …)
// и обслуживает /api/* теми же путями, что были на Vercel.
// ═══════════════════════════════════════════════════════════

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import menuRouter from './routes/menu.js';
import authRouter from './routes/auth.js';
import orderHandler from './routes/order.js';
import paymentHandler from './routes/payment.js';
import paymentWebhookHandler from './routes/payment-webhook.js';
import chatHandler from './routes/chat.js';
import adminLoginHandler from './routes/admin-login.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // корень репозитория = фронт

const app = express();
app.set('trust proxy', true);               // x-forwarded-for от прокси Timeweb
app.use(express.json({ limit: '1mb' }));

// ── API (пути совпадают с прежними на Vercel) ──
app.use('/api', authRouter);                // /api/auth/*, /api/account/*
app.use('/api/menu', menuRouter);           // GET + PATCH
app.post('/api/order', orderHandler);
app.post('/api/payment', paymentHandler);
app.post('/api/payment-webhook', paymentWebhookHandler);
app.post('/api/chat', chatHandler);
app.post('/api/admin-login', adminLoginHandler);

// Любой другой /api/* — 404 (не отдаём в статику и не уводим на index)
app.use('/api', function (req, res) {
  res.status(404).json({ error: 'not_found' });
});

// ── Не отдаём наружу серверный код и служебные файлы ──
app.use(function (req, res, next) {
  if (/^\/(server|sql|node_modules|package(-lock)?\.json|\.[^/]*)(\/|$)/.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

// ── Статика фронта ──
app.use(express.static(ROOT, { extensions: ['html'] }));

// Фолбэк на главную (на случай прямых ссылок без расширения)
app.get('*', function (req, res) {
  res.sendFile(path.join(ROOT, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('Sushi Shtorm server on :' + PORT);
});
