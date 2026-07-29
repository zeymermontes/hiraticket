-- ============================================================
-- Hiraticket — preferencias de notificación por usuario + aviso de transferencia.
--
--   Las preferencias van en profiles y no en localStorage porque son DEL USUARIO, no del navegador:
--   quien las apaga en la computadora de la oficina espera que sigan apagadas en su laptop.
--   (El sonido y las notificaciones del sistema sí son por dispositivo y se quedan donde están.)
--
--   events.target_id: hasta ahora una transferencia solo dejaba el NOMBRE del destinatario dentro
--   del texto ("Transferido a Ana"), así que un cliente no podía saber si el destinatario era él.
--   Con el id se puede avisar solo a quien le toca.
--
--   Y events entra a la publicación de realtime: sin eso el aviso de transferencia no llegaría
--   hasta recargar.
-- ============================================================

alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

alter table public.events
  add column if not exists target_id uuid references auth.users (id) on delete set null;

-- Cada agente filtra "lo que va dirigido a mí"; sin esto sería un scan del histórico de eventos.
create index if not exists events_target_idx
  on public.events (target_id, created_at desc)
  where target_id is not null;

-- Realtime necesita la fila completa para que el cliente vea target_id en el payload.
alter table public.events replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;
