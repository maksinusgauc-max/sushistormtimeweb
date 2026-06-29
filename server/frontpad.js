// ═══════════════════════════════════════════════════════════
// Отправка заказа во ФронтПад (общий модуль). Путь: server/frontpad.js
// Используется и при обычном заказе (оплата при получении),
// и в вебхуке оплаты (онлайн-заказ уходит в кассу после оплаты).
// ═══════════════════════════════════════════════════════════

export async function submitToFrontpad(o) {
  const SECRET = process.env.FRONTPAD_SECRET;
  if (!SECRET) return { ok: false, error: 'no_secret' };

  const params = new URLSearchParams();
  params.append('secret', SECRET);

  (o.items || []).forEach(function (it, i) {
    params.append('product[' + i + ']', String(it.article));
    const qty = Math.max(1, Math.min(99, parseInt(it.qty) || 1));
    params.append('product_kol[' + i + ']', String(qty));
  });

  if (o.name)   params.append('name',   String(o.name).slice(0, 100));
  if (o.phone)  params.append('phone',  String(o.phone).slice(0, 20));
  if (o.street) params.append('street', String(o.street).slice(0, 150));
  if (o.home)   params.append('home',   String(o.home).slice(0, 20));
  if (o.apart)  params.append('apart',  String(o.apart).slice(0, 20));
  if (o.pod)    params.append('pod',    String(o.pod).slice(0, 10));
  if (o.et)     params.append('et',     String(o.et).slice(0, 10));
  if (o.descr)  params.append('descr',  String(o.descr).slice(0, 500));

  try {
    const r = await fetch('https://app.frontpad.ru/api/index.php?new_order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json();
    if (data.result === 'success') {
      return { ok: true, order_number: data.order_number || data.order_id };
    }
    console.error('FrontPad error:', data);
    return { ok: false, error: data.error || 'frontpad_rejected' };
  } catch (e) {
    console.error('FrontPad unreachable:', e);
    return { ok: false, error: 'frontpad_unreachable' };
  }
}
