-- Huella de los conceptos con los que se creó un link de facturación.
--
-- Un link abierto se reutiliza al reenviarlo. Si después de crearlo cambian los datos con los que
-- saldría la factura (se le puso clave SAT al producto, cambió un precio sin mover el total), el
-- link viejo seguía saliendo con lo anterior y no había cómo saberlo. Con la huella guardada, al
-- reenviar se compara con la de hoy: si no coincide, el link se cierra y se manda uno nuevo.
--
-- Un link sin huella (creado antes de esta columna) se trata como desactualizado la primera vez
-- que se reenvía. Sin esta migración la app sigue funcionando: reutiliza por monto, como antes.
alter table public.invoices add column if not exists link_sig text;

-- Clave y unidad del SAT capturadas para un renglón del pedido al momento de facturar.
--
-- Un renglón escrito a mano en el pedido no es un producto del catálogo: lo que se capturaba para
-- él servía solo para ese link y se volvía a pedir cada vez. Aquí se queda en el renglón. También
-- cubre a quien factura sin permiso para editar el catálogo. Si el renglón trae su propio dato,
-- manda sobre el del catálogo.
alter table public.order_items add column if not exists sat_code text;
alter table public.order_items add column if not exists sat_unit text;
