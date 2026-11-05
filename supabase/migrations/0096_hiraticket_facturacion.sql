-- ============================================================
-- Hiraticket — plugin «Hiraticket Facturación» (CFDI 4.0 vía facturacion.hiraticket.com).
--
--   Desde el pedido: mandar un link para que el cliente se facture solo, o emitir la factura con
--   los datos fiscales ya guardados. Opcional: catálogo de productos sincronizado en los dos
--   sentidos con la cuenta de Facturación del negocio.
--
--   · plugins: alta de `hiraticket_facturacion`; Facturapi pasa a `legacy` (lo sigue viendo y
--     usando quien ya lo tiene instalado, pero ya no se ofrece a negocios nuevos).
--   · invoices: columnas para el link de autofactura y las ligas públicas del CFDI.
--   · products: claves SAT, IVA propio y el id del producto del otro lado.
--   · plugin_webhook_events: idempotencia de los webhooks entrantes (solo service role).
--
--   Idempotente: se puede correr dos veces.
-- ============================================================

insert into public.plugins (id, name, category, provider, description, icon, pricing, config_schema, guide, status, popular, position) values
 ('hiraticket_facturacion', 'Hiraticket Facturación (CFDI 4.0)', 'invoicing', 'Hiraticket',
  'Manda a tus clientes un link para que se facturen solos o emite la factura desde el pedido. Sincroniza tu catálogo con tu cuenta de Facturación. Los folios se compran aparte, en tu cuenta de Hiraticket Facturación.',
  '/plugins/hiraticket-facturacion.png',
  '{"model":"addon","addon_monthly":99}'::jsonb,
  '[]'::jsonb, '[]'::jsonb, 'available', true, 3)
on conflict (id) do nothing;

-- El esquema y la guía van en un UPDATE aparte para que volver a correr la migración los ponga
-- al día aunque la fila ya exista.
update public.plugins set
  config_schema = '[
    {"key":"api_key","label":"Llave de API (hf_live_… o hf_test_…)","type":"secret","required":true},
    {"key":"emisor","label":"RFC emisor","type":"text","help":"Déjalo vacío si tu cuenta de Facturación tiene un solo RFC: se llena solo."},
    {"key":"marca","label":"Id de la marca (opcional)","type":"text","help":"Solo si tu RFC tiene varias marcas en Facturación y quieres que las facturas salgan con una en particular."},
    {"key":"link_vigencia_dias","label":"Días de vigencia del link para facturar","type":"text","help":"30 si lo dejas vacío."},
    {"key":"sync_productos","label":"Sincronizar productos","type":"select","options":["off","push","pull","ambos"],
     "labels":{"off":"No sincronizar","push":"De Hiraticket a Facturación","pull":"De Facturación a Hiraticket","ambos":"En los dos sentidos"},
     "help":"Sincroniza nombre, precio, clave SAT, unidad e IVA. Si un producto cambia en los dos lados, gana el último que se guardó."},
    {"key":"auto_whatsapp","label":"Mandar la factura por WhatsApp cuando el cliente se facture","type":"toggle"}
  ]'::jsonb,
  guide = '[
    {"title":"Crea tu cuenta en Hiraticket Facturación","body":"Es una cuenta aparte de Hiraticket: ahí vive tu RFC, tus sellos y tus folios.","url":"https://facturacion.hiraticket.com"},
    {"title":"Da de alta tu RFC y tus sellos (CSD)","body":"En Emisores captura tu RFC y sube tu Certificado de Sello Digital del SAT (.cer, .key y contraseña). Los sellos solo se suben ahí, nunca desde Hiraticket.","url":"https://facturacion.hiraticket.com/dashboard/emisores"},
    {"title":"Compra folios","body":"Cada factura timbrada gasta un folio. Los folios se compran directo en tu cuenta de Hiraticket Facturación, no en Hiraticket: los $99 al mes de este plugin no incluyen folios. Sin folios, Hiraticket te avisa y no timbra.","url":"https://facturacion.hiraticket.com/dashboard/folios"},
    {"title":"Crea tu llave de API","body":"En API y webhooks crea una llave. La hf_live_ timbra de verdad; la hf_test_ es para practicar: no gasta folios ni manda correos. Se muestra una sola vez: cópiala.","url":"https://facturacion.hiraticket.com/dashboard/api"},
    {"title":"Pégala en Configurar","body":"Al guardar, Hiraticket valida la llave, llena tu RFC y registra solo el aviso (webhook) con el que se entera cuando un cliente se factura. Si tu cuenta ya mandaba avisos a otro sistema, te pregunta antes de reemplazarlo."},
    {"title":"Factura desde el pedido","body":"En el pedido, bloque Factura (CFDI): «Enviar link para facturar» le manda al cliente una liga para que capture sus datos y reciba su factura; «Emitir factura» la timbra tú con los datos fiscales del cliente. Si un producto cambia en los dos lados con la sincronización activa, gana el último que se guardó."}
  ]'::jsonb
where id = 'hiraticket_facturacion';

-- Facturapi: solo para quien ya lo tiene. La app esconde los `legacy` del catálogo salvo que el
-- negocio lo tenga instalado.
update public.plugins set status = 'legacy' where id = 'facturapi' and status = 'available';

-- Link de autofactura y ligas del CFDI.
--   status: 'issued' (default) | 'pending' (se mandó a timbrar y no se supo la respuesta: se
--   reintenta con la misma llave de idempotencia) | 'link_enviado' | 'vencido' | 'cancelada'.
alter table public.invoices add column if not exists link_code    text;        -- código del link (/f/ABC123)
alter table public.invoices add column if not exists link_url     text;
alter table public.invoices add column if not exists link_expires date;
alter table public.invoices add column if not exists public_url   text;        -- página pública de la factura
alter table public.invoices add column if not exists xml_url      text;
create unique index if not exists invoices_link_code_idx on public.invoices (business_id, link_code) where link_code is not null;
create index if not exists invoices_external_idx on public.invoices (business_id, external_id) where external_id is not null;

-- Productos: datos fiscales y enlace con el catálogo de Facturación.
alter table public.products add column if not exists facturacion_id text;         -- id del producto en Facturación
alter table public.products add column if not exists sat_code       text;         -- clave SAT de producto/servicio (8 dígitos)
alter table public.products add column if not exists sat_unit       text;         -- clave SAT de unidad
alter table public.products add column if not exists iva            numeric(6,4); -- 0 | 0.08 | 0.16; null = la tasa del negocio
alter table public.products add column if not exists synced_at      timestamptz;
create unique index if not exists products_facturacion_idx on public.products (business_id, facturacion_id) where facturacion_id is not null;

-- Idempotencia de webhooks entrantes. Solo la escribe y la lee el servidor con la llave de
-- servicio: RLS activado y SIN políticas, para que ningún usuario la vea ni la toque.
create table if not exists public.plugin_webhook_events (
  id          text not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  plugin_id   text not null,
  received_at timestamptz not null default now(),
  primary key (business_id, plugin_id, id)
);
alter table public.plugin_webhook_events enable row level security;
