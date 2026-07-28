-- ============================================================
-- Hiraticket — parte numérica del código de pedido, para poder ordenar en SQL.
--
--   La tabla de pedidos ordena por "código" numéricamente ("HIR-999" antes que
--   "HIR-1144"), algo que hasta ahora se hacía en el cliente porque requiere
--   extraer el número. Con la lista paginada en el servidor el ORDER BY tiene que
--   correr en Postgres, así que guardamos el número en una columna generada.
--
--   Espeja exactamente el helper codeNum() del cliente: la corrida de dígitos
--   final, 0 si no hay. El {1,15} acota a lo que cabe en un bigint para que un
--   código raro no reviente el INSERT.
-- ============================================================

alter table public.orders
  add column if not exists code_num bigint
  generated always as (
    coalesce(nullif(substring(code from '([0-9]{1,15})[[:space:]]*$'), '')::bigint, 0)
  ) stored;

create index if not exists orders_business_code_num_idx
  on public.orders (business_id, code_num)
  where deleted_at is null;
