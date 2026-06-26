// ═══════════════════════════════════════════════════════════
// Пул подключений к PostgreSQL (Timeweb Managed PostgreSQL).
// Путь: server/db.js
//
// Подключение задаётся переменными окружения App Platform:
//   DATABASE_URL  — строка подключения целиком (рекомендуется)
//   ИЛИ по частям: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
//   PGSSL=disable — отключить TLS (по умолчанию TLS включён,
//                   у managed-базы Timeweb он нужен)
// ═══════════════════════════════════════════════════════════

import pg from 'pg';
const { Pool } = pg;

// Managed-базы Timeweb работают по TLS. rejectUnauthorized:false —
// чтобы не возиться с CA на старте; для продакшена можно подложить CA
// (ssl: { ca: fs.readFileSync('ca.pem') }).
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl }
  : {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl,
    };

export const pool = new Pool(config);

pool.on('error', function (err) {
  console.error('PG pool error:', err);
});
