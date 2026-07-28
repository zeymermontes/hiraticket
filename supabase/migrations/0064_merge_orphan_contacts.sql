-- ============================================================
-- Hiraticket — reparar los contactos duplicados que creó createOrder.
--
--   El bug: createOrder resolvía el contacto por nombre con .maybeSingle(). Con DOS contactos del
--   mismo nombre, PostgREST devuelve error (PGRST116) y data null; el código ignoraba el error, lo
--   leía como "no existe" y creaba OTRO contacto. Desde el segundo homónimo, cada pedido generaba
--   un contacto huérfano —sin teléfono y sin conversación— y el pedido quedaba colgando de él.
--
--   Efecto visible: el panel del chat filtra los pedidos por el contact_id de la conversación, así
--   que mostraba "Pedidos · 0" aunque el cliente tuviera pedidos; y el detalle del pedido no podía
--   abrir la conversación, porque su contacto huérfano no tenía ninguna.
--
--   Esta migración es CONSERVADORA a propósito. Solo toca un duplicado cuando no hay ninguna duda
--   de que lo creó ese bug:
--     · mismo negocio y mismo nombre (normalizado) que un contacto "real",
--     · el huérfano NO tiene teléfono  → no vino del worker de WhatsApp,
--     · el huérfano NO tiene conversación, ni direcciones, ni datos fiscales,
--     · el "real" SÍ tiene conversación → es el que la gente tiene en mente.
--   Un duplicado con teléfono propio es otra persona con el mismo nombre: no se toca.
-- ============================================================

do $$
declare
  moved_orders   int := 0;
  moved_notes    int := 0;
  merged         int := 0;
  linked_convs   int := 0;
begin
  create temporary table _merge_map on commit drop as
  with real_contact as (
    -- El contacto "bueno" de cada (negocio, nombre): tiene conversación. Si hay varios, el más
    -- antiguo, para que el resultado sea determinista.
    select distinct on (c.business_id, lower(btrim(c.name)))
           c.id as keep_id, c.business_id, lower(btrim(c.name)) as norm
      from public.contacts c
     where exists (select 1 from public.conversations v where v.contact_id = c.id)
     order by c.business_id, lower(btrim(c.name)), c.created_at
  )
  select d.id as drop_id, r.keep_id
    from public.contacts d
    join real_contact r
      on r.business_id = d.business_id
     and r.norm = lower(btrim(d.name))
   where d.id <> r.keep_id
     and coalesce(btrim(d.phone), '') = ''                                              -- sin teléfono
     and not exists (select 1 from public.conversations v where v.contact_id = d.id)    -- sin chat
     and not exists (select 1 from public.contact_addresses a where a.contact_id = d.id)
     and not exists (select 1 from public.contact_fiscal f where f.contact_id = d.id);

  select count(*) into merged from _merge_map;
  if merged = 0 then
    raise notice 'Sin contactos huérfanos que reparar.';
    return;
  end if;

  update public.orders o set contact_id = m.keep_id
    from _merge_map m where o.contact_id = m.drop_id;
  get diagnostics moved_orders = row_count;

  update public.notes n set parent_id = m.keep_id
    from _merge_map m where n.parent_type = 'contact' and n.parent_id = m.drop_id;
  get diagnostics moved_notes = row_count;

  delete from public.contacts c using _merge_map m where c.id = m.drop_id;

  -- Los pedidos que quedaron sin conversación ahora sí pueden enlazarse: su contacto (ya el bueno)
  -- tiene una. Es lo que hace que el botón de abrir el chat desde el pedido vuelva a funcionar.
  -- Subconsulta correlacionada y no FROM LATERAL: en un UPDATE, la lista FROM no puede
  -- referenciar la propia tabla que se actualiza.
  update public.orders o
     set conversation_id = (
       select v.id from public.conversations v
        where v.contact_id = o.contact_id
        order by v.last_message_at desc nulls last
        limit 1
     )
   where o.conversation_id is null
     and o.contact_id is not null
     and exists (select 1 from public.conversations v where v.contact_id = o.contact_id);
  get diagnostics linked_convs = row_count;

  raise notice 'Contactos huérfanos fusionados: %  |  pedidos re-apuntados: %  |  notas: %  |  pedidos enlazados a su chat: %',
    merged, moved_orders, moved_notes, linked_convs;
end $$;
