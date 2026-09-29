-- ============================================================
-- Hiraticket — fusionar contactos (y chats) duplicados por teléfono, y que no vuelva a pasar.
--
--   El bug: la ingesta de la API oficial buscaba el contacto por teléfono con .maybeSingle().
--   En cuanto había DOS contactos con el mismo teléfono (una carrera entre dos webhooks que
--   llegaron a la vez, o uno del worker viejo y otro de la API), PostgREST devolvía error y data
--   null, el código lo leía como "no existe", creaba OTRO contacto y con él OTRA conversación.
--   Desde ese momento, cada mensaje de ese cliente era un chat nuevo en la lista.
--
--   Qué hace, en orden:
--     1. Por cada (negocio, teléfono) con más de un contacto: se queda el más antiguo; los demás
--        le pasan sus conversaciones, pedidos, citas, direcciones, datos fiscales, notas y
--        etiquetas, y se borran. Si el que se queda tenía el teléfono como nombre y otro tenía
--        nombre real, adopta el nombre real.
--     2. Por cada (negocio, contacto, número del negocio) con más de una conversación ABIERTA
--        (las que creó el bug nunca se resolvieron): se queda la más antigua; las demás le pasan
--        sus mensajes, notas, eventos y pedidos, y se borran. Las resueltas no se tocan.
--     3. Índice único por (negocio, teléfono): desde aquí un segundo contacto con el mismo
--        teléfono es imposible, y la ingesta usa upsert.
-- ============================================================

do $$
declare
  merged_contacts int := 0;
  merged_convs    int := 0;
begin
  -- ---------- 1. contactos ----------
  create temporary table _cmap on commit drop as
  with ranked as (
    select id, business_id, phone, name, tags, avatar_url,
           row_number() over (partition by business_id, phone order by created_at, id) as rn,
           first_value(id) over (partition by business_id, phone order by created_at, id) as keep_id
      from public.contacts
     where coalesce(btrim(phone), '') <> '' and coalesce(is_group, false) = false
  )
  select id as drop_id, keep_id, name, tags, avatar_url from ranked where rn > 1;

  select count(*) into merged_contacts from _cmap;

  if merged_contacts > 0 then
    -- Nombre real por encima del teléfono-como-nombre; etiquetas y avatar se juntan.
    update public.contacts k
       set name = coalesce((select d.name from _cmap d where d.keep_id = k.id and d.name <> k.phone and d.name <> ltrim(k.phone, '+') and btrim(d.name) <> '' order by d.name limit 1), k.name),
           tags = (select coalesce(array_agg(distinct t), '{}') from (select unnest(k.tags) as t union select unnest(d.tags) from _cmap d where d.keep_id = k.id) x where t is not null),
           avatar_url = coalesce(k.avatar_url, (select d.avatar_url from _cmap d where d.keep_id = k.id and d.avatar_url is not null limit 1))
     where k.id in (select keep_id from _cmap)
       and (k.name = k.phone or k.name = ltrim(k.phone, '+') or exists (select 1 from _cmap d where d.keep_id = k.id));

    update public.conversations v set contact_id = m.keep_id from _cmap m where v.contact_id = m.drop_id;
    update public.orders o set contact_id = m.keep_id from _cmap m where o.contact_id = m.drop_id;
    update public.appointments a set contact_id = m.keep_id from _cmap m where a.contact_id = m.drop_id;
    update public.contact_addresses a set contact_id = m.keep_id from _cmap m where a.contact_id = m.drop_id;
    -- Datos fiscales: uno por contacto. Se mueven solo si el que se queda no tiene.
    update public.contact_fiscal f set contact_id = m.keep_id from _cmap m
     where f.contact_id = m.drop_id and not exists (select 1 from public.contact_fiscal k where k.contact_id = m.keep_id);
    delete from public.contact_fiscal f using _cmap m where f.contact_id = m.drop_id;
    update public.notes n set parent_id = m.keep_id from _cmap m where n.parent_type = 'contact' and n.parent_id = m.drop_id;
    delete from public.contacts c using _cmap m where c.id = m.drop_id;
  end if;

  -- ---------- 2. conversaciones abiertas duplicadas ----------
  create temporary table _vmap on commit drop as
  with ranked as (
    select id, business_id, contact_id, unread, last_message_at,
           row_number() over (partition by business_id, contact_id, coalesce(number_phone, '') order by created_at, id) as rn,
           first_value(id) over (partition by business_id, contact_id, coalesce(number_phone, '') order by created_at, id) as keep_id
      from public.conversations
     where status = 'open' and contact_id is not null and group_jid is null
  )
  select id as drop_id, keep_id, unread, last_message_at from ranked where rn > 1;

  select count(*) into merged_convs from _vmap;

  if merged_convs > 0 then
    update public.messages x set conversation_id = m.keep_id from _vmap m where x.conversation_id = m.drop_id;
    update public.orders o set conversation_id = m.keep_id from _vmap m where o.conversation_id = m.drop_id;
    update public.notes n set parent_id = m.keep_id from _vmap m where n.parent_type = 'conversation' and n.parent_id = m.drop_id;
    update public.events e set parent_id = m.keep_id from _vmap m where e.parent_type = 'conversation' and e.parent_id = m.drop_id;
    update public.conversations k
       set unread = k.unread + coalesce((select sum(d.unread) from _vmap d where d.keep_id = k.id), 0),
           last_message_at = greatest(k.last_message_at, (select max(d.last_message_at) from _vmap d where d.keep_id = k.id)),
           hidden = false
     where k.id in (select keep_id from _vmap);
    delete from public.conversations v using _vmap m where v.id = m.drop_id;
  end if;

  raise notice 'Contactos fusionados: %  |  conversaciones fusionadas: %', merged_contacts, merged_convs;
end $$;

-- ---------- 3. que no vuelva a pasar ----------
create unique index if not exists contacts_business_phone_uniq
  on public.contacts (business_id, phone)
  where phone is not null and phone <> '';
