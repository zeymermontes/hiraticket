-- ============================================================
-- Hiraticket — soft-delete orders/tasks (recoverable). Deleted rows are hidden from the table,
-- board, and chat; payments/history are preserved and the order can be restored or purged later.
-- ============================================================

alter table public.orders add column if not exists deleted_at timestamptz;
create index if not exists orders_deleted_idx on public.orders (business_id) where deleted_at is null;
