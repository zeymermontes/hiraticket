-- ============================================================
-- Hiraticket — let an internal note target a specific subtask (order line item).
--   Notes still live under parent_type='order'/parent_id=orderId (so RLS + the existing
--   timeline fetch keep working); item_id NULL = order-level note, otherwise the subtask it
--   belongs to. This replaces capturing notes at subtask-creation time: notes are now authored
--   from the order's internal-notes section and filtered by All / Order / Subtasks.
-- ============================================================

alter table public.notes add column if not exists item_id uuid references public.order_items (id) on delete cascade;
