-- ============================================================
-- Hiraticket — media: a public storage bucket + message media columns.
-- Inbound media is downloaded by the worker (service role) and stored here;
-- outbound media is uploaded by the app, then sent by the worker.
-- ============================================================

alter table public.messages add column if not exists media_mime text;
alter table public.messages add column if not exists media_name text;

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- public read (bucket is public) + authenticated upload
drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media auth upload" on storage.objects;
create policy "media auth upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
