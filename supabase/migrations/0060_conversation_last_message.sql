-- ============================================================
-- Hiraticket — preview del último mensaje denormalizado en conversations.
--
--   La lista de chats mostraba el preview embebiendo messages(...) SIN límite:
--   PostgREST devolvía TODOS los mensajes de TODAS las conversaciones del negocio
--   y el servidor reducía en JS para quedarse con el último de cada una. Además la
--   lista se refresca en cada evento realtime (incluido un simple acuse de entrega)
--   y por cada agente conectado, así que el costo era
--   O(mensajes_totales × eventos × agentes).
--
--   Estas columnas las mantiene un trigger, NO la app: hoy last_message_at se
--   escribe desde el worker de Go y desde varias server actions, y un writer nuevo
--   que se olvidara de actualizar el preview dejaría la lista desincronizada.
-- ============================================================

alter table public.conversations
  add column if not exists last_body    text,
  add column if not exists last_dir     text,
  add column if not exists last_state   text,
  add column if not exists last_type    text,
  add column if not exists last_deleted boolean not null default false;

-- Recalcula el último mensaje de la conversación afectada. Es un index scan
-- LIMIT 1 sobre messages_conv_created_idx (0026), así que sale barato por
-- escritura, y al recalcular (en vez de comparar contra NEW) queda correcto
-- también al editar, borrar o cambiar el estado de un mensaje.
create or replace function public.sync_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  m   record;
begin
  -- Rama explícita por TG_OP: en un DELETE la fila NEW no existe (y en un INSERT, OLD),
  -- así que un coalesce(new..., old...) dependería de cómo trate plpgsql el registro ausente.
  if tg_op = 'DELETE' then cid := old.conversation_id; else cid := new.conversation_id; end if;
  if cid is null then return null; end if;

  select body, direction, state, type, deleted
    into m
    from public.messages
   where conversation_id = cid
   order by created_at desc
   limit 1;

  -- El IS DISTINCT FROM evita escrituras (y eventos realtime) que no cambian nada:
  -- sin él, cada acuse de entrega despertaría a todos los clientes suscritos.
  update public.conversations c
     set last_body    = m.body,
         last_dir     = m.direction,
         last_state   = m.state,
         last_type    = coalesce(m.type, 'text'),
         last_deleted = coalesce(m.deleted, false)
   where c.id = cid
     and (c.last_body    is distinct from m.body
       or c.last_dir     is distinct from m.direction
       or c.last_state   is distinct from m.state
       or c.last_type    is distinct from coalesce(m.type, 'text')
       or c.last_deleted is distinct from coalesce(m.deleted, false));

  return null;
end $$;

drop trigger if exists messages_sync_conv_last on public.messages;
create trigger messages_sync_conv_last
  after insert or update or delete on public.messages
  for each row execute function public.sync_conversation_last_message();

-- Backfill de las conversaciones existentes (una pasada con DISTINCT ON).
update public.conversations c
   set last_body    = m.body,
       last_dir     = m.direction,
       last_state   = m.state,
       last_type    = coalesce(m.type, 'text'),
       last_deleted = coalesce(m.deleted, false)
  from (
    select distinct on (conversation_id)
           conversation_id, body, direction, state, type, deleted
      from public.messages
     order by conversation_id, created_at desc
  ) m
 where m.conversation_id = c.id;
