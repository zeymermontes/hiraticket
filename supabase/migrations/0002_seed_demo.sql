-- ============================================================
-- Hiraticket — demo data seeder (callable per business)
-- Populates a sticker/print-shop business with stages, areas,
-- contacts, and orders so the app shows realistic data.
-- Idempotent: no-op if the business already has orders.
-- ============================================================

create or replace function public.seed_demo_data(p_business uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s_new uuid; s_design uuid; s_prod uuid; s_ready uuid; s_done uuid;
  a_sales uuid; a_design uuid; a_prod uuid; a_ship uuid;
  c_id uuid;
  o_id uuid;
  conv_id uuid;
  rec record;
  n int := 1043;
begin
  if not public.is_business_member(p_business) then
    raise exception 'not a member of this business';
  end if;

  if exists (select 1 from public.orders where business_id = p_business) then
    return; -- already seeded
  end if;

  -- stages
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Nuevo', 'slate', 0) returning id into s_new;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Diseño', 'violet', 1) returning id into s_design;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Producción', 'amber', 2) returning id into s_prod;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Listo', 'teal', 3) returning id into s_ready;
  insert into public.stages (business_id, name, color, position) values
    (p_business, 'Entregado', 'green', 4) returning id into s_done;

  -- areas
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Ventas', 'blue', 0) returning id into a_sales;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Diseño', 'violet', 1) returning id into a_design;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Producción', 'amber', 2) returning id into a_prod;
  insert into public.areas (business_id, name, color, position) values
    (p_business, 'Envíos', 'teal', 3) returning id into a_ship;

  -- contacts + one order each
  for rec in
    select * from (values
      ('Lucía Fernández', '+52 55 1234 5678', 'Stickers troquelados holográficos', 12, 18, s_ready, a_prod, 'high'),
      ('Carlos Mendoza',  '+52 55 2345 6789', 'Vinil para escaparate 2x1m',          1, 950, s_prod, a_prod, 'normal'),
      ('Estética Bella',  '+52 55 3456 7890', 'Tarjetas de presentación premium',     500, 1.6, s_design, a_design, 'normal'),
      ('Taquería El Güero','+52 55 4567 8901','Lona impresa 3x1m con ojillos',        2, 420, s_new, a_sales, 'urgent'),
      ('Diego Ramírez',   '+52 55 5678 9012', 'Playeras DTF (paquete 20)',            20, 95, s_done, a_ship, 'low'),
      ('Veterinaria Pet', '+52 55 6789 0123', 'Stickers troquelados kiss-cut',        300, 2.2, s_prod, a_prod, 'normal')
    ) as v(cname, phone, item, qty, unit, stage_id, area_id, prio)
  loop
    insert into public.contacts (business_id, name, phone)
      values (p_business, rec.cname, rec.phone) returning id into c_id;

    n := n + 1;
    insert into public.orders (business_id, code, contact_id, stage_id, area_id, assignee_id, priority, total, pay_status)
      values (
        p_business, 'HIR-' || n, c_id, rec.stage_id, rec.area_id, v_uid, rec.prio,
        (rec.qty * rec.unit)::numeric(12,2),
        case rec.stage_id when s_done then 'paid' when s_ready then 'partial' else 'pending' end
      ) returning id into o_id;

    insert into public.order_items (order_id, name, qty, unit_price, subtotal)
      values (o_id, rec.item, rec.qty, rec.unit, (rec.qty * rec.unit)::numeric(12,2));

    -- a conversation with a few messages, linked back to the order
    insert into public.conversations (business_id, contact_id, status, assignee_id, area_id, unread, last_message_at)
      values (
        p_business, c_id,
        case rec.stage_id when s_done then 'resolved' else 'open' end,
        v_uid, rec.area_id,
        case rec.stage_id when s_done then 0 else 1 end,
        now()
      ) returning id into conv_id;

    update public.orders set conversation_id = conv_id where id = o_id;

    insert into public.messages (business_id, conversation_id, direction, type, body, author_id, state, created_at) values
      (p_business, conv_id, 'in',  'text', 'Hola, quiero info sobre ' || rec.item, null, 'delivered', now() - interval '2 hour'),
      (p_business, conv_id, 'out', 'text', '¡Claro! Te ayudo con tu pedido HIR-' || n || '.', v_uid, 'read', now() - interval '1 hour'),
      (p_business, conv_id, 'in',  'text', '¿Para cuándo estaría listo?', null, 'delivered', now() - interval '18 minute');

    insert into public.notes (business_id, parent_type, parent_id, author_id, body)
      values (p_business, 'order', o_id, v_uid, 'Cliente pidió factura.');
  end loop;

  -- mark the demo WhatsApp session connected so chat works out of the box
  update public.whatsapp_sessions
    set status = 'connected', phone = '+52 55 1000 2000', last_seen = now()
    where business_id = p_business;

  -- canned messages
  insert into public.canned_messages (business_id, title, body, category, shortcut) values
    (p_business, 'Saludo',        'Hola {{name}} 👋 gracias por escribir a Hirata. ¿En qué te ayudo?', 'General', '/hola'),
    (p_business, 'Pedido listo',  '{{name}}, tu pedido {{order_number}} ya está listo para recoger 🎉', 'Pedidos', '/listo'),
    (p_business, 'Link de pago',  'Aquí tu link de pago para {{order_number}}: pay.hiraticket.com 💳',  'Pagos',   '/pago');

  -- automations
  insert into public.automations (business_id, name, trigger_type, trigger_value, action_type, action_payload, enabled) values
    (p_business, 'Pedido listo → avisar', 'order_stage',       s_ready::text, 'send_template', '{"template":"Pedido listo"}', true),
    (p_business, 'Nuevo chat → saludar',  'conversation_new',  null,          'send_template', '{"template":"Saludo"}',       true);
end;
$$;
