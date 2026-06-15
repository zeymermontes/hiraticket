-- ============================================================
-- Hiraticket — internal chat parity: replies, edit, delete, reactions (mirrors the WhatsApp chat).
-- ============================================================

alter table public.internal_messages
  add column if not exists reply_to  uuid references public.internal_messages (id) on delete set null,
  add column if not exists edited    boolean not null default false,
  add column if not exists deleted   boolean not null default false,
  add column if not exists reactions jsonb   not null default '[]'::jsonb;
