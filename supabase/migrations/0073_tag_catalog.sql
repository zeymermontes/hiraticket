-- ============================================================
-- Hiraticket — catálogo de etiquetas, persistente y buscable.
--
--   Antes el selector armaba la lista escaneando contacts.tags al vuelo: sin límite explícito en
--   la consulta, así que en un negocio con muchos contactos el límite por defecto de PostgREST la
--   truncaba —- lo que se veía como "solo salen las etiquetas recientes" en vez del catálogo
--   completo. Y una etiqueta que se quitara del último contacto que la tenía desaparecía del
--   selector entero, aunque quisieras seguir usándola.
--
--   Ahora es una tabla chica y propia: se llena cuando una etiqueta se usa por primera vez y se
--   queda ahí para siempre, sin importar qué pase después con los contactos. El selector la lee
--   completa y ordenada — sin escaneo, sin límite que pueda truncarla.
--
--   Sin normalizar mayúsculas a propósito: los tags de contactos tampoco lo hacen hoy, y forzarlo
--   aquí sería una regla nueva que el resto de la app no sigue.
-- ============================================================

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists tags_business_name_idx on public.tags (business_id, name);

alter table public.tags enable row level security;
drop policy if exists "members tags" on public.tags;
create policy "members tags" on public.tags
  for all using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

-- Backfill: todo lo que ya está en uso en algún contacto entra al catálogo, para no perder nada.
insert into public.tags (business_id, name)
select distinct c.business_id, t.tag
  from public.contacts c, unnest(c.tags) as t(tag)
 where t.tag is not null and t.tag <> ''
on conflict (business_id, name) do nothing;
