-- ============================================================
-- Hiraticket — first-run onboarding + default config (no dummy data).
-- New businesses get a working pipeline (stages/areas for their vertical),
-- but NO sample orders/contacts/chats. An `onboarded` flag drives a one-time,
-- skippable setup wizard.
-- ============================================================

alter table public.businesses
  add column if not exists onboarded boolean not null default false;

-- Default stages + areas for a vertical (real config, not sample data).
create or replace function public.seed_default_config(p_business uuid, p_vertical text)
returns void language plpgsql security definer set search_path = public as $$
declare
  stage_names text[];
  area_names  text[];
  scolors text[] := array['slate','violet','amber','teal','green','blue'];
  acolors text[] := array['blue','violet','amber','teal','green','slate'];
  i int;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business';
  end if;
  if exists (select 1 from public.stages where business_id = p_business) then
    return;
  end if;

  case p_vertical
    when 'restaurante' then
      stage_names := array['Recibido','En cocina','Listo','En camino','Entregado'];
      area_names  := array['Mostrador','Cocina','Reparto'];
    when 'estetica' then
      stage_names := array['Agendado','En servicio','Terminado'];
      area_names  := array['Recepción','Servicio'];
    when 'veterinaria' then
      stage_names := array['Agendado','En consulta','Seguimiento'];
      area_names  := array['Recepción','Consultorio'];
    when 'retail' then
      stage_names := array['Nuevo','Preparando','Listo','Entregado'];
      area_names  := array['Ventas','Almacén','Envíos'];
    when 'taller' then
      stage_names := array['Recibido','Diagnóstico','Reparación','Listo','Entregado'];
      area_names  := array['Recepción','Taller'];
    when 'other' then -- generic, business-agnostic pipeline
      stage_names := array['Nuevo','En progreso','En espera','Completado'];
      area_names  := array['General','Ventas','Operaciones'];
    else -- imprenta (default)
      stage_names := array['Nuevo','Diseño','Producción','Listo','Entregado'];
      area_names  := array['Ventas','Diseño','Producción','Envíos'];
  end case;

  for i in 1 .. array_length(stage_names, 1) loop
    insert into public.stages (business_id, name, color, position)
    values (p_business, stage_names[i], scolors[((i - 1) % 6) + 1], i - 1);
  end loop;
  for i in 1 .. array_length(area_names, 1) loop
    insert into public.areas (business_id, name, color, position)
    values (p_business, area_names[i], acolors[((i - 1) % 6) + 1], i - 1);
  end loop;
end;
$$;

-- create_business now provisions a working (empty) business + default pipeline.
create or replace function public.create_business(p_name text, p_vertical text default 'imprenta')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.businesses (name, vertical, created_by)
  values (p_name, coalesce(p_vertical, 'imprenta'), auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'admin');

  insert into public.subscriptions (business_id, plan_id, status, mrr)
  values (new_id, 'pro', 'trialing', 999)
  on conflict (business_id) do nothing;

  insert into public.whatsapp_sessions (business_id, label, status)
  values (new_id, 'Principal', 'disconnected');

  perform public.seed_default_config(new_id, coalesce(p_vertical, 'imprenta'));

  return new_id;
end;
$$;

-- Mark the one-time onboarding as done (completed or skipped).
create or replace function public.complete_onboarding(p_business uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_business_member(p_business) then
    raise exception 'forbidden';
  end if;
  update public.businesses set onboarded = true where id = p_business;
end;
$$;
