
-- Clave y unidad del SAT capturadas para un renglón del pedido al momento de facturar.
--
-- Un renglón escrito a mano en el pedido no es un producto del catálogo: lo que se capturaba para
-- él servía solo para ese link y se volvía a pedir cada vez. Aquí se queda en el renglón. También
-- cubre a quien factura sin permiso para editar el catálogo. Si el renglón trae su propio dato,
-- manda sobre el del catálogo.
alter table public.order_items add column if not exists sat_code text;
alter table public.order_items add column if not exists sat_unit text;
