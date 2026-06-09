-- ============================================================
-- Hiraticket — message reactions (emoji).
--   reactions   : jsonb array of { emoji, by } ('agent' | 'contact') for display
--   react_emoji : the agent's outgoing reaction the worker should send (''=remove),
--                 paired with pending_op = 'react', then cleared by the worker.
-- ============================================================

alter table public.messages add column if not exists reactions jsonb not null default '[]'::jsonb;
alter table public.messages add column if not exists react_emoji text;
