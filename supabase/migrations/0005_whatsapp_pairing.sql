-- ============================================================
-- Hiraticket — WhatsApp connection method (QR or pairing code).
-- Used by the Baileys worker.
-- ============================================================

alter table public.whatsapp_sessions
  add column if not exists connect_method text not null default 'qr'
  check (connect_method in ('qr', 'pairing'));

alter table public.whatsapp_sessions
  add column if not exists pairing_code text;
