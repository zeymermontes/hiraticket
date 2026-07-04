-- ============================================================
-- Hiraticket — real brand logos in the plugin catalogue.
--   plugins.icon now accepts an image path (served from /public/plugins/) besides an Icon name.
--   Webhooks keeps its icon (first-party feature, not a brand).
-- ============================================================

update public.plugins set icon = '/plugins/mercadopago.png'  where id = 'mercadopago';
update public.plugins set icon = '/plugins/facturapi.png'    where id = 'facturapi';
update public.plugins set icon = '/plugins/skydropx.png'     where id = 'skydropx';
update public.plugins set icon = '/plugins/enviosperros.png' where id = 'enviosperros';
