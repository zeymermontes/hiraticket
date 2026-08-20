-- ============================================================
-- Hiraticket — imagen promocional en el link de pago del cliente.
--   pay_promo_url:       URL pública de la imagen (bucket 'media', 0013). null = nunca se subió.
--   pay_promo_placement: dónde la ve el cliente en /pay/[token]
--                          'off'   → no se muestra (la imagen se conserva por si la reactivan)
--                          'below' → debajo del ticket, al final de la página
--                          'popup' → ventana emergente al abrir el link (se cierra y ya)
--   Se guarda el destino aparte de la URL a propósito: apagar la promo no debe borrar la imagen
--   ni obligar a volver a subirla.
-- ============================================================

alter table public.businesses add column if not exists pay_promo_url text;
alter table public.businesses add column if not exists pay_promo_placement text not null default 'off';

-- Idempotente: se tira y se vuelve a poner, así la migración se puede correr dos veces.
alter table public.businesses drop constraint if exists businesses_pay_promo_placement_check;
alter table public.businesses add constraint businesses_pay_promo_placement_check
  check (pay_promo_placement in ('off', 'below', 'popup'));
