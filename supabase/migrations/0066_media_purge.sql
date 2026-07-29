-- ============================================================
-- Hiraticket — marca de adjunto purgado por antigüedad + peso.
--
--   El storage lo llenan unos pocos archivos muy grandes, no los miles pequeños. Se purgan solo los
--   pesados y viejos (>20 MB y >90 días): son un porcentaje mínimo de los adjuntos y la mayoría del
--   espacio, así que casi nadie nota que desaparecieron.
--
--   Se marca en vez de borrar el mensaje: la conversación conserva que ahí hubo un archivo, con su
--   nombre, y la UI puede decir "ya no disponible, pídelo de nuevo" en vez de dejar un enlace roto.
--   Perder el rastro sería peor que perder el archivo.
--
--   Ojo: borrar la fila de storage.objects por SQL NO borra el archivo del almacenamiento. La purga
--   se hace desde la app con la API de Storage; esta columna solo registra el resultado.
-- ============================================================

alter table public.messages
  add column if not exists media_purged_at timestamptz;

-- El barrido busca "media viva y antigua"; parcial para que el índice no cargue con todo el
-- histórico de mensajes de texto, que son la inmensa mayoría.
create index if not exists messages_media_purge_idx
  on public.messages (created_at)
  where media_url is not null and media_purged_at is null;
