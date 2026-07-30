-- ============================================================
-- Hiraticket — mermas (0074): reimpresiones, errores de producción o cancelaciones parciales
-- que cuestan material/tiempo aunque el pedido no se cancele. Uso interno: nunca se muestra
-- al cliente (no aparece en el ticket ni en el link de pago).
--
--   Va aparte de `orders`/`order_items` (no resta de `total`/`subtotal`): la merma es un costo
--   interno, no un ajuste a lo que se le cobra al cliente. En reportes se resta de la utilidad
--   estimada, separado de "cancelados" porque una merma puede pasar sin cancelar nada (ej. se
--   reimprime un producto y el que salió mal se tira, pero el pedido se entrega igual).
--
--   order_item_id es opcional: null = merma del pedido en general; con valor = merma de un
--   producto específico. on delete set null porque borrar la línea del pedido no debe borrar
--   el registro de la merma (el costo ya se incurrió).
--
--   product_id liga la merma a un producto del catálogo (para tomar su costo de ahí); si es null
--   es una merma genérica con `cost` capturado a mano. `name` siempre se guarda (del producto
--   elegido o escrito a mano) para que la merma se siga mostrando igual aunque el producto o la
--   línea del pedido se borren después — es una fotografía, no una referencia viva.
-- ============================================================

create table if not exists public.order_waste (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  order_id      uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete set null,
  product_id    uuid references public.products (id) on delete set null,
  name          text not null,
  qty           numeric(12,2) not null default 1,
  cost          numeric(12,2) not null default 0,
  reason        text not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists order_waste_order_idx on public.order_waste (order_id);
create index if not exists order_waste_business_created_idx on public.order_waste (business_id, created_at);

alter table public.order_waste enable row level security;
drop policy if exists "members order_waste" on public.order_waste;
create policy "members order_waste" on public.order_waste
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
