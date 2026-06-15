-- ============================================================
-- Hiraticket — internal agent-to-agent chat: 1:1 DMs + one team channel per business.
--   channel = 'team'  → the shared team channel (all members)
--   channel = 'dm:<uuidA>:<uuidB>' (uuids sorted) → a private DM between two members
-- Privacy is enforced in RLS: a member reads 'team' plus any dm channel that contains their uid.
-- ============================================================

create table if not exists public.internal_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel     text not null,
  author_id   uuid references auth.users (id) on delete set null,
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists internal_messages_channel_idx on public.internal_messages (business_id, channel, created_at desc);

-- Per-member, per-channel read cursor (for unread counts + notifications).
create table if not exists public.internal_reads (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  channel      text not null,
  last_read_at timestamptz not null default now(),
  primary key (business_id, user_id, channel)
);

alter table public.internal_messages enable row level security;
alter table public.internal_reads    enable row level security;

drop policy if exists "read internal_messages" on public.internal_messages;
create policy "read internal_messages" on public.internal_messages
  for select using (public.is_business_member(business_id)
    and (channel = 'team' or channel like '%' || auth.uid()::text || '%'));

drop policy if exists "write internal_messages" on public.internal_messages;
create policy "write internal_messages" on public.internal_messages
  for insert with check (public.is_business_member(business_id) and author_id = auth.uid()
    and (channel = 'team' or channel like '%' || auth.uid()::text || '%'));

drop policy if exists "own internal_reads" on public.internal_reads;
create policy "own internal_reads" on public.internal_reads
  for all using (public.is_business_member(business_id) and user_id = auth.uid())
  with check (public.is_business_member(business_id) and user_id = auth.uid());

-- Realtime: stream inserts so the open thread + notifications update live.
alter table public.internal_messages replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'internal_messages'
  ) then
    alter publication supabase_realtime add table public.internal_messages;
  end if;
end $$;
