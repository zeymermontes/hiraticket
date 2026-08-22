-- ============================================================
-- Hiraticket — el color de la APP también por organización.
--
--   0085 puso el color del avatar en la membresía. Pero el color que de verdad sirve para saber en
--   cuál organización estás es el otro: el de Ajustes, que repinta el riel, los botones y los
--   acentos de toda la pantalla. Ese vivía —- y solo vivía —- en el localStorage del navegador, así
--   que era el mismo en las dos organizaciones y ni siquiera viajaba a otro dispositivo. Quien lo
--   cambiaba buscando distinguir sus organizaciones veía exactamente lo contrario.
--
--   Va junto al del avatar, al rol y a las preferencias de aviso: todo lo que es "esta persona en
--   esta organización" vive en la misma fila.
--
--   Nulo = el amarillo de siempre. El localStorage se conserva como caché por organización para
--   que no haya un parpadeo del color anterior mientras carga, pero manda la base.
-- ============================================================

alter table public.business_members
  add column if not exists brand_color text;
