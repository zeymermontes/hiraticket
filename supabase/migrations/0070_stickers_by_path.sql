-- ============================================================
-- Hiraticket — el sticker se identifica por su archivo, no por el mensaje del que salió.
--
--   `sticker_favorites.message_id` era `not null` y apuntaba a `messages`, la tabla de WhatsApp.
--   Eso ataba toda la biblioteca de stickers a WhatsApp: un sticker mandado en un chat interno vive
--   en `internal_messages`, no tiene fila en `messages`, y por lo tanto no se podía favoritear ni
--   en principio. La identidad real de un sticker es el archivo en storage (`media_url`), que las
--   dos tablas ya guardan igual.
--
--   Se conserva `message_id` porque sirve de rastro de dónde salió, pero deja de ser obligatorio.
--
--   Y de paso el `on delete cascade`: borrar el mensaje original de WhatsApp borraba el favorito en
--   silencio, aunque el archivo siguiera en storage y el sticker siguiera siendo perfectamente
--   usable. Pasa a `set null` — se pierde el rastro, no el favorito.
-- ============================================================

alter table public.sticker_favorites alter column message_id drop not null;

alter table public.sticker_favorites drop constraint if exists sticker_favorites_message_id_fkey;
alter table public.sticker_favorites
  add constraint sticker_favorites_message_id_fkey
  foreign key (message_id) references public.messages (id) on delete set null;

-- Los "recientes" de la bandeja ahora también leen los stickers de los chats internos.
create index if not exists internal_messages_sticker_idx
  on public.internal_messages (business_id, created_at desc)
  where type = 'sticker';
