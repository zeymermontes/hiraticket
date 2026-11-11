-- ============================================================
-- 0104 · Tipos de factura: total, PPD, anticipo, finiquito y complemento de pago
-- ============================================================
-- Un pedido ya no tiene una sola factura. Puede facturarse por anticipos (CFDI de ingreso con la
-- clave 84111506 «Anticipo del bien o servicio») y cerrarse con un finiquito (el pedido completo
-- menos los anticipos, relacionados con tipo 07), o facturarse a crédito (método PPD) y recibir
-- después un complemento de pago (CFDI tipo P) por cada abono.
--
--   kind       total      · factura por todo el pedido, pagada (PUE). Lo de siempre; el default.
--              ppd        · factura por todo el pedido a crédito o en parcialidades (PPD, forma 99).
--              anticipo   · factura de anticipo o pago parcial por un monto.
--              finiquito  · factura final: el pedido menos los anticipos facturados.
--              pago       · complemento de pago de una factura PPD; `parent_id` es esa factura.
--   parent_id  la factura PPD a la que pertenece un complemento. Nulo en las demás.
--
-- Los links de autofactura llevan el tipo de la factura que producirán (total o anticipo).

alter table public.invoices add column if not exists kind text not null default 'total';
alter table public.invoices add column if not exists parent_id uuid references public.invoices (id) on delete cascade;
create index if not exists invoices_parent_idx on public.invoices (parent_id) where parent_id is not null;
