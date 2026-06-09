-- ============================================================
-- Hiraticket — contact avatar + on-demand info refresh.
--   avatar_url      : WhatsApp profile picture URL (fetched by the worker)
--   fetch_requested : when set, the worker fetches name/photo then clears it
-- ============================================================

alter table public.contacts
  add column if not exists avatar_url text;

alter table public.contacts
  add column if not exists fetch_requested timestamptz;

-- live name/photo updates
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts'
     ) then
    alter publication supabase_realtime add table public.contacts;
  end if;
end$$;
