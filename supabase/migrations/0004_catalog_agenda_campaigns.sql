-- ============================================================
-- Hiraticket — Catalog (products/services), Agenda (appointments),
-- and Campaigns (broadcasts). All member-scoped via RLS.
-- ============================================================

create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  kind        text not null default 'product' check (kind in ('product','service')),
  price       numeric(12,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.appointments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  title       text not null,
  area_id     uuid references public.areas (id),
  assignee_id uuid references auth.users (id),
  starts_at   timestamptz not null default now(),
  status      text not null default 'scheduled' check (status in ('scheduled','done','canceled')),
  created_at  timestamptz not null default now()
);

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  template    text,
  audience    text,
  recipients  int not null default 0,
  delivered   int not null default 0,
  read        int not null default 0,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_products_business on public.products (business_id);
create index if not exists idx_appointments_business on public.appointments (business_id);
create index if not exists idx_campaigns_business on public.campaigns (business_id);

do $$
declare t text;
begin
  foreach t in array array['products','appointments','campaigns'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy "members all" on public.%I
      for all using (public.is_business_member(business_id))
      with check (public.is_business_member(business_id));$f$, t);
  end loop;
end$$;

-- Demo seeder for the new sections (called alongside seed_demo_data).
create or replace function public.seed_demo_extra(p_business uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c_id uuid;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business';
  end if;
  if exists (select 1 from public.products where business_id = p_business) then
    return;
  end if;

  insert into public.products (business_id, name, kind, price) values
    (p_business, 'Stickers troquelados (100)', 'product', 180),
    (p_business, 'Vinil impreso m²',           'product', 320),
    (p_business, 'Tarjetas premium (500)',     'product', 800),
    (p_business, 'Lona 3x1m con ojillos',      'product', 420),
    (p_business, 'Diseño express',             'service', 350);

  select id into c_id from public.contacts where business_id = p_business order by created_at limit 1;
  if c_id is not null then
    insert into public.appointments (business_id, contact_id, title, starts_at) values
      (p_business, c_id, 'Entrega de pedido', now() + interval '1 day'),
      (p_business, c_id, 'Revisión de diseño', now() + interval '3 hour');
  end if;

  insert into public.campaigns (business_id, name, template, audience, recipients, delivered, read, sent_at) values
    (p_business, 'Promo de temporada', 'Saludo', 'Todos los clientes', 240, 232, 180, now() - interval '2 day');
end;
$$;
