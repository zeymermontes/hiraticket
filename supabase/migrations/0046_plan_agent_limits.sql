-- Agents per plan: Inicio 3, Pro 5, Negocio 10; each extra agent costs 250 MXN/mo.
-- (0003 seeded these with ON CONFLICT DO NOTHING, so update the existing rows here.)
update public.plans set limits = jsonb_set(limits, '{agents}', '3'::jsonb)  where id = 'inicio';
update public.plans set limits = jsonb_set(limits, '{agents}', '5'::jsonb)  where id = 'pro';
update public.plans set limits = jsonb_set(limits, '{agents}', '10'::jsonb) where id = 'negocio';
-- Price of each agent beyond the plan's included seats (same for every plan).
update public.plans set limits = jsonb_set(limits, '{extra_agent}', '250'::jsonb);

-- Keep the human-readable feature bullets in sync.
update public.plans set features = '["Chat + Pedidos","1 número de WhatsApp","3 agentes","Tablero Kanban"]'::jsonb where id = 'inicio';
update public.plans set features = '["Todo en Inicio","5 agentes","2 números","Automatizaciones","Reportes"]'::jsonb where id = 'pro';
update public.plans set features = '["Todo en Pro","10 agentes","5 números","Campañas","API"]'::jsonb where id = 'negocio';
