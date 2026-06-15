-- ============================================================
-- Hiraticket — internal chat media + forwarding (parity with the WhatsApp chat).
-- ============================================================

alter table public.internal_messages
  add column if not exists type       text not null default 'text',
  add column if not exists media_url  text,
  add column if not exists media_mime text,
  add column if not exists media_name text,
  add column if not exists forwarded  boolean not null default false;
