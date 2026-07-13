-- ============================================================
-- Hiraticket — per-order discount (amount or percentage, optional note).
--   discount:      resolved $ amount taken off the subtotal (tax applies after it).
--   discount_pct:  set only when the agent entered a percentage (kept for display).
--   discount_note: optional reason ("cliente frecuente", "promo", …).
--   Reports aggregate count/amount and attribute them to the order's assignee.
-- ============================================================

alter table public.orders add column if not exists discount      numeric(12,2) not null default 0;
alter table public.orders add column if not exists discount_pct  numeric(5,2);
alter table public.orders add column if not exists discount_note text;
