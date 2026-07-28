-- ============================================================
-- Hiraticket — índices para las rutas calientes.
--
--   Postgres NO indexa las foreign keys automáticamente. Varias tablas que se
--   consultan en cada apertura de chat / pedido no tenían ningún índice, así que
--   esas lecturas eran seq scans que crecen linealmente con el histórico del
--   negocio: la app se siente más lenta conforme se acumulan conversaciones y
--   pedidos, aunque cada pantalla muestre lo mismo de siempre.
--
--   Nota de despliegue: se crean dentro de la transacción de la migración (sin
--   CONCURRENTLY, que no puede correr en una), así que bloquean escrituras en
--   cada tabla mientras se construyen. A escala actual son segundos; si alguna
--   tabla crece mucho, córrelas a mano con CONCURRENTLY fuera de la migración.
-- ============================================================

-- ILIKE '%texto%' no puede usar un btree — el buscador global necesita trigramas.
create extension if not exists pg_trgm;

-- ---------- notes / events ----------
-- Sin ningún índice hasta ahora. Se leen por (parent_type, parent_id) en CADA
-- apertura de conversación (chat.ts) y de pedido (orders.ts).
create index if not exists notes_parent_idx
  on public.notes (parent_type, parent_id, created_at);

create index if not exists events_parent_idx
  on public.events (parent_type, parent_id, created_at desc);

-- Feed de menciones del campanita: business_id + ILIKE body + orden por fecha.
create index if not exists notes_business_created_idx
  on public.notes (business_id, created_at desc);

-- ---------- order_items ----------
-- order_id alimenta tanto el embed de la lista de pedidos como la subconsulta
-- RLS de "members order_items" (0001), que se evalúa por fila.
create index if not exists order_items_order_idx
  on public.order_items (order_id);

-- Buscador global: .ilike("name", '%q%') sobre toda la tabla.
create index if not exists order_items_name_trgm_idx
  on public.order_items using gin (name gin_trgm_ops);

-- ---------- contacts ----------
create index if not exists contacts_business_name_idx
  on public.contacts (business_id, name);

-- Buscador global por nombre / teléfono.
create index if not exists contacts_name_trgm_idx
  on public.contacts using gin (name gin_trgm_ops);
create index if not exists contacts_phone_trgm_idx
  on public.contacts using gin (phone gin_trgm_ops);

-- ---------- orders ----------
-- Tarjetas de pedidos del cliente en cada apertura de chat (chat.ts).
create index if not exists orders_contact_idx
  on public.orders (contact_id);

-- La lista de pedidos ordena por updated_at desc y descarta los borrados.
create index if not exists orders_business_updated_idx
  on public.orders (business_id, updated_at desc)
  where deleted_at is null;

-- ---------- conversations ----------
-- La lista de chats ordena por last_message_at desc.
create index if not exists conversations_business_last_msg_idx
  on public.conversations (business_id, last_message_at desc);

-- Badges de navegación: "míos con no leídos" y "sin asignar".
create index if not exists conversations_unread_idx
  on public.conversations (business_id, assignee_id)
  where unread > 0;

create index if not exists conversations_unassigned_idx
  on public.conversations (business_id)
  where assignee_id is null;

-- ---------- messages ----------
-- Bandeja de stickers: los más recientes del negocio. Parcial para que el índice
-- se mantenga chico aunque messages sea la tabla más grande.
create index if not exists messages_stickers_idx
  on public.messages (business_id, created_at desc)
  where type = 'sticker';

-- ---------- internal_messages ----------
-- El feed de notificaciones lee por negocio + fecha, sin filtrar canal (el índice
-- de 0036 lleva channel en medio, así que no sirve para este orden).
create index if not exists internal_messages_business_created_idx
  on public.internal_messages (business_id, created_at desc);
