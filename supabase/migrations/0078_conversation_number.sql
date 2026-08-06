-- ============================================================
-- Hiraticket — cada conversación pertenece al número que la atendió.
--
--   Regla de producto: al conectar un número NUEVO, el chat no debe mostrar las
--   conversaciones del número anterior; desconectado, se conservan y se ven todas.
--   number_phone guarda el número del negocio ("+521...") dueño del hilo:
--     · el worker whatsmeow y la ingesta Cloud API lo estampan al crear/reusar;
--     · el worker "reclama" los hilos legacy (NULL) al conectar — continuidad
--       para los tenants whatsmeow existentes;
--     · el onboarding oficial NO reclama: número nuevo = bandeja limpia.
--   La lista y los contadores filtran por el número conectado (NULL de p_phone
--   = sin filtro, el comportamiento de siempre).
-- ============================================================

alter table public.conversations
  add column if not exists number_phone text;

create index if not exists idx_conversations_number_phone
  on public.conversations (business_id, number_phone);

-- Backfill: los tenants whatsmeow que están conectados AHORA conservan su lista tal
-- cual — sus hilos legacy quedan estampados con su número actual. Los negocios sin
-- sesión conectada (o con sesión oficial recién estrenada) quedan NULL: visibles
-- mientras estén desconectados, ocultos cuando conecte un número distinto.
update public.conversations c
   set number_phone = s.phone
  from public.whatsapp_sessions s
 where s.business_id = c.business_id
   and s.status = 'connected'
   and s.connect_method in ('qr', 'pairing')
   and s.phone is not null
   and c.number_phone is null;

-- chat_list_counts con el filtro por número (p_phone null = sin filtro). La firma vieja de 5
-- argumentos se elimina: convivir con la nueva (que tiene default) haría ambigua toda llamada
-- sin p_phone — incluida la del código ya desplegado.
drop function if exists public.chat_list_counts(uuid, uuid, uuid, boolean, text);
create or replace function public.chat_list_counts(
  p_business uuid,
  p_me       uuid,
  p_area     uuid    default null,
  p_archived boolean default false,
  p_tab      text    default 'all',
  p_phone    text    default null
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
      and (p_phone is null or number_phone = p_phone)
  ),
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

grant execute on function public.chat_list_counts(uuid, uuid, uuid, boolean, text, text) to authenticated;
