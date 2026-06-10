-- ============================================================
-- Hiraticket — per-order payments (partial payments + history).
--   Each row is one payment against an order; the order's pay_status is recomputed from the sum
--   (>= total → 'paid', > 0 → 'partial', else 'pending').
-- ============================================================

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_id    uuid not null references public.orders (id) on delete cascade,
  amount      numeric(12,2) not null default 0,
  method      text,
  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments (order_id);

alter table public.payments enable row level security;
drop policy if exists "members payments" on public.payments;
create policy "members payments" on public.payments
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
