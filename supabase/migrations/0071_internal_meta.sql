-- ============================================================
-- Hiraticket — los mensajes internos también guardan miniatura y tamaño.
--
--   Las imágenes que sube el equipo van del navegador directo a Storage: no pasan por WhatsApp ni
--   por el worker de Go, que eran los dos únicos lugares donde se generaba la miniatura. Resultado:
--   una foto pesada mandada por un agente no tenía nada que pintar y la burbuja intentaba cargar el
--   original completo —- justo lo que traba la pestaña.
--
--   Ahora la miniatura se genera en el navegador al subir, y necesita dónde vivir. `messages` ya
--   tiene `meta` y `media_size`; `internal_messages` no tenía ninguna de las dos.
-- ============================================================

alter table public.internal_messages add column if not exists meta jsonb;

-- Se conoce exacto al subir (file.size), y es lo que muestra el peso junto a "Ver foto".
alter table public.internal_messages add column if not exists media_size bigint;
