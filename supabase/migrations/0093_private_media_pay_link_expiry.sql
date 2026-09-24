-- ============================================================
-- Hiraticket — bucket 'media' PRIVADO + caducidad de los links de pago.
--
-- Aplicar DESPUÉS de desplegar el código que firma todas las rutas (comprobantes, facturas, guías,
-- avatares y promos ya no usan getPublicUrl). Con el bucket privado, una URL pública vieja deja
-- de abrir; la app las convierte a ruta y las firma, y el worker hace lo mismo al reenviar.
--
-- Links de pago: hasta ahora no caducaban nunca. Desde aquí viven 30 días desde que se generan
-- (o se regeneran al vencer, al copiar o mandar el link). A los que ya existen se les dan 30 días
-- desde hoy. El webhook de MercadoPago no aplica la caducidad: un pago iniciado a tiempo cuenta.
-- ============================================================

update storage.buckets set public = false where id = 'media';

alter table public.orders  add column if not exists pay_token_expires_at timestamptz;
alter table public.charges add column if not exists pay_token_expires_at timestamptz;

update public.orders  set pay_token_expires_at = now() + interval '30 days' where pay_token is not null and pay_token_expires_at is null;
update public.charges set pay_token_expires_at = now() + interval '30 days' where pay_token is not null and pay_token_expires_at is null;
