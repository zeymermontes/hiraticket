-- ============================================================
-- Hiraticket — per-product / per-subtask note on order line items.
--   Order-level notes already live in the `notes` table; this adds an optional note to each item.
-- ============================================================

alter table public.order_items add column if not exists note text;
