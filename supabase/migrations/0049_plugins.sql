-- ============================================================
-- Hiraticket — Plugins marketplace (Phase 1: framework + shell).
--   A curated, first-party catalogue of integrations (payment gateways, invoicing, shipping…).
--   `plugins` = the catalogue (super-admin curated, mirrors `plans`).
--   `business_plugins` = a tenant's install + config (secrets encrypted) + its MRR contribution.
--   `plugin_usage` = a meter for the metered pricing model (table + index; no real writers yet).
--   Integrations themselves are mocks in this phase — no third-party API calls.
-- ============================================================

-- Catalogue of available integrations.
create table if not exists public.plugins (
  id            text primary key,                 -- e.g. 'mercadopago' | 'facturapi' | 'skydropx'
  name          text not null,
  category      text not null default 'automation', -- payments | invoicing | shipping | automation | ai
  provider      text,
  description   text,
  icon          text,                             -- Icon component name
  pricing       jsonb not null default '{}'::jsonb, -- { model, addon_monthly?, metered_unit?, metered_price?, revshare_pct?, note? }
  config_schema jsonb not null default '[]'::jsonb, -- [{ key, label, type:'text'|'secret'|'toggle'|'select', options?, required? }]
  status        text not null default 'available', -- available | coming_soon
  popular       boolean not null default false,
  position      int not null default 0
);
alter table public.plugins enable row level security;
drop policy if exists "anyone reads plugins" on public.plugins;
create policy "anyone reads plugins" on public.plugins for select using (true); -- catalogue is public to authenticated app users
-- Writes to the catalogue go through the service-role client (platform admin only).

-- A tenant's installation of a plugin.
create table if not exists public.business_plugins (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  plugin_id    text not null references public.plugins (id) on delete cascade,
  status       text not null default 'active',    -- active | disabled
  config       jsonb not null default '{}'::jsonb, -- settings/credentials; secret fields stored encrypted
  mrr          numeric(10,2) not null default 0,  -- add-on contribution to the tenant's MRR
  installed_by uuid references auth.users (id) on delete set null,
  installed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, plugin_id)
);
create index if not exists business_plugins_biz_idx on public.business_plugins (business_id);
alter table public.business_plugins enable row level security;
drop policy if exists "members business_plugins" on public.business_plugins;
create policy "members business_plugins" on public.business_plugins
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- Usage meter for the metered pricing model (no real writers yet).
create table if not exists public.plugin_usage (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  plugin_id   text not null references public.plugins (id) on delete cascade,
  unit        text,
  qty         numeric(12,2) not null default 1,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists plugin_usage_idx on public.plugin_usage (business_id, plugin_id, created_at);
alter table public.plugin_usage enable row level security;
drop policy if exists "members plugin_usage" on public.plugin_usage;
create policy "members plugin_usage" on public.plugin_usage
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- Allow business-scoped audit events (plugin activated/deactivated) alongside conversation/order.
alter table public.events drop constraint if exists events_parent_type_check;
alter table public.events add constraint events_parent_type_check check (parent_type in ('conversation', 'order', 'business'));

-- Seed the initial curated catalogue (all mock in Phase 1). One per pricing model for testing.
insert into public.plugins (id, name, category, provider, description, icon, pricing, config_schema, status, popular, position) values
  ('webhooks', 'Webhooks', 'automation', 'Hiraticket',
   'Envía eventos de pedidos y chats a una URL tuya (Zapier, Make, tu backend).', 'bolt',
   '{"model":"free"}'::jsonb,
   '[{"key":"url","label":"URL del webhook","type":"text","required":true},{"key":"secret","label":"Secreto de firma","type":"secret"}]'::jsonb,
   'available', false, 1),
  ('mercadopago', 'MercadoPago', 'payments', 'MercadoPago',
   'Cobra con tarjeta y meses sin intereses en tu link de pago.', 'orders',
   '{"model":"revshare","revshare_pct":0,"note":"Comisión de partner"}'::jsonb,
   '[{"key":"access_token","label":"Access Token","type":"secret","required":true},{"key":"public_key","label":"Public Key","type":"text","required":true}]'::jsonb,
   'coming_soon', true, 2),
  ('facturapi', 'Facturapi (CFDI 4.0)', 'invoicing', 'Facturapi',
   'Emite facturas CFDI 4.0 automáticamente cuando un pedido se paga.', 'file',
   '{"model":"metered","metered_unit":"factura","metered_price":2}'::jsonb,
   '[{"key":"api_key","label":"API Key","type":"secret","required":true},{"key":"rfc","label":"RFC emisor","type":"text","required":true}]'::jsonb,
   'coming_soon', false, 3),
  ('skydropx', 'Skydropx', 'shipping', 'Skydropx',
   'Genera guías de envío multi-paquetería desde cada pedido.', 'send',
   '{"model":"addon","addon_monthly":199}'::jsonb,
   '[{"key":"api_key","label":"API Key","type":"secret","required":true}]'::jsonb,
   'coming_soon', false, 4)
on conflict (id) do nothing;
