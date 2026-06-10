-- ============================================================
-- Hiraticket — typing indicator. The worker stamps an ~8s window here while the customer is
-- composing; the UI shows "escribiendo…" while typing_until is in the future (so it expires on
-- its own if updates stop).
-- ============================================================

alter table public.conversations add column if not exists typing_until timestamptz;
