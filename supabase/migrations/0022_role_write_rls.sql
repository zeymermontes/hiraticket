-- ============================================================
-- Hiraticket — role-aware write RLS.
--   Before: a single "members all" policy let ANY member (including 'viewer') insert/update/
--   delete via the API, bypassing the read-only UI. Now reads stay open to all members, but
--   writes require role in ('admin','agent'). The service-role worker bypasses RLS, unaffected.
-- ============================================================

create or replace function public.is_business_writer(b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b and m.user_id = auth.uid() and m.role in ('admin','agent')
  );
$$;

-- Operational tables: split the blanket policy into read (member) + writes (writer).
do $$
declare t text;
begin
  foreach t in array array[
    'areas','stages','contacts','conversations','messages','orders',
    'notes','events','canned_messages','automations'
  ] loop
    execute format('drop policy if exists "members all" on public.%I;', t);
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

-- order_items inherit access from their parent order (read = member, write = writer).
drop policy if exists "members order_items" on public.order_items;
drop policy if exists "oi read" on public.order_items;
drop policy if exists "oi write ins" on public.order_items;
drop policy if exists "oi write upd" on public.order_items;
drop policy if exists "oi write del" on public.order_items;
create policy "oi read" on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_business_member(o.business_id)));
create policy "oi write ins" on public.order_items for insert with check (
  exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_business_writer(o.business_id)));
create policy "oi write upd" on public.order_items for update using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_business_writer(o.business_id)))
  with check (exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_business_writer(o.business_id)));
create policy "oi write del" on public.order_items for delete using (
  exists (select 1 from public.orders o where o.id = order_items.order_id and public.is_business_writer(o.business_id)));

-- Business settings: writers only (viewers can't edit config).
drop policy if exists "members update business" on public.businesses;
create policy "writers update business" on public.businesses
  for update using (public.is_business_writer(id)) with check (public.is_business_writer(id));
