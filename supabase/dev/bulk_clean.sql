-- ============================================================
-- SOLO DESARROLLO — borra lo que sembró bulk_seed.sql.
--
--   Deja intactos tu usuario, el negocio, sus stages/áreas y la configuración:
--   solo se lleva contactos, conversaciones, mensajes, pedidos, notas y eventos.
--   Los mensajes, conversaciones y líneas caen por FK en cascada.
--
--   Correr:
--     psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--       -f supabase/dev/bulk_clean.sql
-- ============================================================
\set ON_ERROR_STOP on

do $$
declare biz uuid;
begin
  select id into biz from businesses order by created_at limit 1;
  if biz is null then raise notice 'No hay negocio, nada que limpiar.'; return; end if;

  delete from notes  where business_id = biz;
  delete from events where business_id = biz;
  delete from orders where business_id = biz;      -- arrastra order_items
  delete from contacts where business_id = biz;    -- arrastra conversations → messages
  raise notice 'Datos de prueba borrados del negocio %', biz;
end $$;

analyze;

select 'contactos' as tabla, count(*) from contacts
union all select 'conversaciones', count(*) from conversations
union all select 'mensajes',       count(*) from messages
union all select 'pedidos',        count(*) from orders;
