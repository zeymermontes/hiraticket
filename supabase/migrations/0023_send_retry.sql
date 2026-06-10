-- ============================================================
-- Hiraticket — outbound send auto-retry bookkeeping.
--   send_attempts : how many times the worker has tried to send this message
--   next_retry_at : earliest time the worker may retry (exponential backoff)
-- The worker also creates these columns on boot, so this migration is optional but keeps the
-- schema in source control.
-- ============================================================

alter table public.messages
  add column if not exists send_attempts int not null default 0,
  add column if not exists next_retry_at timestamptz;
