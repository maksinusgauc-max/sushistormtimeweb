-- ═══════════════════════════════════════════════════════════
-- Отложенные заказы (ждут онлайн-оплаты). Путь: sql/pending-schema.sql
-- Выполнить в базе один раз (после auth-schema.sql).
--
-- Онлайн-заказ сохраняется сюда и уходит во ФронтПад ТОЛЬКО после
-- подтверждения оплаты вебхуком. Не оплачен — в кассу не попадает.
-- ═══════════════════════════════════════════════════════════

create table if not exists pending_orders (
  id          text primary key,            -- наш OrderId, его же отдаём Т-Банку
  user_id     integer references users(id) on delete set null,
  payload     jsonb not null,              -- всё для ФронтПада + история (histItems, total)
  status      text not null default 'pending', -- pending | processing | sent | fp_failed
  fp_order    text,                         -- номер заказа во ФронтПаде после отправки
  created_at  timestamptz not null default now()
);
create index if not exists pending_orders_status_idx on pending_orders (status, created_at);
