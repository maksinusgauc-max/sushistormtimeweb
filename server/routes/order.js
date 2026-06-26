// ═══════════════════════════════════════════════════════════
// Приём заказа с сайта → ФронтПад. Путь: server/routes/order.js
// Секрет в переменной окружения: FRONTPAD_SECRET.
// ═══════════════════════════════════════════════════════════

import { rateLimit } from '../ratelimit.js';
import { recordUserOrder } from '../session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SECRET = process.env.FRONTPAD_SECRET;
  if (!SECRET) {
    return res.status(500).json({ error: 'Сервер не настроен: нет FRONTPAD_SECRET' });
  }

  try {
    const { source, bare, name, phone, street, home, apart, pod, et, descr, items } = req.body || {};
    const isKiosk = source === 'kiosk';

    // ── Rate-limit: только для заказов с сайта, киоск пропускаем ──
    if (!isKiosk) {
      const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
      const ip = String(fwd).split(',')[0].trim();
      if (await rateLimit('order:' + ip, 5, 60)) {
        return res.status(429).json({ error: 'Слишком много заказов подряд. Подождите минуту или позвоните: 8 (929) 854-11-44' });
      }
    }

    // ── Валидация на сервере (браузеру не доверяем) ──
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Корзина пуста' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Слишком много позиций' });
    }
    if (!isKiosk) {
      if (!name || !phone || !street) {
        return res.status(400).json({ error: 'Некорректные данные заказа' });
      }
      if (!/^[\d\s+\-()]{10,18}$/.test(String(phone))) {
        return res.status(400).json({ error: 'Некорректный телефон' });
      }
    } else if (phone && !/^[\d\s+\-()]{10,18}$/.test(String(phone))) {
      return res.status(400).json({ error: 'Некорректный телефон' });
    }

    // ── Собираем запрос к ФронтПаду ──
    const params = new URLSearchParams();
    params.append('secret', SECRET);

    items.forEach(function (it, i) {
      params.append('product[' + i + ']', String(it.article));
      const qty = Math.max(1, Math.min(99, parseInt(it.qty) || 1));
      params.append('product_kol[' + i + ']', String(qty));
    });

    if (name)   params.append('name',   String(name).slice(0, 100));
    if (phone)  params.append('phone',  String(phone).slice(0, 20));
    if (street) params.append('street', String(street).slice(0, 150));
    if (home)  params.append('home',  String(home).slice(0, 20));
    if (apart) params.append('apart', String(apart).slice(0, 20));
    if (pod)   params.append('pod',   String(pod).slice(0, 10));
    if (et)    params.append('et',    String(et).slice(0, 10));
    if (descr) params.append('descr', String(descr).slice(0, 500));

    const fpResponse = await fetch('https://app.frontpad.ru/api/index.php?new_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await fpResponse.json();

    if (data.result === 'success') {
      const ordNum = data.order_number || data.order_id;
      // Запись в историю клиента — только если ФронтПад принял заказ.
      // Best-effort: ошибка записи не должна валить успешный заказ.
      if (!isKiosk) {
        try {
          await recordUserOrder(req, {
            num: ordNum,
            total: req.body && req.body.total,
            histItems: req.body && req.body.histItems,
            status: 'Принят',
          });
        } catch (e) {
          console.error('history record error:', e);
        }
      }
      return res.status(200).json({ ok: true, order_number: ordNum });
    }

    console.error('FrontPad error:', data);
    return res.status(502).json({
      error: 'ФронтПад отклонил заказ',
      detail: data.error || 'unknown',
    });
  } catch (e) {
    console.error('Order handler error:', e);
    return res.status(500).json({ error: 'Ошибка сервера, попробуйте позвонить: 8 (929) 854-11-44' });
  }
}
