-- ============================================================
-- Hiraticket — workspace mode.
--   'business'  → orders with products, prices, payments (default, current behavior)
--   'personal'  → tasks with subtasks (no money); orders=tasks, order_items=subtasks
-- Terminology + money UI key off this; the data model is shared.
-- ============================================================

alter table public.businesses add column if not exists mode text not null default 'business';
