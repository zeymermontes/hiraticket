-- ============================================================
-- Hiraticket — name + tags on favorite stickers, so they can be labeled and searched.
-- ============================================================

alter table public.sticker_favorites add column if not exists name text;
alter table public.sticker_favorites add column if not exists tags text[] not null default '{}';
