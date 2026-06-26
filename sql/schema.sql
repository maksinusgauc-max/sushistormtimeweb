-- ═══════════════════════════════════════════════════════════
-- Таблица меню для PostgreSQL (Timeweb Managed PostgreSQL).
-- Выполнять в SQL-консоли базы (psql / панель Timeweb).
-- Поля соответствуют маппингу на сайте (loadServerMenu в index.html).
-- ═══════════════════════════════════════════════════════════

create table if not exists menu (
  id          serial primary key,
  article     text    not null,            -- артикул ФронтПада
  cat         text    not null,            -- категория (для группировки/порядка)
  name        text    not null,
  price       integer not null default 0,
  img         text,                        -- путь к фото, напр. img/АРТИКУЛ.jpg
  ph          text,                        -- плейсхолдер/мини-превью (если используется)
  descr       text,                        -- состав/описание
  badge       text,                        -- метка («Хит», «Острое» и т.п.)
  available   boolean not null default true, -- false = стоп-лист (скрыть на сайте)
  sort        integer not null default 0,    -- порядок внутри категории
  updated_at  timestamptz not null default now()
);

-- Порядок выдачи на сайте: cat, затем sort, затем id
create index if not exists menu_cat_sort_idx on menu (cat, sort, id);
