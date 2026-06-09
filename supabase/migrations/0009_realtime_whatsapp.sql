-- ============================================================
-- Hiraticket — live WhatsApp status: publish whatsapp_sessions to Realtime so
-- the Settings screen reflects connect/QR/connected/disconnected immediately.
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_sessions'
     ) then
    alter publication supabase_realtime add table public.whatsapp_sessions;
  end if;
end$$;
