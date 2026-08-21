-- ============================================================
-- Hiraticket — las preferencias de aviso pasan a ser por ORGANIZACIÓN.
--
--   0068 las puso en profiles.notif_prefs, y con una organización por cuenta eso era exacto: son
--   preferencias de la persona, no del equipo. Con multiempresa deja de serlo. "Avísame de los
--   chats sin asignar" es una respuesta distinta según de qué negocio hablemos —- en el principal
--   los quieres todos, en el de al lado quizá solo las menciones —- y estando en profiles, apagar
--   algo en uno lo apagaba en TODOS, sin que nada en pantalla lo dijera.
--
--   El sitio natural es la membresía: `business_members` ES "esta persona en esta organización",
--   con su propio rol desde el principio. La preferencia va justo al lado del rol.
--
--   Se copia lo que cada quien ya tenía a TODAS sus membresías, así que nadie nota el cambio: el
--   día después, cada organización arranca con lo que la persona había elegido.
--
--   profiles.notif_prefs se queda donde está, sin leerse. Borrarla no gana nada y cierra la puerta
--   a volver atrás si algo sale mal.
-- ============================================================

alter table public.business_members
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

update public.business_members m
   set notif_prefs = p.notif_prefs
  from public.profiles p
 where p.id = m.user_id
   and p.notif_prefs is not null
   and p.notif_prefs <> '{}'::jsonb
   and m.notif_prefs = '{}'::jsonb;

-- Escribir las propias preferencias, y NADA más.
--
-- No se abre business_members a que cada quien actualice su fila: RLS filtra por filas, no por
-- columnas, así que una política de update dejaría a cualquiera cambiarse el `role` a admin. Esta
-- función toca una sola columna y solo la de quien llama —- el business_id que le pasen no puede
-- llevarla a la fila de otra persona porque el user_id sale de auth.uid(), no del argumento.
create or replace function public.set_my_notif_prefs(p_business uuid, p_prefs jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.business_members
     set notif_prefs = coalesce(p_prefs, '{}'::jsonb)
   where business_id = p_business
     and user_id = auth.uid();
end;
$$;

grant execute on function public.set_my_notif_prefs(uuid, jsonb) to authenticated;
