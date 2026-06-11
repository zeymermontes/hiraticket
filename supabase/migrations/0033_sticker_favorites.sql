-- ============================================================
-- Hiraticket — favorite stickers (the send-sticker tray pins these on top).
--   A favorite points at a stored sticker WebP (media_url path) and a representative message to
--   re-send it from. One row per distinct sticker per business.
-- ============================================================

create table if not exists public.sticker_favorites (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  message_id  uuid not null references public.messages (id) on delete cascade,
  media_url   text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (business_id, media_url)
);
create index if not exists sticker_favorites_business_idx on public.sticker_favorites (business_id, created_at desc);

alter table public.sticker_favorites enable row level security;
drop policy if exists "members sticker_favorites" on public.sticker_favorites;
create policy "members sticker_favorites" on public.sticker_favorites
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
