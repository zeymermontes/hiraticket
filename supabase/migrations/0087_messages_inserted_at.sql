-- ============================================================
-- Hiraticket — cuándo ENTRÓ el mensaje, además de cuándo se envió.
--
--   `messages.created_at` es la marca de tiempo de WhatsApp, no la de la ingesta. Sirve para
--   ordenar el hilo, y es lo correcto para eso. Pero deja sin respuesta la única pregunta que
--   importa cuando alguien reporta "los chats aparecieron horas tarde":
--
--       ¿la fila estaba en la base y el navegador no la enseñaba,
--        o la fila entró tarde?
--
--   Son dos fallos opuestos —- uno se arregla en el cliente y el otro en el pipeline —- y hasta
--   ahora había que deducirlo por la forma del reporte. Van tres veces que se investiga por
--   inferencia. Con esta columna es una consulta.
--
--   Las filas viejas quedan en NULL a propósito: "no se sabe" es la verdad para ellas, y un
--   `default now()` retroactivo les pondría a todas la hora de la migración, que es peor que nada.
--   Por eso se añade sin default y se le pone después: así el ALTER no reescribe la tabla.
-- ============================================================

alter table public.messages add column if not exists inserted_at timestamptz;
alter table public.messages alter column inserted_at set default now();

-- Para "¿qué entró en esta ventana de tiempo?", que es como se mira un atasco de ingesta.
create index if not exists messages_inserted_at_idx on public.messages (business_id, inserted_at desc);
