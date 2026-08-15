-- ============================================================
-- Hiraticket — índices de las rutas calientes del worker de WhatsApp (whatsmeow).
--
--   El worker sondea la base cada 2-4 segundos, para siempre. Ninguna de esas consultas tenía un
--   índice que la sirviera, así que cada vuelta era un recorrido completo de `messages` —- la tabla
--   más grande y la única que nunca se purga. Multiplicado por los cuatro bucles de sondeo, más un
--   recorrido completo extra por CADA acuse de entrega recibido, la base pasaba el día entero
--   escaneando y todo lo demás (mandar, recibir, abrir un chat) se quedaba esperando turno.
--
--   Por eso el worker se degradaba solo con el tiempo aunque no cambiara nada: el costo de cada
--   sondeo crece con el histórico de mensajes.
--
--   Los índices son PARCIALES a propósito: la cola de salida y las peticiones pendientes son unas
--   pocas filas frente a millones, así que el índice se mantiene diminuto y casi no encarece las
--   escrituras de `messages`, que es lo último que conviene frenar.
--
--   CÓMO CORRERLA: con CONCURRENTLY, que NO puede ir dentro de una transacción. Ejecútala en el SQL
--   editor de Supabase (o con psql), no con `supabase db push`, que envuelve la migración en una
--   transacción. El worker crea estos mismos índices al arrancar, también con CONCURRENTLY, así que
--   si ya desplegaste el worker esta migración no hará nada: queda como registro.
-- ============================================================

-- Momento en que el worker reclamó un envío. El rescate de envíos colgados mide desde aquí y no
-- desde created_at: con created_at, un mensaje que llevaba rato esperando en la cola ya nacía
-- vencido al reclamarlo, así que el barrido siguiente lo re-encolaba con el envío todavía en vuelo
-- y el cliente lo recibía dos veces por WhatsApp mientras la app mostraba uno solo.
alter table public.messages
  add column if not exists claimed_at timestamptz;

-- pollOutbound: la cola de salida (ORDER BY created_at LIMIT 50).
create index concurrently if not exists messages_outbox_idx
  on public.messages (created_at)
  where direction = 'out' and state = 'queued';

-- pollOutbound: la reja de "no adelantes a un mensaje anterior de la misma conversación"
-- (el NOT EXISTS correlacionado, que se evalúa una vez por candidato).
create index concurrently if not exists messages_outbox_conv_idx
  on public.messages (conversation_id, created_at)
  where direction = 'out' and state in ('queued', 'sending');

-- pollOutbound: rescate de envíos colgados.
create index concurrently if not exists messages_outbox_stuck_idx
  on public.messages (claimed_at)
  where direction = 'out' and state = 'sending';

-- pollHeartbeat: el recuento de fallidos de las últimas 2 h, cada 30 s.
create index concurrently if not exists messages_outbox_failed_idx
  on public.messages (created_at)
  where direction = 'out' and state = 'failed';

-- pollContacts: las peticiones de "traer nombre y foto", cada 3 s.
create index concurrently if not exists contacts_fetch_requested_idx
  on public.contacts (fetch_requested)
  where fetch_requested is not null;
