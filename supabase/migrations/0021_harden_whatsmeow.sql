-- ============================================================
-- Hiraticket — security hardening for whatsmeow's session tables.
--   whatsmeow's sqlstore creates whatsmeow_* tables in the public schema; they hold the
--   WhatsApp session/encryption keys. Without RLS they are reachable via Supabase's public
--   anon key. Enabling RLS with no policy denies the anon/authenticated API roles, while the
--   service-role worker (which bypasses RLS) keeps full access.
--
--   Run this AFTER the worker has started at least once (the whatsmeow_* tables must exist).
--   The worker also applies this automatically on every boot.
-- ============================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables
           where schemaname = 'public' and tablename like 'whatsmeow\_%'
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
