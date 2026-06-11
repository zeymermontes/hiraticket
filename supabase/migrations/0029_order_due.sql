-- ============================================================
-- Hiraticket — deadline (due date) for orders/tasks.
--   due_at: when the order/task is due. Past + not completed = overdue (computed in the UI).
-- ============================================================

alter table public.orders add column if not exists due_at timestamptz;
create index if not exists orders_due_idx on public.orders (business_id, due_at);
