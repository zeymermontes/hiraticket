-- ============================================================
-- Hiraticket — WhatsApp oficial (Cloud API / coexistence).
-- Third connect method for whatsapp_sessions: 'official'. These sessions are
-- NOT handled by the whatsmeow worker (it filters them out); inbound arrives via
-- the Meta webhook and outbound is dispatched by the web app (cloud-outbox).
-- ============================================================

alter table public.whatsapp_sessions
  drop constraint if exists whatsapp_sessions_connect_method_check;
alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_connect_method_check
  check (connect_method in ('qr', 'pairing', 'official'));

alter table public.whatsapp_sessions
  add column if not exists waba_id text,
  add column if not exists phone_number_id text,
  -- Business token from Embedded Signup, encrypted with enc:v1 (src/lib/secrets.ts).
  add column if not exists cloud_token text;

-- The webhook routes every event by phone_number_id — one business per number.
create unique index if not exists idx_wa_sessions_phone_number_id
  on public.whatsapp_sessions (phone_number_id)
  where phone_number_id is not null;
