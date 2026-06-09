-- ============================================================
-- Hiraticket — per-product (line-item) production stages.
--   order_items.stage_id   : the item's own pipeline stage (null = follows the order)
--   order_items.assignee_id: optional per-item owner
--   businesses.product_stages: opt-in flag. When true, each product tracks its own stage and
--     the order's stage becomes a rollup (least-advanced product gates the order).
-- ============================================================

alter table public.order_items add column if not exists stage_id uuid references public.stages (id) on delete set null;
alter table public.order_items add column if not exists assignee_id uuid references auth.users (id) on delete set null;
alter table public.businesses add column if not exists product_stages boolean not null default false;
