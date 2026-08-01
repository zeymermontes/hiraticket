-- ============================================================
-- Hiraticket — apagar la pregunta de "confirmar pago" (0076).
--
--   confirm_payment_stage_id (0075) ya elegía A QUÉ etapa preguntar; esto agrega si preguntar
--   siquiera. Default true (encendido) para no cambiarle el comportamiento a nadie que ya lo
--   tuviera configurado.
--
--   Solo apaga la pregunta al humano que mueve el pedido — un flujo (Flujos) que ya haya
--   contestado por adelantado (trigger_config.mark_paid) sigue aplicando: eso lo configuró la
--   persona a propósito, y apagar "que me pregunten" no debe romper una automatización que ya
--   armaron.
-- ============================================================

alter table public.businesses add column if not exists confirm_payment_enabled boolean not null default true;
