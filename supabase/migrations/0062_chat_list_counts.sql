-- ============================================================
-- Hiraticket — contadores de la lista de chats en una sola consulta.
--
--   Las pestañas (Míos / Sin asignar), el badge de archivados y los 7 chips de
--   estado se calculaban en el cliente recorriendo la lista completa, que es
--   justamente lo que dejamos de mandar. Sacarlos como COUNTs sueltos serían ~10
--   round-trips por refresco — y la lista se refresca en cada evento realtime —,
--   así que van todos en un RPC con agregados FILTER: una consulta, un scan.
--
--   security invoker: las RLS de conversations siguen aplicando, el negocio se
--   filtra igual por parámetro.
-- ============================================================

create or replace function public.chat_list_counts(
  p_business uuid,
  p_me       uuid,
  p_area     uuid    default null,
  p_archived boolean default false,
  p_tab      text    default 'all'
)
returns json
language sql stable security invoker set search_path = public as $$
  with base as (
    select
      status, unread, assignee_id, area_id,
      (hidden or (snoozed_until is not null and snoozed_until > now()))              as archived,
      (last_message_at is not null and last_message_at < now() - interval '90 days') as stale
    from public.conversations
    where business_id = p_business
  ),
  -- Los chips se cuentan dentro de la pestaña y el área activas; el badge de
  -- archivados y los de pestaña se cuentan sobre todo el negocio (como antes).
  scoped as (
    select * from base
    where (p_tab is distinct from 'mine'       or assignee_id = p_me)
      and (p_tab is distinct from 'unassigned' or assignee_id is null)
      and (p_area is null or area_id = p_area)
  ),
  live as (
    select * from scoped where not stale and archived = p_archived
  )
  select json_build_object(
    'all',        (select count(*) from live),
    'active',     (select count(*) from live where status in ('open','pending')),
    'open',       (select count(*) from live where status = 'open'),
    'pending',    (select count(*) from live where status = 'pending'),
    'resolved',   (select count(*) from live where status = 'resolved'),
    'unread',     (select count(*) from live where unread > 0),
    'trash',      (select count(*) from scoped where stale),
    'archived',   (select count(*) from base where archived and not stale),
    'mine',       (select count(*) from base where assignee_id = p_me),
    'unassigned', (select count(*) from base
                    where assignee_id is null and not stale and not archived
                      and status in ('open','pending'))
  );
$$;

grant execute on function public.chat_list_counts(uuid, uuid, uuid, boolean, text) to authenticated;
