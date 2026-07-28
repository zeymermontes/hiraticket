-- ============================================================
-- Hiraticket — cancelar un pedido (y registrar el reembolso si lo hubo).
--
--   Va como estado APARTE de la etapa, no como una etapa más: un pedido puede cancelarse esté
--   donde esté del flujo, y meter "Cancelado" como columna del tablero dejaría una columna muerta
--   creciendo para siempre. Además las etapas se configuran por negocio, así que los reportes no
--   podrían detectarlas de forma confiable.
--
--   Se modela con cancelled_at (timestamp nullable) y no con un enum de status, para seguir el
--   mismo idioma que deleted_at (0039): la fecha ES el estado, y de paso queda cuándo pasó.
--
--   Cancelado NO es borrado: el pedido sigue visible en su lista e historial, marcado. Lo que
--   cambia es que deja de contar como venta en reportes.
--
--   El dinero no se toca aquí. Si hubo reembolso, la acción del servidor inserta un pago NEGATIVO
--   en payments, así "cobrado" baja solo y queda rastro de cuándo, cuánto y quién.
-- ============================================================

alter table public.orders
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references auth.users (id) on delete set null,
  add column if not exists cancelled_reason text;

-- Los reportes y las listas filtran "no cancelados" constantemente; parcial para que el índice
-- solo pese lo que de verdad se consulta.
create index if not exists orders_business_cancelled_idx
  on public.orders (business_id, cancelled_at)
  where deleted_at is null;
