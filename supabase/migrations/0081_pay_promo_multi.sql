-- ============================================================
-- Hiraticket — varios anuncios en el link de pago, no uno solo (extiende 0080).
--   pay_promo_images: [{ "id": "...", "url": "..." }] — la galería del negocio. El cliente ve UNO
--   al azar cada vez que abre su link; el sorteo se hace al renderizar la página, no se guarda.
--   pay_promo_placement (0080) sigue igual y aplica al que salga: off / below / popup.
--
--   Se va aparte de 0080 y no reescribiéndola porque 0080 pudo aplicarse ya; la imagen única que
--   hubiera se convierte en el primer elemento de la galería y la columna vieja se retira.
-- ============================================================

alter table public.businesses add column if not exists pay_promo_images jsonb not null default '[]'::jsonb;

update public.businesses
   set pay_promo_images = jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'url', pay_promo_url))
 where pay_promo_url is not null
   and coalesce(pay_promo_url, '') <> ''
   and pay_promo_images = '[]'::jsonb;

alter table public.businesses drop column if exists pay_promo_url;
