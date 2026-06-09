
-- ===== 0001_init.sql =====

-- ============================================================
-- Hiraticket — initial schema (multi-tenant, RLS-protected)
-- A "business" is a tenant. Auth users join businesses as members
-- (admin / agent / viewer). All operational data is scoped by business.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles (mirror of auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_color text default '#0E8C82',
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- businesses (tenants) ----------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  vertical    text not null default 'imprenta',
  object_singular text not null default 'Pedido',
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'agent' check (role in ('admin', 'agent', 'viewer')),
  area_id     uuid,
  presence    text not null default 'online',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- ---------- config: areas + stages ----------
create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  color       text not null default 'slate',
  route_to    uuid references auth.users (id),
  position    int  not null default 0
);

create table if not exists public.stages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  color       text not null default 'slate',
  position    int  not null default 0
);

-- ---------- contacts ----------
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  phone       text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------- conversations + messages ----------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id  uuid references public.contacts (id) on delete set null,
  channel     text not null default 'whatsapp',
  status      text not null default 'open' check (status in ('open', 'pending', 'resolved')),
  assignee_id uuid references auth.users (id),
  area_id     uuid references public.areas (id),
  unread      int  not null default 0,
  last_message_at timestamptz default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction   text not null check (direction in ('in', 'out')),
  type        text not null default 'text',
  body        text,
  media_url   text,
  author_id   uuid references auth.users (id),
  state       text default 'sent',
  created_at  timestamptz not null default now()
);

-- ---------- orders + items ----------
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code        text not null,
  contact_id  uuid references public.contacts (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  stage_id    uuid references public.stages (id),
  area_id     uuid references public.areas (id),
  assignee_id uuid references auth.users (id),
  priority    text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  pay_status  text not null default 'pending' check (pay_status in ('pending', 'partial', 'paid')),
  total       numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  name       text not null,
  qty        int  not null default 1,
  unit_price numeric(12,2) not null default 0,
  subtotal   numeric(12,2) not null default 0
);

-- ---------- notes + events (audit log) ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  parent_type text not null check (parent_type in ('conversation', 'order')),
  parent_id   uuid not null,
  author_id   uuid references auth.users (id),
  body        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  parent_type text not null check (parent_type in ('conversation', 'order')),
  parent_id   uuid not null,
  actor_id    uuid references auth.users (id),
  kind        text not null,
  text        text,
  created_at  timestamptz not null default now()
);

-- ---------- canned messages + automations ----------
create table if not exists public.canned_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title       text not null,
  body        text not null,
  category    text,
  shortcut    text
);

create table if not exists public.automations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  name          text not null,
  trigger_type  text not null,
  trigger_value text,
  action_type   text not null,
  action_payload jsonb not null default '{}',
  enabled       boolean not null default true,
  runs          int not null default 0
);

create index if not exists idx_orders_business on public.orders (business_id);
create index if not exists idx_conversations_business on public.conversations (business_id);
create index if not exists idx_messages_conversation on public.messages (conversation_id);

-- ============================================================
-- Row Level Security
-- ============================================================
create or replace function public.is_business_member(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid()
  );
$$;

-- profiles: a user sees/edits their own profile
alter table public.profiles enable row level security;
create policy "own profile read"  on public.profiles for select using (id = auth.uid());
create policy "own profile write" on public.profiles for update using (id = auth.uid());

-- businesses: members can read; creator can insert
alter table public.businesses enable row level security;
create policy "members read business" on public.businesses
  for select using (public.is_business_member(id));
create policy "create business" on public.businesses
  for insert with check (created_by = auth.uid());

-- business_members: a user sees rows for businesses they belong to
alter table public.business_members enable row level security;
create policy "read own memberships" on public.business_members
  for select using (user_id = auth.uid() or public.is_business_member(business_id));

-- Generic member-scoped policy for all operational tables.
do $$
declare t text;
begin
  foreach t in array array[
    'areas','stages','contacts','conversations','messages','orders',
    'notes','events','canned_messages','automations'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$create policy "members all" on public.%I
      for all using (public.is_business_member(business_id))
      with check (public.is_business_member(business_id));$f$, t);
  end loop;
end$$;

-- order_items inherit access from their parent order
alter table public.order_items enable row level security;
create policy "members order_items" on public.order_items
  for all using (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and public.is_business_member(o.business_id))
  )
  with check (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and public.is_business_member(o.business_id))
  );

-- ============================================================
-- Onboarding RPCs
-- ============================================================

-- Create a business and make the caller its admin.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  return new_id;
end;
$$;

-- ===== 0002_seed_demo.sql =====

-- ============================================================
-- Hiraticket — demo data seeder (callable per business)
-- Populates a sticker/print-shop business with stages, areas,
-- contacts, and orders so the app shows realistic data.
-- Idempotent: no-op if the business already has orders.
-- ============================================================

create or replace function public.seed_demo_data(p_business uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s_new uuid; s_design uuid; s_prod uuid; s_ready uuid; s_done uuid;
  a_sales uuid; a_design uuid; a_prod uuid; a_ship uuid;
  c_id uuid;
  o_id uuid;
  conv_id uuid;
  rec record;
  n int := 1043;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business';
  end if;

  if exists (select 1 from public.orders where business_id = p_business) then
    return; -- already seeded
  end if;

  -- stages
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Nuevo', 'slate', 0) returning id into s_new;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Diseño', 'violet', 1) returning id into s_design;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Producción', 'amber', 2) returning id into s_prod;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Listo', 'teal', 3) returning id into s_ready;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Entregado', 'green', 4) returning id into s_done;

  -- areas
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Ventas', 'blue', 0) returning id into a_sales;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Diseño', 'violet', 1) returning id into a_design;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Producción', 'amber', 2) returning id into a_prod;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Envíos', 'teal', 3) returning id into a_ship;

  -- contacts + one order each
  for rec in
    select * from (values
      ('Lucía Fernández', '+52 55 1234 5678', 'Stickers troquelados holográficos', 12, 18, s_ready, a_prod, 'high'),
      ('Carlos Mendoza',  '+52 55 2345 6789', 'Vinil para escaparate 2x1m',          1, 950, s_prod, a_prod, 'normal'),
      ('Estética Bella',  '+52 55 3456 7890', 'Tarjetas de presentación premium',     500, 1.6, s_design, a_design, 'normal'),
      ('Taquería El Güero','+52 55 4567 8901','Lona impresa 3x1m con ojillos',        2, 420, s_new, a_sales, 'urgent'),
      ('Diego Ramírez',   '+52 55 5678 9012', 'Playeras DTF (paquete 20)',            20, 95, s_done, a_ship, 'low'),
      ('Veterinaria Pet', '+52 55 6789 0123', 'Stickers troquelados kiss-cut',        300, 2.2, s_prod, a_prod, 'normal')
    ) as v(cname, phone, item, qty, unit, stage_id, area_id, prio)
  loop
    insert into public.contacts (business_id, name, phone)
      values (p_business, rec.cname, rec.phone) returning id into c_id;

    n := n + 1;
    insert into public.orders (business_id, code, contact_id, stage_id, area_id, assignee_id, priority, total, pay_status)
      values (
        p_business, 'HIR-' || n, c_id, rec.stage_id, rec.area_id, v_uid, rec.prio,
        (rec.qty * rec.unit)::numeric(12,2),
        case rec.stage_id when s_done then 'paid' when s_ready then 'partial' else 'pending' end
      ) returning id into o_id;

    insert into public.order_items (order_id, name, qty, unit_price, subtotal)
      values (o_id, rec.item, rec.qty, rec.unit, (rec.qty * rec.unit)::numeric(12,2));

    -- a conversation with a few messages, linked back to the order
    insert into public.conversations (business_id, contact_id, status, assignee_id, area_id, unread, last_message_at)
      values (
        p_business, c_id,
        case rec.stage_id when s_done then 'resolved' else 'open' end,
        v_uid, rec.area_id,
        case rec.stage_id when s_done then 0 else 1 end,
        now()
      ) returning id into conv_id;

    update public.orders set conversation_id = conv_id where id = o_id;

    insert into public.messages (business_id, conversation_id, direction, type, body, author_id, state, created_at) values
      (p_business, conv_id, 'in',  'text', 'Hola, quiero info sobre ' || rec.item, null, 'delivered', now() - interval '2 hour'),
      (p_business, conv_id, 'out', 'text', '¡Claro! Te ayudo con tu pedido HIR-' || n || '.', v_uid, 'read', now() - interval '1 hour'),
      (p_business, conv_id, 'in',  'text', '¿Para cuándo estaría listo?', null, 'delivered', now() - interval '18 minute');

    insert into public.notes (business_id, parent_type, parent_id, author_id, body)
      values (p_business, 'order', o_id, v_uid, 'Cliente pidió factura.');
  end loop;

  -- mark the demo WhatsApp session connected so chat works out of the box
  update public.whatsapp_sessions
    set status = 'connected', phone = '+52 55 1000 2000', last_seen = now()
    where business_id = p_business;

  -- canned messages
  insert into public.canned_messages (business_id, title, body, category, shortcut) values
    (p_business, 'Saludo',        'Hola {{name}} 👋 gracias por escribir a Hirata. ¿En qué te ayudo?', 'General', '/hola'),
    (p_business, 'Pedido listo',  '{{name}}, tu pedido {{order_number}} ya está listo para recoger 🎉', 'Pedidos', '/listo'),
    (p_business, 'Link de pago',  'Aquí tu link de pago para {{order_number}}: pay.hiraticket.com 💳',  'Pagos',   '/pago');

  -- automations
  insert into public.automations (business_id, name, trigger_type, trigger_value, action_type, action_payload, enabled) values
    (p_business, 'Pedido listo → avisar', 'order_stage',       s_ready::text, 'send_template', '{"template":"Pedido listo"}', true),
    (p_business, 'Nuevo chat → saludar',  'conversation_new',  null,          'send_template', '{"template":"Saludo"}',       true);
end;
$$;

-- ===== 0003_saas.sql =====

-- ============================================================
-- Hiraticket — SaaS layer: plans, subscriptions, WhatsApp sessions,
-- and platform (super-admin) access.
-- ============================================================

-- ---------- plans (global catalog) ----------
create table if not exists public.plans (
  id            text primary key,            -- 'inicio' | 'pro' | 'negocio'
  name          text not null,
  price_monthly numeric(10,2) not null default 0,
  price_annual  numeric(10,2) not null default 0,
  currency      text not null default 'MXN',
  popular       boolean not null default false,
  limits        jsonb not null default '{}', -- { agents, whatsapp, automations, ... }
  features      jsonb not null default '[]',
  position      int not null default 0
);

insert into public.plans (id, name, price_monthly, price_annual, popular, limits, features, position) values
  ('inicio',  'Inicio',   499,  4990, false,
   '{"agents":3,"whatsapp":1,"automations":3}',
   '["Chat + Pedidos","1 número de WhatsApp","3 agentes","Tablero Kanban"]', 0),
  ('pro',     'Pro',      999,  9990, true,
   '{"agents":10,"whatsapp":2,"automations":20}',
   '["Todo en Inicio","10 agentes","2 números","Automatizaciones","Reportes"]', 1),
  ('negocio', 'Negocio',  1999, 19990, false,
   '{"agents":-1,"whatsapp":5,"automations":-1}',
   '["Todo en Pro","Agentes ilimitados","5 números","Campañas","API"]', 2)
on conflict (id) do nothing;

alter table public.plans enable row level security;
create policy "plans readable" on public.plans for select using (auth.uid() is not null);

-- ---------- subscriptions (one per business) ----------
create table if not exists public.subscriptions (
  business_id   uuid primary key references public.businesses (id) on delete cascade,
  plan_id       text not null references public.plans (id) default 'pro',
  status        text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
  mrr           numeric(10,2) not null default 0,
  trial_ends_at timestamptz default (now() + interval '14 days'),
  current_period_end timestamptz default (now() + interval '30 days'),
  created_at    timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create policy "members read subscription" on public.subscriptions
  for select using (public.is_business_member(business_id));

-- ---------- whatsapp sessions ----------
create table if not exists public.whatsapp_sessions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  label       text not null default 'Principal',
  phone       text,
  status      text not null default 'disconnected'
              check (status in ('disconnected','qr','connecting','connected','reconnecting')),
  qr          text,
  last_seen   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_wa_business on public.whatsapp_sessions (business_id);

alter table public.whatsapp_sessions enable row level security;
create policy "members manage wa" on public.whatsapp_sessions
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- ---------- platform (super-admin) ----------
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

alter table public.platform_admins enable row level security;
create policy "admins read platform_admins" on public.platform_admins
  for select using (public.is_platform_admin() or user_id = auth.uid());

-- Bootstrap: the first caller can claim platform-admin (only while none exist).
create or replace function public.bootstrap_platform_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.platform_admins) then
    raise exception 'platform already has an admin';
  end if;
  insert into public.platform_admins (user_id) values (auth.uid());
end;
$$;

-- Members of a shared business can read each other's profiles (names/avatars).
create policy "read co-member profiles" on public.profiles for select using (
  public.is_platform_admin() or exists (
    select 1 from public.business_members m1
    join public.business_members m2 on m1.business_id = m2.business_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  )
);

-- Platform admins can read across all tenants (subscriptions, businesses, wa health).
create policy "platform read subscriptions" on public.subscriptions
  for select using (public.is_platform_admin());
create policy "platform read businesses" on public.businesses
  for select using (public.is_platform_admin());
create policy "platform read wa" on public.whatsapp_sessions
  for select using (public.is_platform_admin());

-- Give every new business a default trialing subscription.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  insert into public.subscriptions (business_id, plan_id, status, mrr)
  values (new_id, 'pro', 'trialing', 999)
  on conflict (business_id) do nothing;

  insert into public.whatsapp_sessions (business_id, label, status)
  values (new_id, 'Principal', 'disconnected');

  return new_id;
end;
$$;

-- ===== 0004_catalog_agenda_campaigns.sql =====

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

-- ===== 0005_whatsapp_pairing.sql =====

-- ============================================================
-- Hiraticket — WhatsApp connection method (QR or pairing code).
-- Used by the Baileys worker.
-- ============================================================

alter table public.whatsapp_sessions
  add column if not exists connect_method text not null default 'qr'
  check (connect_method in ('qr', 'pairing'));

alter table public.whatsapp_sessions
  add column if not exists pairing_code text;

-- ===== 0006_onboarding.sql =====

-- ============================================================
-- Hiraticket — first-run onboarding + default config (no dummy data).
-- New businesses get a working pipeline (stages/areas for their vertical),
-- but NO sample orders/contacts/chats. An `onboarded` flag drives a one-time,
-- skippable setup wizard.
-- ============================================================

alter table public.businesses
  add column if not exists onboarded boolean not null default false;

-- Default stages + areas for a vertical (real config, not sample data).
create or replace function public.seed_default_config(p_business uuid, p_vertical text)
returns void language plpgsql security definer set search_path = public as $$
declare
  stage_names text[];
  area_names  text[];
  scolors text[] := array['slate','violet','amber','teal','green','blue'];
  acolors text[] := array['blue','violet','amber','teal','green','slate'];
  i int;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business';
  end if;
  if exists (select 1 from public.stages where business_id = p_business) then
    return;
  end if;

  case p_vertical
    when 'restaurante' then
      stage_names := array['Recibido','En cocina','Listo','En camino','Entregado'];
      area_names  := array['Mostrador','Cocina','Reparto'];
    when 'estetica' then
      stage_names := array['Agendado','En servicio','Terminado'];
      area_names  := array['Recepción','Servicio'];
    when 'veterinaria' then
      stage_names := array['Agendado','En consulta','Seguimiento'];
      area_names  := array['Recepción','Consultorio'];
    when 'retail' then
      stage_names := array['Nuevo','Preparando','Listo','Entregado'];
      area_names  := array['Ventas','Almacén','Envíos'];
    when 'taller' then
      stage_names := array['Recibido','Diagnóstico','Reparación','Listo','Entregado'];
      area_names  := array['Recepción','Taller'];
    when 'other' then -- generic, business-agnostic pipeline
      stage_names := array['Nuevo','En progreso','En espera','Completado'];
      area_names  := array['General','Ventas','Operaciones'];
    else -- imprenta (default)
      stage_names := array['Nuevo','Diseño','Producción','Listo','Entregado'];
      area_names  := array['Ventas','Diseño','Producción','Envíos'];
  end case;

  for i in 1 .. array_length(stage_names, 1) loop
    insert into public.stages (business_id, name, color, position)
    values (p_business, stage_names[i], scolors[((i - 1) % 6) + 1], i - 1);
  end loop;
  for i in 1 .. array_length(area_names, 1) loop
    insert into public.areas (business_id, name, color, position)
    values (p_business, area_names[i], acolors[((i - 1) % 6) + 1], i - 1);
  end loop;
end;
$$;

-- create_business now provisions a working (empty) business + default pipeline.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  insert into public.subscriptions (business_id, plan_id, status, mrr)
  values (new_id, 'pro', 'trialing', 999)
  on conflict (business_id) do nothing;

  insert into public.whatsapp_sessions (business_id, label, status)
  values (new_id, 'Principal', 'disconnected');

  perform public.seed_default_config(new_id, coalesce(p_vertical, 'imprenta'));

  return new_id;
end;
$$;

-- Mark the one-time onboarding as done (completed or skipped).
create or replace function public.complete_onboarding(p_business uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_business_member(p_business) then
    raise exception 'forbidden';
  end if;
  update public.businesses set onboarded = true where id = p_business;
end;
$$;

-- ===== 0007_whatsapp_device.sql =====

-- ============================================================
-- Hiraticket — store the whatsmeow device JID per session, so the Go
-- worker can resume a number after a restart without a new QR.
-- (whatsmeow keeps the actual auth/keys in its own whatsmeow_* tables.)
-- ============================================================

alter table public.whatsapp_sessions
  add column if not exists device_jid text;

-- ===== 0008_realtime.sql =====

-- ============================================================
-- Hiraticket — enable Supabase Realtime for live chat.
-- Adds messages + conversations to the supabase_realtime publication so the
-- browser receives inserts/updates (RLS still gates which rows each user sees).
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
    ) then
      alter publication supabase_realtime add table public.conversations;
    end if;
  end if;
end$$;

-- ===== 0009_realtime_whatsapp.sql =====

-- ============================================================
-- Hiraticket — live WhatsApp status: publish whatsapp_sessions to Realtime so
-- the Settings screen reflects connect/QR/connected/disconnected immediately.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_sessions'
     ) then
    alter publication supabase_realtime add table public.whatsapp_sessions;
  end if;
end$$;

-- ===== 0010_message_wa_id.sql =====

-- ============================================================
-- Hiraticket — store the WhatsApp message id so the worker can dedupe.
-- Lets us sync messages you send from your phone (fromMe) without
-- duplicating the ones the app itself sent.
-- ============================================================

alter table public.messages
  add column if not exists wa_id text;

create index if not exists idx_messages_wa
  on public.messages (business_id, wa_id);

-- ===== 0011_conversation_snooze.sql =====

-- ============================================================
-- Hiraticket — hide + snooze conversations.
--   hidden        : keep a chat out of the active list until un-hidden
--   snoozed_until : postpone a chat; it returns to the active list when the
--                   time passes (or when the customer writes again).
-- ============================================================

alter table public.conversations
  add column if not exists hidden boolean not null default false;

alter table public.conversations
  add column if not exists snoozed_until timestamptz;

-- ===== 0012_contact_avatar.sql =====

-- ============================================================
-- Hiraticket — contact avatar + on-demand info refresh.
--   avatar_url      : WhatsApp profile picture URL (fetched by the worker)
--   fetch_requested : when set, the worker fetches name/photo then clears it
-- ============================================================

alter table public.contacts
  add column if not exists avatar_url text;

alter table public.contacts
  add column if not exists fetch_requested timestamptz;

-- live name/photo updates
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
     ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end$$;

-- ===== 0013_media.sql =====

-- ============================================================
-- Hiraticket — media: a public storage bucket + message media columns.
-- Inbound media is downloaded by the worker (service role) and stored here;
-- outbound media is uploaded by the app, then sent by the worker.
-- ============================================================

alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists media_name text;

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- public read (bucket is public) + authenticated upload
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media auth upload" on storage.objects;
create policy "media auth upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

-- ===== 0014_message_ops.sql =====

-- ============================================================
-- Hiraticket — reply / edit / delete for WhatsApp messages.
--   reply_to   : the message this one quotes
--   pending_op : 'edit' | 'delete' — picked up by the worker, then cleared
--   deleted    : true after a successful revoke (deleted for everyone)
-- ============================================================

alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists pending_op text;
alter table public.messages add column if not exists deleted boolean not null default false;

-- ===== 0015_message_extras.sql =====

-- ============================================================
-- Hiraticket — message extras: forwarded/edited flags + structured meta
-- (location coords, contact vCard, etc.) for richer rendering.
-- ============================================================

alter table public.messages add column if not exists forwarded boolean not null default false;
alter table public.messages add column if not exists edited boolean not null default false;
alter table public.messages add column if not exists meta jsonb;

-- ===== 0016_custom_fields.sql =====

-- Per-vertical custom fields shown on orders (e.g. Plate, Pet, Paper type).
alter table public.businesses add column if not exists custom_fields jsonb not null default '[]';
