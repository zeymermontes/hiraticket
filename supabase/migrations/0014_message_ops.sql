-- ============================================================
-- Hiraticket — reply / edit / delete for WhatsApp messages.
--   reply_to   : the message this one quotes
--   pending_op : 'edit' | 'delete' — picked up by the worker, then cleared
--   deleted    : true after a successful revoke (deleted for everyone)
-- ============================================================

alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists pending_op text;
alter table public.messages add column if not exists deleted boolean not null default false;
