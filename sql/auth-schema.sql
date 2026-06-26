-- ═══════════════════════════════════════════════════════════
-- Аккаунты на сервере: пользователи, история заказов, сессии.
-- Выполнять в базе ПОСЛЕ schema.sql (таблица menu) — один раз.
-- ═══════════════════════════════════════════════════════════

create table if not exists users (
  id          serial primary key,
  email       text unique not null,        -- всегда в нижнем регистре
  name        text not null,
  phone       text,
  pass_hash   text not null,               -- scrypt-хеш (hex)
  pass_salt   text not null,               -- соль (hex)
  address     jsonb,                       -- {street, entry, floor, note}
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists user_orders (
  id          serial primary key,
  user_id     integer not null references users(id) on delete cascade,
  order_num   text,
  total       integer not null default 0,
  items_text  text,                        -- «Калифорния, Филадельфия…» для показа
  items_json  jsonb,                        -- [{id, qty}] для кнопки «Повторить»
  status      text not null default 'Принят',
  created_at  timestamptz not null default now()
);
create index if not exists user_orders_user_idx on user_orders (user_id, created_at desc);

create table if not exists sessions (
  token       text primary key,            -- случайный 64-символьный hex
  user_id     integer not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists sessions_expires_idx on sessions (expires_at);
