-- ============================================================
-- Hiraticket — "stop listening" to a chat: when muted, the worker drops incoming messages for that
-- conversation (they are NOT stored). The contact and existing history are kept.
-- ============================================================

alter table public.conversations add column if not exists muted boolean not null default false;
