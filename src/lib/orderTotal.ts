/** La fórmula del total de un pedido, en un solo lugar (la usan el servidor al guardar y la UI y
 *  los reportes para detectar un total desactualizado):
 *    total = (suma de renglones − descuento) × (1 + IVA)   si el pedido requiere factura
 *    total =  suma de renglones − descuento                 si no
 *  El IVA y el descuento no son renglones: por eso "ventas" y "productos" nunca coinciden. */
export function computeOrderTotal(base: number, discount: number, taxRate: number): number {
  const taxed = base - Math.min(base, Math.max(0, discount));
  return taxRate > 0 ? Math.round(taxed * (1 + taxRate / 100) * 100) / 100 : Math.round(taxed * 100) / 100;
}

/** Desglose de un pedido a partir de sus renglones y lo guardado en la fila. */
export function orderBreakdown(o: { total: number; discount?: number | null; requires_invoice?: boolean | null; tax_rate?: number | null; items?: { subtotal?: number | null }[] | null }) {
  const items = (o.items ?? []).reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
  const discount = Math.min(items, Math.max(0, Number(o.discount) || 0));
  const rate = o.requires_invoice ? Number(o.tax_rate) || 0 : 0;
  const tax = Math.round((items - discount) * (rate / 100) * 100) / 100;
  const expected = computeOrderTotal(items, discount, rate);
  const total = Number(o.total) || 0;
  const diff = Math.round((total - expected) * 100) / 100;
  return { items, discount, rate, tax, expected, diff, mismatch: Math.abs(diff) >= 0.01 };
}
