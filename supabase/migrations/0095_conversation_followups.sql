-- ============================================================
-- Hiraticket — "mensaje en espera": lo que el agente deja redactado con la ventana de 24 h
-- cerrada, y que sale SOLO cuando el cliente responde (API oficial).
--
--   Con la ventana cerrada solo se puede iniciar con una plantilla. El agente manda la plantilla y
--   deja aquí el mensaje real (texto, archivos) para no tener que estar pendiente de cuándo
--   contesta el cliente. Al primer mensaje entrante, `release_followups` convierte cada fila
--   pendiente en un mensaje `queued` normal —- lo mandan cloud-outbox o el worker como cualquier
--   otro —- y la marca `sent_at`. Una vez liberada no vuelve a salir: la siguiente respuesta del
--   cliente no encuentra nada pendiente. No vive en `messages` a propósito: ahí dispararía la
--   vista previa de la lista y los despachadores antes de tiempo.
-- ============================================================

create table if not exists public.conversation_followups (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id       uuid,
  seq             int  not null default 0,
  type            text not null default 'text',
  body            text,                      -- cifrado (encm:v1), como messages.body
  media_url       text,
  media_mime      text,
  media_name      text,
  media_size      bigint,
  meta            jsonb,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists conversation_followups_pending_idx
  on public.conversation_followups (conversation_id) where sent_at is null;

alter table public.conversation_followups enable row level security;
drop policy if exists "members read" on public.conversation_followups;
drop policy if exists "members write ins" on public.conversation_followups;
drop policy if exists "members write upd" on public.conversation_followups;
drop policy if exists "members write del" on public.conversation_followups;
create policy "members read" on public.conversation_followups for select using (public.is_business_member(business_id));
create policy "members write ins" on public.conversation_followups for insert with check (public.is_business_writer(business_id));
create policy "members write upd" on public.conversation_followups for update using (public.is_business_writer(business_id)) with check (public.is_business_writer(business_id));
create policy "members write del" on public.conversation_followups for delete using (public.is_business_writer(business_id));

-- Libera lo pendiente de una conversación: cada fila se vuelve un mensaje saliente en cola, en el
-- orden en que se redactó (created_at escalonado por milisegundos para que el hilo lo respete).
-- Devuelve cuántos liberó. La llaman la ingesta oficial (Node) y el worker (Go) al recibir un
-- mensaje del cliente; con la llave de servicio, así que no pasa por RLS.
create or replace function public.release_followups(conv uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  with pending as (
    select * from public.conversation_followups
     where conversation_id = conv and sent_at is null
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

revoke all on function public.release_followups(uuid) from public;
grant execute on function public.release_followups(uuid) to service_role;
