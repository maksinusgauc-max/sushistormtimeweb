// ═══════════════════════════════════════════════════════════
// Подпись Т-Банка (Token). Путь: server/tbank.js
// Берём корневые НЕ-объектные параметры + Password, сортируем по ключу,
// склеиваем значения, считаем SHA-256. Используется при Init и при
// проверке вебхука-уведомления.
// ═══════════════════════════════════════════════════════════

import crypto from 'node:crypto';

export function genToken(params, password) {
  const data = Object.assign({}, params, { Password: password });
  const keys = Object.keys(data).filter(function (k) {
    const v = data[k];
    return v !== undefined && v !== null && typeof v !== 'object';
  }).sort();
  const concat = keys.map(function (k) { return String(data[k]); }).join('');
  return crypto.createHash('sha256').update(concat, 'utf8').digest('hex');
}
