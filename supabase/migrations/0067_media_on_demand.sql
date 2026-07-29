-- ============================================================
-- Hiraticket — adjuntos pesados: descarga bajo demanda, sin guardarlos.
--
--   Para archivos por encima del umbral el worker NO baja los bytes: guarda solo el puntero de
--   WhatsApp (directPath + mediaKey + hashes), unos cientos de bytes en vez de decenas de MB. El
--   archivo se baja y se guarda la primera vez que alguien lo abre; el que nadie abre no ocupa nada.
--
--   ADVERTENCIA que hay que tener presente: WhatsApp borra la media de su CDN —la entrante en unos
--   7 días, la saliente ~30—. Pasado eso el puntero devuelve 404 y el archivo NO se recupera de
--   ningún lado. Por eso media_fetch_error guarda el motivo: la UI tiene que poder decir "caducó,
--   pídelo de nuevo" en vez de fallar en silencio.
--
--   El worker es un background worker sin puerto HTTP, así que la petición viaja por la base con el
--   mismo mecanismo que ya usan editar y borrar: pending_op='fetch_media' y pollOps lo recoge.
-- ============================================================

alter table public.messages
  add column if not exists media_ptr         jsonb,   -- puntero de WhatsApp (directPath, mediaKey, hashes, tipo)
  add column if not exists media_size        bigint,  -- tamaño en bytes, para mostrarlo antes de bajar
  add column if not exists media_fetch_error text;    -- último fallo (p.ej. 'expired')

-- pollOps ya barre pending_op; este índice parcial evita que ese barrido crezca con el histórico.
create index if not exists messages_pending_op_idx
  on public.messages (pending_op)
  where pending_op is not null;
