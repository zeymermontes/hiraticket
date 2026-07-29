-- ============================================================
-- Hiraticket — los stickers favoritos pasan a ser de cada agente, no del negocio.
--
--   La columna created_by ya existía y ya se llenaba; lo que los hacía compartidos era la unicidad
--   (business_id, media_url): un sticker, una fila para todo el negocio. Al cambiarla por
--   (business_id, created_by, media_url), cada quien tiene su propia lista y nadie pisa la del otro.
--
--   Nadie pierde nada: cada favorito existente ya trae quién lo guardó, así que se queda con esa
--   persona. Las filas antiguas sin created_by (si las hay) se tratan como compartidas y las siguen
--   viendo todos, en vez de desaparecer sin dueño.
--
--   Dos índices únicos parciales en vez de UNIQUE NULLS NOT DISTINCT: eso último es de Postgres 15+
--   y así no dependemos de la versión del servidor.
-- ============================================================

alter table public.sticker_favorites drop constraint if exists sticker_favorites_business_id_media_url_key;

create unique index if not exists sticker_favorites_user_uq
  on public.sticker_favorites (business_id, created_by, media_url)
  where created_by is not null;

-- Legacy sin dueño: se conserva una sola fila por sticker y la ven todos.
create unique index if not exists sticker_favorites_legacy_uq
  on public.sticker_favorites (business_id, media_url)
  where created_by is null;

-- La bandeja lee "mis favoritos" en cada apertura del selector.
create index if not exists sticker_favorites_owner_idx
  on public.sticker_favorites (business_id, created_by, created_at desc);
