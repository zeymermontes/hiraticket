-- ============================================================
-- Hiraticket — «recibido» y «visto» en el chat del equipo.
--
--   El cursor de lectura ya existía (internal_reads.last_read_at, 0036), pero solo lo podía leer su
--   dueño: servía para contar no leídos, no para que quien manda sepa si ya lo vieron. Ahora:
--     - last_delivered_at: hasta dónde le ha LLEGADO el canal a cada quien (su app lo recibió,
--       aunque no haya abierto el hilo). Lo adelanta la propia app al cargar o recibir mensajes.
--     - los miembros pueden LEER los cursores de los demás en los canales que comparten (el del
--       equipo, y los directos en los que participan: mismo criterio que los mensajes); escribir
--       sigue siendo solo el propio.
--     - la tabla entra a realtime para que las palomitas cambien en vivo.
--   Con esto, un mensaje mío está «recibido» cuando el otro (o todos, en el equipo) tiene
--   last_delivered_at posterior, y «visto» cuando tiene last_read_at posterior.
-- ============================================================

alter table public.internal_reads add column if not exists last_delivered_at timestamptz;

drop policy if exists "members read internal_reads" on public.internal_reads;
create policy "members read internal_reads" on public.internal_reads
  for select using (public.is_business_member(business_id)
    and (channel = 'team' or channel like '%' || auth.uid()::text || '%'));

alter table public.internal_reads replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'internal_reads'
  ) then
    alter publication supabase_realtime add table public.internal_reads;
  end if;
end $$;
