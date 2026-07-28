-- ============================================================
-- Hiraticket — conteo de tarjetas por columna del Kanban.
--
--   El tablero mandaba TODOS los pedidos y TODAS las líneas al navegador y
--   contaba en memoria: ~1.2 MB y 5,000 tarjetas montadas de golpe (11,250 en la
--   vista de Productos). Las consultas nunca fueron el problema — 19 ms y 2.7 ms
--   con 5,000 pedidos — el costo era serializar y renderizar.
--
--   Al ventanear cada columna, el encabezado ya no puede contar lo cargado: si
--   una columna muestra 25 de 1,000, el badge tiene que decir 1,000. Eso es este
--   RPC: un solo round-trip devuelve {columna_id: total} para todas.
--
--   El match por nombre de cliente se resuelve aquí con un join, no en TS, para
--   no partir el filtro en dos consultas.
--
--   security invoker: siguen aplicando las RLS de orders/order_items.
-- ============================================================

create or replace function public.kanban_counts(
  p_business uuid,
  p_group    text    default 'status',  -- 'status' agrupa por stage_id, 'area' por area_id
  p_products boolean default false,     -- contar order_items en vez de orders
  p_q        text    default null,
  p_area     uuid    default null,
  p_assignee uuid    default null
)
returns json
language plpgsql stable security invoker set search_path = public as $$
declare
  result json;
  needle text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if p_products then
    -- Vista Productos: una tarjeta por línea, siempre agrupada por su etapa.
    -- Espeja el filtro del cliente: busca en código de pedido, nombre de la línea
    -- y nombre del contacto; el filtro de área NO aplica aquí (igual que antes).
    select coalesce(json_object_agg(k, n), '{}'::json) into result
    from (
      select oi.stage_id::text as k, count(*) as n
        from public.order_items oi
        join public.orders   o on o.id = oi.order_id
        left join public.contacts c on c.id = o.contact_id
       where o.business_id = p_business
         and o.deleted_at is null
         and (p_assignee is null or o.assignee_id = p_assignee)
         and (needle is null
              or o.code  ilike '%' || needle || '%'
              or oi.name ilike '%' || needle || '%'
              or c.name  ilike '%' || needle || '%')
         and oi.stage_id is not null
       group by oi.stage_id
    ) t;
  else
    select coalesce(json_object_agg(k, n), '{}'::json) into result
    from (
      select (case when p_group = 'area' then o.area_id else o.stage_id end)::text as k,
             count(*) as n
        from public.orders o
        left join public.contacts c on c.id = o.contact_id
       where o.business_id = p_business
         and o.deleted_at is null
         and (p_area     is null or o.area_id     = p_area)
         and (p_assignee is null or o.assignee_id = p_assignee)
         and (needle is null
              or o.code ilike '%' || needle || '%'
              or c.name ilike '%' || needle || '%')
         and (case when p_group = 'area' then o.area_id else o.stage_id end) is not null
       group by 1
    ) t;
  end if;

  return result;
end $$;

grant execute on function public.kanban_counts(uuid, text, boolean, text, uuid, uuid) to authenticated;

-- Una página de tarjetas de la vista Productos.
--
--   Va por RPC y no por PostgREST porque su búsqueda cruza tres tablas a la vez
--   (nombre de la línea, código del pedido, nombre del contacto) y PostgREST no
--   sabe hacer un OR entre la tabla base y un embed — habría que resolverlo en
--   dos consultas y meter cientos de uuids en la URL. Los pedidos sí caben en
--   PostgREST porque ahí el OR es sobre columnas de la propia tabla.
create or replace function public.kanban_items_page(
  p_business uuid,
  p_stage    uuid,
  p_q        text default null,
  p_assignee uuid default null,
  p_limit    int  default 25,
  p_offset   int  default 0
)
returns json
language sql stable security invoker set search_path = public as $$
  with needle as (select nullif(btrim(coalesce(p_q, '')), '') as n)
  select coalesce(json_agg(row_to_json(t) order by t.ord), '[]'::json)
  from (
    select oi.id,
           oi.name,
           oi.qty,
           oi.stage_id,
           o.id           as order_id,
           o.code         as order_code,
           o.priority,
           o.assignee_id,
           case when c.id is null then null else json_build_object('name', c.name) end as contact,
           case when s.id is null then null else json_build_object('name', s.name, 'color', s.color) end as stage,
           o.code_num     as ord
      from public.order_items oi
      join public.orders   o on o.id = oi.order_id
      left join public.contacts c on c.id = o.contact_id
      left join public.stages   s on s.id = oi.stage_id
     cross join needle
     where o.business_id = p_business
       and o.deleted_at is null
       and oi.stage_id = p_stage
       and (p_assignee is null or o.assignee_id = p_assignee)
       and (needle.n is null
            or o.code  ilike '%' || needle.n || '%'
            or oi.name ilike '%' || needle.n || '%'
            or c.name  ilike '%' || needle.n || '%')
     order by o.code_num, oi.id
     limit p_limit offset p_offset
  ) t;
$$;

grant execute on function public.kanban_items_page(uuid, uuid, text, uuid, int, int) to authenticated;

-- Agrupar/filtrar por columna necesita estos accesos; los de 0059 cubren
-- (business_id, updated_at) y contact_id, pero no la etapa ni el área.
create index if not exists orders_business_stage_idx
  on public.orders (business_id, stage_id)
  where deleted_at is null;

create index if not exists orders_business_area_idx
  on public.orders (business_id, area_id)
  where deleted_at is null;

create index if not exists order_items_stage_idx
  on public.order_items (stage_id);
