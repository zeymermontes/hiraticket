-- ============================================================
-- Hiraticket — CFDI invoicing via Facturapi (plugin goes live).
--   contact_fiscal: the customer's tax profile, saved per contact (recurring customers).
--   invoices: issued CFDIs per order (folio fiscal/uuid + our hosted PDF copy).
-- ============================================================

create table if not exists public.contact_fiscal (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade unique,
  legal_name  text not null,   -- razón social (sin régimen societario, CFDI 4.0)
  rfc         text not null,
  tax_system  text not null,   -- régimen fiscal SAT (601, 612, 626…)
  zip         text not null,   -- CP del domicilio fiscal
  email       text,
  cfdi_use    text not null default 'G03',
  updated_at  timestamptz not null default now()
);
create index if not exists contact_fiscal_contact_idx on public.contact_fiscal (contact_id);
alter table public.contact_fiscal enable row level security;
drop policy if exists "members contact_fiscal" on public.contact_fiscal;
create policy "members contact_fiscal" on public.contact_fiscal
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  order_id         uuid not null references public.orders (id) on delete cascade,
  provider         text not null default 'facturapi',
  external_id      text,            -- Facturapi invoice id
  uuid             text,            -- folio fiscal (SAT)
  status           text not null default 'issued',
  total            numeric(12,2),
  verification_url text,
  pdf_url          text,            -- our hosted copy (media bucket)
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists invoices_order_idx on public.invoices (order_id);
alter table public.invoices enable row level security;
drop policy if exists "members invoices" on public.invoices;
create policy "members invoices" on public.invoices
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- Facturapi goes live.
update public.plugins set
  status = 'available',
  description = 'Emite facturas CFDI 4.0 desde cada pedido; guarda los datos fiscales de tus clientes y envía la factura por correo o WhatsApp.',
  config_schema = '[
    {"key":"api_key","label":"API Key (sk_live / sk_test)","type":"secret","required":true},
    {"key":"product_key","label":"Clave SAT de producto por defecto","type":"text","required":true}
  ]'::jsonb,
  guide = '[
    {"title":"Crea tu cuenta en Facturapi","body":"Regístrate en facturapi.io y completa el registro de tu organización.","url":"https://facturapi.io"},
    {"title":"Carga tus sellos CSD","body":"En el dashboard de Facturapi sube tus Certificados de Sello Digital del SAT (archivo .cer, .key y contraseña) para poder timbrar en modo Live."},
    {"title":"Copia tu API Key","body":"En Configuración → API Keys copia la llave. Usa la sk_test para probar (timbra en sandbox) y la sk_live para facturar de verdad. Pégala en Configurar."},
    {"title":"Define tu clave SAT por defecto","body":"En Configurar indica la clave de producto/servicio del SAT que describe lo que vendes (ej. 53102400). Se usa para todos los renglones de la factura."},
    {"title":"Factura desde el pedido","body":"Abre un pedido → bloque Factura (CFDI) → Emitir: captura o reutiliza los datos fiscales del cliente (quedan guardados), elige uso y forma de pago, y la factura queda timbrada con su folio, PDF y envío por correo o WhatsApp."}
  ]'::jsonb
where id = 'facturapi';
