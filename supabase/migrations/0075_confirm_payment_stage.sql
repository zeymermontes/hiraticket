-- ============================================================
-- Hiraticket — confirmar pago al llegar a una etapa (0075).
--
--   Setting de negocio (no por pedido, a diferencia de done_from_stage_id/0072): a qué etapa,
--   sin importar cómo se llega ahí (kanban, drawer, cambio masivo en la tabla, o un flujo), se le
--   pregunta al agente si el pedido ya se debe marcar como pagado. null = la última etapa, mismo
--   default que done_from_stage_id.
--
--   Si un flujo (automations) está configurado con trigger_type='order_stage' apuntando
--   exactamente a esta etapa, su propio trigger_config.mark_paid (boolean, capturado en el editor
--   de Flujos) decide por adelantado y el popup interactivo no aparece — el flujo YA contestó la
--   pregunta. Sin un flujo así, se le pregunta a quien mueva el pedido.
-- ============================================================

alter table public.businesses add column if not exists confirm_payment_stage_id uuid references public.stages(id) on delete set null;
