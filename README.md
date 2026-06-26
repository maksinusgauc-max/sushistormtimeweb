# Суши Шторм (Кабардинка) — развёртывание на Timeweb Cloud

Один Node-сервер (Express) раздаёт сайт и обслуживает `/api/*`.
Данные — в PostgreSQL. Лимиты — в Redis (необязательно).

## 1. Структура репозитория

В корень GitHub-репозитория кладём:

```
index.html              мен, корзина, оформление, кабинет (фронт)
menu.js                 статичное меню (резерв + киоск)
kiosk.html  admin.html  site-admin.html  privacy.html  oferta.html
img/                    фото блюд + logo.png
package.json
server/
  server.js             точка входа (раздаёт фронт + монтирует /api)
  db.js  session.js  ratelimit.js  tbank.js
  routes/  (menu, auth, order, payment, payment-webhook, chat, admin-login)
sql/
  schema.sql  auth-schema.sql  seed.sql
.gitignore              ОБЯЗАТЕЛЬНО: добавить .env и node_modules
```

УДАЛИТЬ из старого проекта: папку `api/`, папку `supabase/`, `middleware.js`,
все упоминания `SUPABASE_*`. Их заменил `server/`.

## 2. База данных (Timeweb Managed PostgreSQL)

1. Создать кластер PostgreSQL.
2. В SQL-консоли выполнить по порядку:
   - `sql/schema.sql`      (таблица menu)
   - `sql/auth-schema.sql` (users, user_orders, sessions)
   - `sql/seed.sql`        (192 блюда)
3. Скопировать строку подключения → переменная `DATABASE_URL`.

## 3. Redis (необязательно)

Если нужны надёжные лимиты — создать Managed Redis, строку → `REDIS_URL`.
Без него лимиты работают «в памяти» (сбрасываются при перезапуске).

## 4. Приложение (Timeweb App Platform)

1. Создать backend-приложение из GitHub-репозитория (ветка main).
2. Команда сборки: `npm install`
3. Команда запуска: `npm start`
4. Node.js: версия 18 или новее.
5. Выставить переменные окружения (раздел 5).
6. Привязать домен, дождаться бесплатного SSL.

Деплой автоматический при каждом `git push` в main.

## 5. Переменные окружения

| Переменная           | Обязательна | Откуда                                  |
|----------------------|-------------|-----------------------------------------|
| DATABASE_URL         | да          | Timeweb PostgreSQL                      |
| ADMIN_PASS           | да          | придумать (вход сотрудников)            |
| FRONTPAD_SECRET      | да          | ФронтПад                               |
| ANTHROPIC_API_KEY    | для чата    | console.anthropic.com                   |
| TBANK_TERMINAL_KEY   | для оплаты  | Т-Бизнес                               |
| TBANK_PASSWORD       | для оплаты  | Т-Бизнес                               |
| TBANK_TAXATION       | нет         | у бухгалтера (по умолч. usn_income)    |
| TBANK_VAT            | нет         | у бухгалтера (по умолч. none)          |
| TBANK_RECEIPT        | нет         | off — чек пробиваете вручную           |
| REDIS_URL            | нет         | Timeweb Redis                          |
| ADMIN_LOGIN          | нет         | по умолчанию admin                     |

После изменения любой переменной — Redeploy.

## 6. Т-Банк

Адрес вебхука подставляется автоматически (домен сайта + /api/payment-webhook).
Можно продублировать в кабинете Т-Бизнес → Уведомления (NotificationURL).
Чек по 54-ФЗ сейчас пробивается вручную на терминале (TBANK_RECEIPT=off).

## 7. Проверка после деплоя

- Открыть сайт → меню грузится (с сервера; при сбое — из menu.js).
- Тест-заказ → приходит во ФронтПад.
- Регистрация → вход → заказ → история сохраняется.
- Оплата картой — тест в боевом режиме малой суммой.
- /privacy.html и /oferta.html открываются, реквизиты заполнены.
