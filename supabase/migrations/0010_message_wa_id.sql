-- ============================================================
-- Hiraticket — store the WhatsApp message id so the worker can dedupe.
-- Lets us sync messages you send from your phone (fromMe) without
-- duplicating the ones the app itself sent.
-- ============================================================

alter table public.messages
  add column if not exists wa_id text;

create index if not exists idx_messages_wa
  on public.messages (business_id, wa_id);
