-- ============================================================
-- Hiraticket — mensajes programados: el agente elige a qué hora sale un mensaje (a un chat o a
-- varios a la vez).
--
--   Reusa `conversation_followups` (0095): una fila con `send_at` es un mensaje programado y sale a
--   esa hora; una fila sin `send_at` sigue siendo el «mensaje en espera» que sale cuando el cliente
--   responde. Las dos viven fuera de `messages` por la misma razón: ahí dispararían la vista previa
--   de la lista y los despachadores antes de tiempo.
--
--   `release_due_followups()` la llama el worker cada 10 segundos. Por cada negocio libera UNA sola
--   conversación por llamada (la que lleva más tiempo vencida): así, cuando se programa lo mismo a
--   muchos chats, salen uno tras otro con 10 segundos entre cada uno, en vez de cincuenta mensajes
--   en el mismo segundo que WhatsApp lee como spam. El mensaje liberado es un `queued` normal: lo
--   manda el worker (QR) o cloud-outbox (API oficial, avisado por el worker vía /api/outbox/flush).
-- ============================================================

alter table public.conversation_followups add column if not exists send_at timestamptz;

create index if not exists conversation_followups_due_idx
  on public.conversation_followups (send_at) where sent_at is null and send_at is not null;

-- Lo que sale cuando el cliente responde: SOLO lo que no tiene hora. Un mensaje programado espera
-- su hora aunque el cliente escriba antes.
create or replace function public.release_followups(conv uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  with pending as (
    select * from public.conversation_followups
     where conversation_id = conv and sent_at is null and send_at is null
     order by seq, created_at
     for update skip locked
  ), ins as (
    insert into public.messages (business_id, conversation_id, direction, type, body, state, author_id,
                                 media_url, media_mime, media_name, media_size, meta, created_at)
    select business_id, conversation_id, 'out', type, body, 'queued', author_id,
           media_url, media_mime, media_name, media_size, meta,
           now() + (row_number() over (order by seq, created_at)) * interval '1 millisecond'
      from pending
    returning 1
  ), done as (
    update public.conversation_followups f set sent_at = now()
      from pending p where f.id = p.id
    returning 1
  )
  select count(*) into n from done;
  if n > 0 then
    update public.conversations set last_message_at = now() where id = conv;
  end if;
  return n;
end $$;

-- Libera los programados cuya hora ya llegó: una conversación por negocio por llamada (ver arriba).
-- Devuelve (negocio, conversación) de cada una liberada, para que el worker avise a la app.
create or replace function public.release_due_followups()
returns table (biz uuid, conv uuid)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int;
begin
  for r in
    select distinct on (f.business_id) f.business_id, f.conversation_id
      from public.conversation_followups f
     where f.sent_at is null and f.send_at is not null and f.send_at <= now()
     order by f.business_id, f.send_at, f.created_at
  loop
    with pending as (
      select * from public.conversation_followups
       where conversation_id = r.conversation_id and sent_at is null and send_at is not null and send_at <= now()
       order by seq, created_at
       for update skip locked
    ), ins as (
      insert into public.messages (business_id, conversation_id, direction, type, body, state, author_id,
                                   media_url, media_mime, media_name, media_size, meta, created_at)
      select business_id, conversation_id, 'out', type, body, 'queued', author_id,
             media_url, media_mime, media_name, media_size, meta,
             now() + (row_number() over (order by seq, created_at)) * interval '1 millisecond'
        from pending
      returning 1
    ), done as (
      update public.conversation_followups f set sent_at = now()
        from pending p where f.id = p.id
      returning 1
    )
    select count(*) into n from done;
    if n > 0 then
      update public.conversations set last_message_at = now() where id = r.conversation_id;
      biz := r.business_id; conv := r.conversation_id;
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.release_due_followups() from public;
grant execute on function public.release_due_followups() to service_role;
