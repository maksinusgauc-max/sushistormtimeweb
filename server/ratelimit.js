// ═══════════════════════════════════════════════════════════
// Лимиты запросов (rate-limit). Путь: server/ratelimit.js
//
// Если задан REDIS_URL — счётчики живут в Redis (переживают
// перезапуск приложения и общие для всех инстансов).
// Если не задан — откат на счётчики в памяти процесса.
//
// Использование:
//   import { rateLimit } from '../ratelimit.js';
//   const limited = await rateLimit('login:' + ip, 10, 60);
//   if (limited) return res.status(429)...
// ═══════════════════════════════════════════════════════════

import { createClient } from 'redis';

let redis = null;
let redisReady = false;

if (process.env.REDIS_URL) {
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on('error', function (e) {
    redisReady = false;
    console.error('Redis error:', e && e.message ? e.message : e);
  });
  redis.on('ready', function () { redisReady = true; });
  redis.connect().catch(function (e) {
    console.error('Redis connect failed, fallback to memory:', e && e.message ? e.message : e);
  });
}

// ── Откат в память ──
const _mem = new Map();
function memHit(key, max, windowSec) {
  const now = Date.now();
  const winMs = windowSec * 1000;
  const arr = (_mem.get(key) || []).filter(function (t) { return now - t < winMs; });
  arr.push(now);
  _mem.set(key, arr);
  if (_mem.size > 10000) {
    for (const [k, v] of _mem) {
      if (!v.length || now - v[v.length - 1] > winMs) _mem.delete(k);
    }
  }
  return arr.length > max;
}

/**
 * Зафиксировать попытку и сказать, превышен ли лимит.
 * @returns {Promise<boolean>} true = лимит превышен (надо ответить 429)
 */
export async function rateLimit(key, max, windowSec) {
  if (redis && redisReady) {
    try {
      const k = 'rl:' + key;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSec);
      return n > max;
    } catch (e) {
      // Redis отвалился на этом запросе — не блокируем, падаем в память
      return memHit(key, max, windowSec);
    }
  }
  return memHit(key, max, windowSec);
}

export function rateLimitMode() {
  return (redis && redisReady) ? 'redis' : 'memory';
}
