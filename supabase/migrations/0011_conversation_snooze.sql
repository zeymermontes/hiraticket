-- ============================================================
-- Hiraticket — hide + snooze conversations.
--   hidden        : keep a chat out of the active list until un-hidden
--   snoozed_until : postpone a chat; it returns to the active list when the
--                   time passes (or when the customer writes again).
-- ============================================================

alter table public.conversations
  add column if not exists hidden boolean not null default false;

alter table public.conversations
  add column if not exists snoozed_until timestamptz;
