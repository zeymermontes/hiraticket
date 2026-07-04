-- ============================================================
-- Hiraticket — shipping (Phase 3): saved customer addresses + shipments per order.
--   contact_addresses: reusable destinations for recurring customers.
--   shipments: one row per generated label (provider, carrier, tracking, label PDF, frozen address).
--   Skydropx goes LIVE: OAuth2 credentials (Client ID/Secret) + the business's origin address are
--   configured on the plugin; Envíos Perros stays coming_soon until its API is validated.
-- ============================================================

create table if not exists public.contact_addresses (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  receiver    text,           -- who receives (defaults to the contact's name)
  phone       text,
  street      text not null,  -- calle y número
  colonia     text,
  city        text not null,
  state       text not null,
  zip         text not null,
  reference   text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists contact_addresses_contact_idx on public.contact_addresses (contact_id);
alter table public.contact_addresses enable row level security;
drop policy if exists "members contact_addresses" on public.contact_addresses;
create policy "members contact_addresses" on public.contact_addresses
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create table if not exists public.shipments (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  provider        text not null,             -- 'skydropx' | 'enviosperros'
  carrier         text,                      -- e.g. Estafeta / DHL
  service         text,
  tracking_number text,
  label_url       text,                      -- PDF label
  cost            numeric(12,2),
  address         jsonb not null default '{}'::jsonb, -- frozen destination snapshot
  parcel          jsonb not null default '{}'::jsonb, -- { weight, length, width, height }
  status          text not null default 'created',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists shipments_order_idx on public.shipments (order_id);
alter table public.shipments enable row level security;
drop policy if exists "members shipments" on public.shipments;
create policy "members shipments" on public.shipments
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- Skydropx goes live: OAuth2 credentials + origin address in the plugin config.
update public.plugins set
  status = 'available',
  description = 'Genera guías de envío multi-paquetería desde cada pedido, con rastreo automático al cliente.',
  config_schema = '[
    {"key":"client_id","label":"Client ID","type":"text","required":true},
    {"key":"client_secret","label":"Client Secret","type":"secret","required":true},
    {"key":"origin_name","label":"Remitente (nombre)","type":"text","required":true},
    {"key":"origin_phone","label":"Remitente (teléfono)","type":"text","required":true},
    {"key":"origin_street","label":"Origen: calle y número","type":"text","required":true},
    {"key":"origin_colonia","label":"Origen: colonia","type":"text","required":true},
    {"key":"origin_city","label":"Origen: ciudad","type":"text","required":true},
    {"key":"origin_state","label":"Origen: estado","type":"text","required":true},
    {"key":"origin_zip","label":"Origen: código postal","type":"text","required":true}
  ]'::jsonb,
  guide = '[
    {"title":"Crea tu cuenta Skydropx PRO","body":"Regístrate en Skydropx PRO (o entra a tu cuenta).","url":"https://pro.skydropx.com"},
    {"title":"Crea una aplicación API","body":"Ve a Conexiones → API (merchant_stores/applications) y crea una aplicación para obtener tu Client ID y Client Secret.","url":"https://pro.skydropx.com/merchant_stores/applications"},
    {"title":"Configura credenciales y origen","body":"Pega el Client ID y Client Secret en Configurar, y llena la dirección de ORIGEN (desde dónde envías): remitente, teléfono, calle, colonia, ciudad, estado y CP."},
    {"title":"Genera tu primera guía","body":"Abre un pedido → bloque Envío → Generar guía: elige o captura la dirección del cliente (queda guardada para la próxima), indica peso y medidas, cotiza y elige paquetería. La etiqueta PDF y el rastreo quedan en el pedido."},
    {"title":"Avisa al cliente","body":"Con un clic envías el número de rastreo por WhatsApp al chat del pedido."}
  ]'::jsonb
where id = 'skydropx';
