-- ============================================================
-- SOLO DESARROLLO — datos de DEMOSTRACIÓN, para poder MIRAR la app.
--
--   Hermano de `bulk_seed.sql`, con otro propósito y por eso va aparte:
--     · bulk_seed  → 2000 contactos y 200k mensajes de relleno ("Mensaje 42 — a3f9…").
--                    Sirve para MEDIR si las listas se arrastran. Con eso no se puede juzgar si
--                    una burbuja o una tarjeta se ven bien: es ruido, y encima deja la base local
--                    lenta para navegar.
--     · demo_seed  → poco volumen y contenido REAL: nombres, conversaciones que se leen, pedidos
--                    con productos de verdad y totales que cuadran. Sirve para REVISAR la interfaz
--                    —- sobre todo en móvil, donde el problema casi siempre es el texto largo.
--
--   Correr:
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/dev/demo_seed.sql
--   Limpiar: supabase/dev/bulk_clean.sql (deja el negocio y tu usuario).
--
--   Los cuerpos van en TEXTO PLANO a propósito: decryptBody() deja pasar lo heredado sin cifrar,
--   así se leen en la UI sin depender de la llave local.
--
--   Es idempotente: borra lo que sembró antes (por el prefijo del código de pedido y por teléfono)
--   y vuelve a sembrar, para poder correrlo las veces que haga falta mientras se ajusta la UI.
-- ============================================================
\set ON_ERROR_STOP on

do $$
declare
  biz  uuid;
  me   uuid;
  st   uuid[];   -- etapas por posición
  ar   uuid[];   -- áreas por nombre
  conv jsonb;
  c_id uuid;
  v_id uuid;
  o_id uuid;
  msg  jsonb;
  i    int;
  n    int;
  base timestamptz;
  tot  numeric;
begin
  select id into biz from businesses order by created_at limit 1;
  if biz is null then raise exception 'No hay negocio. Termina el onboarding en la app primero.'; end if;
  select user_id into me from business_members where business_id = biz limit 1;

  select array_agg(id order by position) into st from stages where business_id = biz;
  select array_agg(id order by name)     into ar from areas  where business_id = biz;
  if st is null or ar is null then raise exception 'Faltan etapas o áreas en el negocio.'; end if;

  -- ---------------------------------------------------------------- limpieza de lo sembrado antes
  delete from order_items where order_id in (select id from orders where business_id = biz and code like 'HIR-9%');
  delete from payments    where order_id in (select id from orders where business_id = biz and code like 'HIR-9%');
  delete from orders      where business_id = biz and code like 'HIR-9%';
  delete from messages    where conversation_id in (select id from conversations where contact_id in (select id from contacts where business_id = biz and phone like '+52661%'));
  delete from conversations where contact_id in (select id from contacts where business_id = biz and phone like '+52661%');
  delete from contacts    where business_id = biz and phone like '+52661%';
  delete from internal_messages where business_id = biz and body like '[demo]%';
  -- `on conflict do nothing` no sirve aquí: no hay restricción única sobre (business_id, name), así
  -- que sin este borrado cada corrida duplicaba el catálogo.
  delete from products where business_id = biz and name in (
    'Playeras DTF (paquete 50)','Lona impresa 2×1 m','Tarjetas de presentación 500 pz',
    'Stickers troquelados 5×5 cm (500)','Vinil de corte por metro','Banner roll-up 85×200',
    'Tazas sublimadas (docena)','Gorras bordadas (docena)','Diseño de logotipo','Instalación en sitio');
  delete from appointments where business_id = biz and title like '[demo]%';

  ---------------------------------------------------------------- catálogo
  insert into products (business_id, name, kind, price, cost, active) values
    (biz, 'Playeras DTF (paquete 50)', 'product', 4500, 2100, true),
    (biz, 'Lona impresa 2×1 m',        'product', 780,  310,  true),
    (biz, 'Tarjetas de presentación 500 pz', 'product', 950, 420, true),
    (biz, 'Stickers troquelados 5×5 cm (500)', 'product', 1450, 640, true),
    (biz, 'Vinil de corte por metro',  'product', 220,  95,   true),
    (biz, 'Banner roll-up 85×200',     'product', 1650, 820,  true),
    (biz, 'Tazas sublimadas (docena)', 'product', 1080, 480,  true),
    (biz, 'Gorras bordadas (docena)',  'product', 2400, 1150, true),
    (biz, 'Diseño de logotipo',        'service', 3500, 0,    true),
    (biz, 'Instalación en sitio',      'service', 1200, 400,  true);

  ---------------------------------------------------------------- etiquetas del catálogo
  insert into tags (business_id, name) values (biz,'vip'), (biz,'mayoreo'), (biz,'frecuente'), (biz,'moroso')
  on conflict do nothing;

  ---------------------------------------------------------------- conversaciones con contenido real
  -- Cada entrada trae su hilo escrito. `ago` son minutos desde el último mensaje, para que la lista
  -- muestre "ahora / 2h / ayer / 3d" y se pueda ver cómo se ordena y cómo se ve el reloj.
  for conv in select * from jsonb_array_elements($json$[
    {"name":"Lucía Fernández","phone":"+526611000001","tags":["vip"],"status":"open","mine":true,"unread":2,"ago":4,
     "msgs":[["in","Hola! ¿Hacen stickers troquelados holográficos?"],
             ["out","¡Hola Lucía! Sí 😊 holográfico, mate y transparente. ¿Qué tamaño y cantidad?"],
             ["in","Algo así, 5×5cm, 500 piezas"],
             ["out","Van 500 troquelados holográficos 5×5 cm = $1,450 MXN, listos en 4 días hábiles."],
             ["in","Perfecto, mándame la cotización 🙏"],
             ["out","Te la mando ahorita. ¿Te sirve que te la deje también en PDF?"],
             ["in","Sí porfa"],
             ["in","Y una pregunta, ¿tienen envío a Mazatlán?"]]},
    {"name":"Tacos El Güero","phone":"+526611000002","tags":["frecuente"],"status":"open","mine":true,"unread":0,"ago":95,
     "msgs":[["in","Buenas, necesito otra lona igual a la del año pasado"],
             ["out","¡Claro! La de 2×1 con el logo amarillo, ¿verdad?"],
             ["in","Esa mera, pero ahora con el teléfono nuevo"],
             ["out","Va. Mándame el número y te paso la prueba hoy mismo."],
             ["in","6691234567"],
             ["out","Listo, ya quedó en diseño. Te la enseño antes de imprimir."]]},
    {"name":"Pablo Reséndiz","phone":"+526611000003","tags":[],"status":"pending","mine":false,"unread":1,"ago":190,
     "msgs":[["in","Hola, quiero cotizar 12 gorras bordadas"],
             ["out","Con gusto. ¿Bordado en frente nada más o también en un lado?"],
             ["in","Frente y lado izquierdo"],
             ["in","¿Cuánto sale y para cuándo?"]]},
    {"name":"Boutique Lunaria","phone":"+526611000004","tags":["mayoreo","vip"],"status":"open","mine":false,"unread":3,"ago":22,
     "msgs":[["in","Buen día, somos Lunaria. Manejamos pedidos grandes de playeras."],
             ["out","¡Bienvenidas! Manejamos DTF en paquete de 50 con precio de mayoreo."],
             ["in","Necesitamos 300 para el 15"],
             ["in","¿Nos hacen precio?"],
             ["in","Quedamos de confirmar hoy porque ya nos urge"]]},
    {"name":"Carlos Medina","phone":"+526611000005","tags":[],"status":"resolved","mine":true,"unread":0,"ago":2880,
     "msgs":[["in","¿Ya está mi roll-up?"],
             ["out","Sí Carlos, quedó ayer. Puedes pasar por él cuando gustes."],
             ["in","Voy saliendo, gracias!"],
             ["out","Aquí te esperamos 👍"]]},
    {"name":"Ana Sofía Torres","phone":"+526611000006","tags":["frecuente"],"status":"open","mine":false,"unread":0,"ago":460,
     "msgs":[["in","Hola, ¿cuánto cuesta el diseño de logotipo?"],
             ["out","El diseño de logotipo sale en $3,500 e incluye 3 propuestas y 2 rondas de cambios."],
             ["in","¿Y me entregan los archivos editables?"],
             ["out","Sí, te entregamos AI, SVG, PNG y PDF, más una guía de uso."],
             ["in","Suena bien, déjame consultarlo y te digo"]]},
    {"name":"Ferretería San Juan","phone":"+526611000007","tags":["mayoreo"],"status":"open","mine":true,"unread":0,"ago":1440,
     "msgs":[["in","Necesitamos 20 lonas para las sucursales"],
             ["out","¿Del mismo tamaño las 20?"],
             ["in","15 de 2×1 y 5 de 3×2"],
             ["out","Te preparo la cotización con precio por volumen. ¿A qué correo la mando?"],
             ["in","compras@ferresanjuan.mx"],
             ["out","Enviada. Cualquier duda aquí estoy."]]},
    {"name":"Mariana Ochoa","phone":"+526611000008","tags":[],"status":"pending","mine":false,"unread":1,"ago":38,
     "msgs":[["in","¿Trabajan los sábados?"],
             ["out","Sí, sábados de 9 a 2."],
             ["in","Perfecto, paso el sábado a ver muestras de vinil"]]},
    {"name":"Escuela Benito Juárez","phone":"+526611000009","tags":["frecuente"],"status":"open","mine":false,"unread":0,"ago":720,
     "msgs":[["in","Buenos días, necesitamos playeras para el festival"],
             ["out","¡Con gusto! ¿Cuántas y de qué tallas?"],
             ["in","120, mezcladas de niño y adulto"],
             ["out","Perfecto. Te paso el desglose por talla para que lo revises."]]},
    {"name":"Jorge Villalobos","phone":"+526611000010","tags":["moroso"],"status":"open","mine":true,"unread":0,"ago":4320,
     "msgs":[["out","Jorge, buen día. Te recuerdo el saldo pendiente del pedido HIR-9004."],
             ["in","Sí, disculpa. Esta semana lo liquido."],
             ["out","Sin problema, quedo al pendiente."]]},
    {"name":"Cafetería Milagro","phone":"+526611000011","tags":[],"status":"open","mine":false,"unread":2,"ago":11,
     "msgs":[["in","Hola! Vi sus tazas sublimadas"],
             ["out","¡Hola! Sí, las manejamos por docena a $1,080."],
             ["in","¿Aguantan lavavajillas?"],
             ["in","Es que las usaríamos a diario en la cafetería"]]},
    {"name":"Rodrigo Paredes","phone":"+526611000012","tags":[],"status":"resolved","mine":true,"unread":0,"ago":10080,
     "msgs":[["in","Gracias por las tarjetas, quedaron increíbles"],
             ["out","¡Qué gusto Rodrigo! Cuando necesites más, aquí estamos 🙌"]]},
    {"name":"Gimnasio Titan","phone":"+526611000013","tags":["mayoreo"],"status":"open","mine":false,"unread":0,"ago":300,
     "msgs":[["in","Queremos playeras para los entrenadores"],
             ["out","¿Cuántas y con qué logo?"],
             ["in","30, con el logo que les mandamos la vez pasada"],
             ["out","Lo tengo en archivo. Te confirmo hoy el tiempo de entrega."]]},
    {"name":"Valeria Cruz","phone":"+526611000014","tags":["vip"],"status":"open","mine":true,"unread":1,"ago":2,
     "msgs":[["in","Hola! ¿Me pueden hacer un banner para mañana?"],
             ["out","Depende del tamaño. ¿Qué medidas y a qué hora lo necesitas?"],
             ["in","85×200, lo necesito antes de las 3"]]},
    {"name":"Imprenta del Valle","phone":"+526611000015","tags":[],"status":"pending","mine":false,"unread":0,"ago":1600,
     "msgs":[["in","Somos otra imprenta, ¿nos maquilan DTF?"],
             ["out","Sí, manejamos maquila con precio especial. ¿Qué volumen mensual?"],
             ["in","Unos 200 metros"]]},
    {"name":"Óscar Beltrán","phone":"+526611000016","tags":[],"status":"open","mine":false,"unread":0,"ago":60,
     "msgs":[["in","¿Cuánto por instalación en sitio?"],
             ["out","$1,200 dentro de la ciudad. Fuera cotizamos aparte."],
             ["in","Va, sería aquí mismo en Culiacán"],
             ["out","Perfecto. ¿Qué día te acomoda?"]]}
  ]$json$::jsonb) loop

    base := now() - ((conv->>'ago')::int * interval '1 minute');

    insert into contacts (business_id, name, phone, tags, created_at)
    values (biz, conv->>'name', conv->>'phone',
            coalesce((select array_agg(value::text) from jsonb_array_elements_text(conv->'tags') value), '{}'::text[]),
            base - interval '40 days')
    returning id into c_id;

    insert into conversations (business_id, contact_id, status, assignee_id, area_id, unread, last_message_at, created_at)
    values (biz, c_id, conv->>'status',
            case when (conv->>'mine')::boolean then me else null end,
            ar[1 + (abs(hashtext(conv->>'name')) % array_length(ar,1))],
            (conv->>'unread')::int, base, base - interval '40 days')
    returning id into v_id;

    -- Los mensajes se reparten con huecos DESIGUALES, para que el hilo se lea como una
    -- conversación y no como un metrónomo.
    --
    -- Se avanza hacia ADELANTE acumulando el hueco, no hacia atrás multiplicando: el primer
    -- intento hacía `base - (n-1-i) * hueco(i)` con un hueco distinto en cada vuelta, y eso no es
    -- monótono —- las marcas de tiempo se cruzaban y en el hilo salía la respuesta ANTES de la
    -- pregunta. Al final se desplaza todo para que el último mensaje caiga exactamente en `base`,
    -- que es lo que ordena la lista de chats.
    n := jsonb_array_length(conv->'msgs');
    i := 0;
    for msg in select * from jsonb_array_elements(conv->'msgs') loop
      insert into messages (business_id, conversation_id, direction, type, body, state, created_at)
      values (biz, v_id, msg->>0, 'text', msg->>1,
              case when msg->>0 = 'out' then 'read' else 'delivered' end,
              base + (i * 11 + ((i * 7) % 13)) * interval '1 minute');
      i := i + 1;
    end loop;
    update messages
       set created_at = created_at - (coalesce((select max(created_at) from messages where conversation_id = v_id), base) - base)
     where conversation_id = v_id;
  end loop;

  ---------------------------------------------------------------- pedidos con líneas que CUADRAN
  -- El total del pedido se calcula de sus líneas, no se inventa: la página de pago muestra el
  -- desglose y un total que no sumara delataría el seed, no la app.
  for i in 1..14 loop
    select id into c_id from contacts where business_id = biz and phone like '+52661%' order by phone offset (i - 1) % 16 limit 1;
    select id into v_id from conversations where contact_id = c_id limit 1;

    insert into orders (business_id, code, contact_id, conversation_id, stage_id, area_id, assignee_id,
                        priority, pay_status, total, due_at, pay_token, created_at, updated_at)
    values (biz, 'HIR-9' || lpad(i::text, 3, '0'), c_id, v_id,
            st[1 + (i % array_length(st,1))],
            ar[1 + (i % array_length(ar,1))],
            case when i % 3 = 0 then me else null end,
            (array['low','normal','normal','high','urgent'])[1 + (i % 5)],
            (array['pending','partial','paid'])[1 + (i % 3)],
            0,
            case when i % 3 = 0 then now() + ((i % 9) - 3) * interval '1 day' else null end,
            'demo' || lpad(i::text, 3, '0') || substr(md5(random()::text), 1, 12),
            now() - (i * 2) * interval '1 day', now() - i * interval '1 day')
    returning id into o_id;

    insert into order_items (order_id, name, qty, unit_price, subtotal)
    select o_id, p.name, q.qty, p.price, p.price * q.qty
    from (select name, price, row_number() over (order by name) rn from products where business_id = biz) p
    join lateral (select 1 + ((i + p.rn) % 3) as qty) q on true
    where p.rn in (1 + (i % 10), 1 + ((i + 3) % 10));

    select coalesce(sum(subtotal), 0) into tot from order_items where order_id = o_id;
    update orders set total = tot where id = o_id;

    -- Abonos: los "partial" llevan la mitad, los "paid" el total. Así los puntitos de pago y el
    -- saldo del link de pago dicen la verdad.
    insert into payments (business_id, order_id, amount, method, created_by, created_at)
    select biz, o_id, case when o.pay_status = 'paid' then tot else round(tot / 2, 2) end,
           'transfer', me, now() - interval '2 days'
    from orders o where o.id = o_id and o.pay_status in ('partial','paid');
  end loop;

  ---------------------------------------------------------------- citas (agenda + banderitas)
  insert into appointments (business_id, contact_id, title, area_id, assignee_id, starts_at, status)
  select biz, c.id, '[demo] ' || t.title, ar[1 + (t.i % array_length(ar,1))], me,
         now() + (t.i - 1) * interval '1 day' + interval '10 hours', 'scheduled'
  from (values (1,'Entrega de lonas'), (2,'Toma de medidas en sitio'), (3,'Revisión de arte'), (5,'Instalación banner')) t(i, title)
  join lateral (select id from contacts where business_id = biz and phone like '+52661%' order by phone offset t.i limit 1) c on true;

  ---------------------------------------------------------------- chat de equipo
  insert into internal_messages (business_id, channel, author_id, body, created_at) values
    (biz, 'team', me, '[demo] Buenos días equipo ☀️ hoy salen las 300 playeras de Lunaria', now() - interval '5 hours'),
    (biz, 'team', me, '[demo] Recuerden marcar el pedido como Producción cuando entre a máquina', now() - interval '4 hours'),
    (biz, 'team', me, '[demo] La lona de Tacos El Güero ya está en revisión de arte', now() - interval '2 hours'),
    (biz, 'team', me, '[demo] ¿Alguien puede tomar el chat de Boutique Lunaria? Están apurados', now() - interval '25 minutes');

  ---------------------------------------------------------------- notas y actividad
  insert into notes (business_id, parent_type, parent_id, author_id, body, created_at)
  select biz, 'conversation', v.id, me,
         'Cliente recurrente, pide factura siempre. Confirmar RFC antes de cerrar.', now() - interval '1 day'
  from conversations v join contacts c on c.id = v.contact_id
  where c.business_id = biz and c.phone in ('+526611000004','+526611000007');

  insert into events (business_id, parent_type, parent_id, actor_id, kind, text, created_at)
  select biz, 'order', o.id, me, 'stage', 'Movido a ' || s.name, o.updated_at
  from orders o join stages s on s.id = o.stage_id
  where o.business_id = biz and o.code like 'HIR-9%';

  raise notice 'Listo.';
end $$;

analyze;

select 'contactos' as tabla, count(*) from contacts
union all select 'conversaciones', count(*) from conversations
union all select 'mensajes',       count(*) from messages
union all select 'pedidos',        count(*) from orders
union all select 'líneas',         count(*) from order_items
union all select 'pagos',          count(*) from payments
union all select 'productos',      count(*) from products
union all select 'citas',          count(*) from appointments
union all select 'chat de equipo', count(*) from internal_messages;
