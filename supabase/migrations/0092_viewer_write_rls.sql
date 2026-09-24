-- ============================================================
-- Hiraticket — el rol 'viewer' no escribe (cierre de lo que quedó fuera de 0022).
--
-- 0022 separó lectura (miembro) de escritura (admin/agente) en las tablas de entonces. Todas las
-- tablas creadas después volvieron a una sola política `for all` para cualquier miembro, así que
-- un viewer podía —con la llave anónima y su sesión, directo contra PostgREST— insertar pagos,
-- cambiar las credenciales de MercadoPago/Facturapi en business_plugins, o borrar la sesión de
-- WhatsApp. Mismo esquema que 0022: leer = miembro, escribir = escritor; y para credenciales y
-- sesiones de WhatsApp, escribir = admin.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'payments','payment_proofs','charges','plugin_usage','contact_addresses','shipments',
    'contact_fiscal','invoices','tags','order_waste','sticker_favorites',
    'products','appointments','campaigns'
  ] loop
    execute format('drop policy if exists "members all" on public.%I;', t);
    execute format('drop policy if exists "members %s" on public.%I;', t, t);
    execute format('drop policy if exists "members proofs" on public.%I;', t);
    execute format('drop policy if exists "members read" on public.%I;', t);
    execute format('drop policy if exists "members write ins" on public.%I;', t);
    execute format('drop policy if exists "members write upd" on public.%I;', t);
    execute format('drop policy if exists "members write del" on public.%I;', t);
    execute format('create policy "members read" on public.%I for select using (public.is_business_member(business_id));', t);
    execute format('create policy "members write ins" on public.%I for insert with check (public.is_business_writer(business_id));', t);
    execute format('create policy "members write upd" on public.%I for update using (public.is_business_writer(business_id)) with check (public.is_business_writer(business_id));', t);
    execute format('create policy "members write del" on public.%I for delete using (public.is_business_writer(business_id));', t);
  end loop;
end$$;

-- Credenciales de integraciones y sesiones de WhatsApp: solo administradores escriben.
do $$
declare t text;
begin
  foreach t in array array['business_plugins','whatsapp_sessions'] loop
    execute format('drop policy if exists "members business_plugins" on public.%I;', t);
    execute format('drop policy if exists "members manage wa" on public.%I;', t);
    execute format('drop policy if exists "members read" on public.%I;', t);
    execute format('drop policy if exists "admins write ins" on public.%I;', t);
    execute format('drop policy if exists "admins write upd" on public.%I;', t);
    execute format('drop policy if exists "admins write del" on public.%I;', t);
    execute format('create policy "members read" on public.%I for select using (public.is_business_member(business_id));', t);
    execute format('create policy "admins write ins" on public.%I for insert with check (public.is_business_admin(business_id));', t);
    execute format('create policy "admins write upd" on public.%I for update using (public.is_business_admin(business_id)) with check (public.is_business_admin(business_id));', t);
    execute format('create policy "admins write del" on public.%I for delete using (public.is_business_admin(business_id));', t);
  end loop;
end$$;
