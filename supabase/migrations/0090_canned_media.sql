-- ============================================================
-- Hiraticket — plantillas con archivo.
--
-- Hasta aquí una plantilla era solo texto, y lo que la gente manda a diario no lo es: el PDF de
-- datos bancarios, el formulario de lanzamiento, la lista de precios. Se subían a mano cada vez,
-- buscándolos en el teléfono, con el riesgo de mandar la versión vieja.
--
-- El archivo NO se copia al mandarlo: la plantilla guarda la ruta dentro del bucket `media` y cada
-- envío la reutiliza, igual que los stickers favoritos (0033). Por eso borrar una plantilla NO
-- borra el archivo de Storage —- los mensajes que ya salieron apuntan a esa misma ruta y se
-- quedarían en blanco.
--
-- `body` sigue siendo not null: una plantilla que es SOLO archivo (la "biblioteca") guarda ''.
-- ============================================================

alter table public.canned_messages
  add column if not exists media_url   text,   -- ruta dentro del bucket `media` (no URL)
  add column if not exists media_mime  text,
  add column if not exists media_name  text,   -- el nombre real, el que se ve en la burbuja
  add column if not exists media_size  bigint,
  add column if not exists media_thumb text;   -- data URI, misma miniatura que calcula el navegador al subir
