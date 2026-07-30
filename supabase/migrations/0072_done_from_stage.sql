-- ============================================================
-- Hiraticket — desde qué etapa un pedido cuenta como terminado (fuera de la agenda y las banderitas).
--
--   Antes estaba clavado a "la última etapa". Ahora el negocio elige su default en Ajustes (p.ej.
--   "Listo": lo que ya está listo no necesita perseguirse aunque falte entregarlo), y cada pedido
--   puede sobreescribirlo desde su detalle — es lo que decide cuándo ESE pedido sale del calendario.
--
--   NULL = el comportamiento de siempre (la última etapa), así que nadie cambia sin tocar nada.
--   on delete set null: si borran la etapa elegida, se vuelve al default en vez de romperse.
-- ============================================================

alter table public.businesses add column if not exists done_from_stage_id uuid references public.stages(id) on delete set null;
alter table public.orders     add column if not exists done_from_stage_id uuid references public.stages(id) on delete set null;
