-- ============================================================
-- Hiraticket — store the whatsmeow device JID per session, so the Go
-- worker can resume a number after a restart without a new QR.
-- (whatsmeow keeps the actual auth/keys in its own whatsmeow_* tables.)
-- ============================================================

alter table public.whatsapp_sessions
  add column if not exists device_jid text;
