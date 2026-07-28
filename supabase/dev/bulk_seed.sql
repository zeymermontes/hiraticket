-- ============================================================
-- SOLO DESARROLLO — datos de volumen para medir las optimizaciones.
--
--   NO es una migración y NO es seed.sql: se corre a mano y nunca toca
--   producción. Genera el orden de magnitud donde las listas empezaban a
--   arrastrarse, para poder comparar antes/después de verdad.
--
--   Correr:
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--       -f supabase/dev/bulk_seed.sql
--
--   Limpiar (deja el negocio y tu usuario):
--     -f supabase/dev/bulk_clean.sql
--
--   Los cuerpos van en texto plano a propósito: decryptBody() deja pasar el
--   legacy sin cifrar, así se leen bien en la UI sin depender de la llave local.
-- ============================================================
\set ON_ERROR_STOP on

\timing on

do $$
declare
  biz        uuid;
  me         uuid;
  stage_ids  uuid[];
  area_ids   uuid[];
  n_contacts int := 2000;   -- contactos = conversaciones
  n_msgs     int := 100;    -- mensajes por conversación  → 200k mensajes
  n_orders   int := 5000;
begin
  select id into biz from businesses order by created_at limit 1;
  if biz is null then
    raise exception 'No hay ningún negocio. Termina el onboarding en la app primero.';
  end if;
  select user_id into me from business_members where business_id = biz limit 1;

  select array_agg(id order by position) into stage_ids from stages where business_id = biz;
  select array_agg(id order by name)     into area_ids  from areas  where business_id = biz;

  raise notice 'Sembrando en negocio % (agente %)', biz, me;

  -- El trigger de 0060 recalcula el preview por CADA fila; con 200k inserts eso
  -- son 200k updates sobre conversations. Se apaga durante la carga y al final
  -- se corre el mismo backfill de la migración, que hace lo propio de una vez.
  alter table public.messages disable trigger messages_sync_conv_last;

  ---------------------------------------------------------------- contactos
  insert into contacts (business_id, name, phone, tags, created_at)
  select biz,
         'Cliente ' || i,
         '+52155' || lpad(i::text, 7, '0'),
         case when i % 7 = 0 then array['vip'] when i % 11 = 0 then array['mayoreo'] else '{}'::text[] end,
         now() - (random() * 365) * interval '1 day'
  from generate_series(1, n_contacts) i;
  raise notice '  contactos: %', n_contacts;

  ---------------------------------------------------------------- conversaciones
  -- Repartidas en 180 días para que unas caigan en papelera (90+ días), unas en
  -- archivados (hidden/snoozed) y el resto en la lista viva.
  insert into conversations (business_id, contact_id, status, assignee_id, area_id,
                             unread, last_message_at, hidden, snoozed_until, created_at)
  select biz,
         c.id,
         (array['open','open','pending','resolved'])[1 + (c.rn % 4)],
         case when c.rn % 3 = 0 then me else null end,
         area_ids[1 + (c.rn % array_length(area_ids, 1))],
         case when c.rn % 5 = 0 then 1 + (c.rn % 4) else 0 end,
         now() - (c.rn % 180) * interval '1 day',
         (c.rn % 23 = 0),
         case when c.rn % 31 = 0 then now() + interval '2 days' else null end,
         c.created_at
  from (select id, created_at, row_number() over (order by id) as rn from contacts where business_id = biz) c;
  raise notice '  conversaciones: %', n_contacts;

  ---------------------------------------------------------------- mensajes
  insert into messages (business_id, conversation_id, direction, type, body, state, created_at)
  select biz,
         cv.id,
         case when g % 3 = 0 then 'out' else 'in' end,
         'text',
         'Mensaje ' || g || ' de la conversación — ' || substr(md5(cv.id::text || g::text), 1, 24),
         case when g % 3 = 0 then 'read' else 'delivered' end,
         cv.last_message_at - (g * interval '13 minutes')
  from conversations cv, generate_series(1, n_msgs) g
  where cv.business_id = biz;
  raise notice '  mensajes: %', n_contacts * n_msgs;

  ---------------------------------------------------------------- pedidos
  insert into orders (business_id, code, contact_id, conversation_id, stage_id, area_id,
                      assignee_id, priority, pay_status, total, due_at, created_at, updated_at)
  select biz,
         'HIR-' || (1000 + o.i),
         c.id,
         cv.id,
         stage_ids[1 + (o.i % array_length(stage_ids, 1))],
         area_ids[1 + (o.i % array_length(area_ids, 1))],
         case when o.i % 4 = 0 then me else null end,
         (array['low','normal','normal','high','urgent'])[1 + (o.i % 5)],
         (array['pending','partial','paid'])[1 + (o.i % 3)],
         round((150 + random() * 8000)::numeric, 2),
         case when o.i % 6 = 0 then now() + ((o.i % 20) - 8) * interval '1 day' else null end,
         now() - (o.i % 300) * interval '1 day',
         now() - (o.i % 120) * interval '1 day'
  from generate_series(1, n_orders) o(i)
  join lateral (
    select id from contacts where business_id = biz offset (o.i % n_contacts) limit 1
  ) c on true
  left join lateral (
    select id from conversations where contact_id = c.id limit 1
  ) cv on true;
  raise notice '  pedidos: %', n_orders;

  ---------------------------------------------------------------- líneas de pedido
  insert into order_items (order_id, name, qty, unit_price, subtotal, stage_id)
  select o.id,
         (array['Playeras DTF','Lonas 2x1','Tarjetas 500pz','Stickers troquelados',
                'Vinil de corte','Banner rollup','Tazas sublimadas','Gorras bordadas'])[1 + ((o.rn + g) % 8)],
         1 + ((o.rn + g) % 5),
         round((80 + random() * 900)::numeric, 2),
         round((80 + random() * 900)::numeric, 2),
         stage_ids[1 + ((o.rn + g) % array_length(stage_ids, 1))]
  from (select id, row_number() over (order by id) as rn from orders where business_id = biz) o,
       generate_series(1, 3) g
  where (o.rn + g) % 4 <> 0;   -- entre 2 y 3 líneas por pedido
  raise notice '  líneas de pedido: %', (select count(*) from order_items oi join orders o on o.id = oi.order_id where o.business_id = biz);

  ---------------------------------------------------------------- notas y eventos
  -- Las dos tablas que no tenían ningún índice antes de 0059.
  insert into notes (business_id, parent_type, parent_id, author_id, body, created_at)
  select biz, 'conversation', cv.id, me, 'Nota interna de seguimiento #' || g, cv.last_message_at - interval '1 hour'
  from (select id, last_message_at, row_number() over (order by id) rn from conversations where business_id = biz) cv,
       generate_series(1, 2) g
  where cv.rn % 3 = 0;

  insert into notes (business_id, parent_type, parent_id, author_id, body, created_at)
  select biz, 'order', o.id, me, 'Observación del pedido #' || o.rn, o.created_at
  from (select id, created_at, row_number() over (order by id) rn from orders where business_id = biz) o
  where o.rn % 3 = 0;

  insert into events (business_id, parent_type, parent_id, actor_id, kind, text, created_at)
  select biz, 'conversation', cv.id, me,
         (array['status','assign','area'])[1 + (cv.rn % 3)],
         'Cambio automático de prueba', cv.last_message_at - interval '2 hours'
  from (select id, last_message_at, row_number() over (order by id) rn from conversations where business_id = biz) cv;

  insert into events (business_id, parent_type, parent_id, actor_id, kind, text, created_at)
  select biz, 'order', o.id, me, 'stage', 'Movido de etapa', o.updated_at
  from (select id, updated_at from orders where business_id = biz) o;
  raise notice '  notas: %  eventos: %',
    (select count(*) from notes where business_id = biz),
    (select count(*) from events where business_id = biz);

  ---------------------------------------------------------------- cerrar
  alter table public.messages enable trigger messages_sync_conv_last;

  -- Mismo backfill que la migración 0060, una sola pasada con DISTINCT ON.
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
  raise notice '  preview del último mensaje recalculado';
end $$;

-- Sin esto el planner sigue creyendo que las tablas están vacías y no usa los
-- índices de 0059 — o sea, mediría cualquier cosa menos lo que queremos medir.
analyze;

select 'contactos'      as tabla, count(*) from contacts
union all select 'conversaciones', count(*) from conversations
union all select 'mensajes',       count(*) from messages
union all select 'pedidos',        count(*) from orders
union all select 'líneas',         count(*) from order_items
union all select 'notas',          count(*) from notes
union all select 'eventos',        count(*) from events;
