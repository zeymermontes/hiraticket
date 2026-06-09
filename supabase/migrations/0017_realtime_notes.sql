-- Add notes to the supabase_realtime publication so @mention toasts fire in real time.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
    ) then
      alter publication supabase_realtime add table public.notes;
    end if;
  end if;
end $$;

-- Ensure full row data is delivered on INSERT (needed to read body/parent in the client).
alter table public.notes replica identity full;
