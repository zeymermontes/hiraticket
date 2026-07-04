-- ============================================================
-- Hiraticket — flat plugin activation fee.
--   Every plugin costs $99 MXN/month while ACTIVE (cancel/pause anytime → the charge stops).
--   pricing.addon_monthly now means "monthly activation fee" and applies to every pricing model;
--   metered/revshare stay as informational extras on top.
-- ============================================================

update public.plugins
   set pricing = jsonb_set(pricing, '{addon_monthly}', '99'::jsonb, true);

-- Reprice any existing ACTIVE installs so tenant MRR reflects the fee (paused/uninstalled = $0).
update public.business_plugins set mrr = 99 where status = 'active';

-- New shipping entry: Envíos Perros (Mexican multi-carrier aggregator). Mock for now (coming_soon),
-- same as Skydropx — the real integration is a later phase.
insert into public.plugins (id, name, category, provider, description, icon, pricing, config_schema, guide, status, popular, position) values
  ('enviosperros', 'Envíos Perros', 'shipping', 'Envíos Perros',
   'Genera guías de envío con las principales paqueterías a precio preferencial desde cada pedido.', 'send',
   '{"model":"addon","addon_monthly":99}'::jsonb,
   '[{"key":"api_key","label":"API Key","type":"secret","required":true}]'::jsonb,
   '[{"title":"Crea tu cuenta en Envíos Perros","body":"Regístrate y verifica tu cuenta para acceder al API.","url":"https://enviosperros.com"},{"title":"Copia tu API Key","body":"En tu panel ve a la sección de integraciones/API y copia tu llave. Pégala en Configurar."}]'::jsonb,
   'coming_soon', false, 5)
on conflict (id) do nothing;
