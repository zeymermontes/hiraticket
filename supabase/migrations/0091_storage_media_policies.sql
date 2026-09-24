-- ============================================================
-- Hiraticket — Storage 'media': sin listado anónimo y con rutas por inquilino.
--
-- Antes (0013): SELECT sobre storage.objects para CUALQUIER rol y bucket entero, e INSERT para
-- cualquier usuario autenticado sin restringir la ruta. Con la llave anónima (que viaja en el
-- bundle) se podía LISTAR todo el bucket: todos los business_id de la plataforma y cada archivo
-- de cada chat, comprobante, factura y guía. Y una cuenta recién registrada podía subir archivos
-- bajo el prefijo de otro negocio.
--
-- Ahora: leer (listar/firmar) solo lo del negocio del que se es miembro, y subir solo bajo el
-- propio negocio (o el propio avatar). El bucket sigue `public = true` porque cinco lugares
-- (comprobantes, facturas, guías, avatares, promos) usan getPublicUrl; pasarlo a privado va
-- aparte, cuando esos cinco firmen sus URLs. Con esto se corta la ENUMERACIÓN; los archivos
-- siguen descargables si alguien conoce la ruta exacta.
--
-- Rutas en uso:
--   <business_id>/…            chat, equipo, stickers (worker, ingesta oficial y el navegador)
--   proofs/<business_id>/…     comprobantes de pago (servidor, llave de servicio)
--   invoices/<business_id>/…   facturas (servidor)
--   labels/<business_id>/…     guías (servidor)
--   avatars/<user_id>-…        avatar (navegador)
--   promo/<business_id>-…      promos (navegador)
-- ============================================================

drop policy if exists "media public read" on storage.objects;
drop policy if exists "media auth upload" on storage.objects;
drop policy if exists "media member read" on storage.objects;
drop policy if exists "media member upload" on storage.objects;

-- ¿Este objeto es del negocio del que soy miembro? (o mi avatar / una promo de mi negocio)
-- Devuelve null (y no un error de cast) si la ruta no sigue ninguno de los patrones: una política
-- que lanza error tumba la consulta entera, y aquí lo que se quiere es simplemente negar.
create or replace function public.media_object_business(name text)
returns uuid language sql immutable as $$
  with p as (
    select case
             when split_part(name, '/', 1) in ('proofs', 'invoices', 'labels') then split_part(name, '/', 2)
             when split_part(name, '/', 1) = 'promo' then substr(split_part(name, '/', 2), 1, 36)
             when split_part(name, '/', 1) = 'avatars' then ''
             else split_part(name, '/', 1)
           end as id
  )
  select case when id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then id::uuid else null end from p
$$;

create policy "media member read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (
      (split_part(name, '/', 1) = 'avatars')
      or public.is_business_member(public.media_object_business(name))
    )
  );

create policy "media member upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (
      (split_part(name, '/', 1) = 'avatars' and split_part(name, '/', 2) like (auth.uid()::text || '-%'))
      or (split_part(name, '/', 1) not in ('proofs', 'invoices', 'labels')
          and public.is_business_writer(public.media_object_business(name)))
    )
  );
