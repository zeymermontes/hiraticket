-- ============================================================
-- Hiraticket — el color del avatar puede ser distinto en cada organización.
--
--   El color vive en profiles.avatar_color desde 0001, y con una organización por cuenta era
--   suficiente. Con varias, la misma persona quiere distinguirlas de un vistazo: verde en una,
--   morado en la otra. Eso no cabe en una sola columna del perfil.
--
--   Va en la membresía, como el rol y como las preferencias de aviso (0084): es "esta persona en
--   esta organización". Y va NULA por defecto a propósito —- nada de copiar el color actual a cada
--   fila —- porque nulo significa algo útil: "usa el del perfil". Así una organización nueva
--   arranca con el color de siempre y solo cambia si alguien lo cambia ahí.
--
--   No toca a nadie más: cada fila es de una persona, así que cambiar el color propio no puede
--   alcanzar el de un compañero.
-- ============================================================

alter table public.business_members
  add column if not exists avatar_color text;

-- Mismo motivo que en 0084: RLS filtra filas, no columnas, así que dejar que cada quien actualice
-- su fila de business_members le permitiría cambiarse el `role` de paso. Esta función escribe una
-- sola columna, y solo la de quien llama.
create or replace function public.set_my_member_color(p_business uuid, p_color text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.business_members
     set avatar_color = nullif(btrim(coalesce(p_color, '')), '')
   where business_id = p_business
     and user_id = auth.uid();
end;
$$;

grant execute on function public.set_my_member_color(uuid, text) to authenticated;
