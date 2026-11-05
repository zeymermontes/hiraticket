// De un pedido a los conceptos de su factura. Una sola regla para todos los proveedores de CFDI,
// para que el mismo pedido no se facture por montos distintos según el plugin activo.
//
// Los precios de un pedido significan cosas distintas según cómo cobra el negocio:
//
//   · "order-rate"   El pedido tiene IVA congelado (se marcó «Requiere factura»): `unit_price` va
//                    SIN IVA y el total del pedido ya lo trae. Se factura a esa tasa.
//   · "adds-tax"     El pedido se cobró sin IVA y el negocio lo suma al facturar
//                    (`invoice_add_tax`). `unit_price` es sin IVA y la factura sale por MÁS de lo
//                    cobrado: quien llama lo avisa antes de timbrar.
//   · "tax-included" El negocio no suma IVA al facturar: sus precios ya lo incluyen. Se desglosa
//                    hacia atrás (precio / 1.16) y la factura sale por lo mismo que el pedido.
//
// Un CFDI no admite conceptos negativos ni en cero. El descuento del pedido y los renglones
// negativos (un reembolso capturado como renglón) se reparten como descuento, en proporción, entre
// los renglones positivos; así se conserva el detalle y la clave SAT de cada producto.
//
// Sin dependencias de servidor: se usa también para enseñar el total antes de timbrar.

export type InvoiceMode = "order-rate" | "adds-tax" | "tax-included";

export interface InvoiceLine {
  description: string;
  qty: number;
  /** Precio unitario SIN impuestos (hasta 6 decimales). */
  price: number;
  /** Descuento del renglón, monto SIN impuestos. 0 si no hay. */
  discount: number;
  /** Tasa de IVA como fracción: 0, 0.08, 0.16. */
  iva: number;
  satCode?: string;
  satUnit?: string;
  sku?: string;
}

export interface InvoicePlan {
  ok: boolean;
  error?: "no-items" | "non-positive";
  mode: InvoiceMode;
  /** Tasa general usada, en porcentaje (16). Un producto puede traer la suya. */
  rate: number;
  lines: InvoiceLine[];
  /** Total que tendrá el CFDI (con la misma aritmética por renglón que usa el timbrado). */
  total: number;
  orderTotal: number;
  /** La factura sale por más de lo que dice el pedido porque el IVA se suma al facturar. */
  addsTax: boolean;
  /**
   * Un solo concepto por el total exacto, con IVA incluido. Solo viene cuando los conceptos
   * desglosados no pueden sumar lo cobrado (p. ej. 2 × $250 = $500 da $499.99 al desglosar) y
   * pasarlo a un concepto no pierde nada fiscal: un solo renglón, al 16 %, sin descuento y sin
   * clave SAT propia. Hiraticket Facturación timbra ese total exacto; `total` ya lo refleja.
   */
  single?: { total: number; description: string };
}

export interface PlanInput {
  order: { total: number; tax_rate: number | null; discount: number | null };
  business: { invoice_add_tax: boolean; invoice_tax_rate: number };
  items: { name: string | null; qty: number | null; unit_price: number | null; subtotal?: number | null }[];
  /** Datos fiscales del catálogo, por nombre normalizado (`productKey`). */
  products?: Map<string, { id: string; sat_code: string | null; sat_unit: string | null; iva: number | null }>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Llave para casar un renglón del pedido con su producto del catálogo: los renglones no guardan
 *  el id del producto, solo el nombre con el que se agregaron. */
export const productKey = (name: string | null | undefined) => (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Importes de un renglón como los calcula el timbrado: cada paso redondeado a centavos. */
export function lineAmounts(l: InvoiceLine) {
  const sub = r2(l.qty * l.price);
  const discount = r2(Math.min(l.discount || 0, sub));
  const base = r2(sub - discount);
  const tax = r2(base * l.iva);
  return { sub, discount, base, tax, total: r2(base + tax) };
}
export const linesTotal = (lines: InvoiceLine[]) => r2(lines.reduce((s, l) => s + lineAmounts(l).total, 0));

export function planInvoice(input: PlanInput): InvoicePlan {
  const orderTotal = r2(Number(input.order.total) || 0);
  const orderRate = Number(input.order.tax_rate) || 0;
  const bizRate = Number(input.business.invoice_tax_rate ?? 16) || 0;
  const mode: InvoiceMode = orderRate > 0 ? "order-rate" : input.business.invoice_add_tax ? "adds-tax" : "tax-included";
  const rate = orderRate > 0 ? orderRate : bizRate;
  const fail = (error: InvoicePlan["error"]): InvoicePlan => ({ ok: false, error, mode, rate, lines: [], total: 0, orderTotal, addsTax: false });

  // Importe de cada renglón en la moneda en que el negocio lo capturó (con o sin IVA, según el modo).
  const rows = input.items.map((it) => {
    const qty = Number(it.qty) || 0;
    const amount = it.subtotal != null ? Number(it.subtotal) || 0 : qty * (Number(it.unit_price) || 0);
    return { it, qty: qty > 0 ? qty : 1, amount: r2(amount) };
  });
  const positive = rows.filter((r) => r.amount > 0);
  if (!positive.length) return fail("no-items");

  const base = r2(rows.reduce((s, r) => s + r.amount, 0));
  const sumPos = r2(positive.reduce((s, r) => s + r.amount, 0));
  const discountApplied = Math.min(Math.max(base, 0), Math.max(0, Number(input.order.discount) || 0));
  // Lo que hay que quitarle a los renglones positivos: el descuento del pedido y los renglones negativos.
  const reduce = r2(sumPos - base + discountApplied);
  if (r2(sumPos - reduce) <= 0) return fail("non-positive");

  let left = reduce;
  const lines: InvoiceLine[] = positive.map((r, i) => {
    const prod = input.products?.get(productKey(r.it.name));
    // Con IVA congelado en el pedido el total ya se calculó a esa tasa para todo: la del producto no aplica.
    const iva = mode === "order-rate" ? rate / 100 : prod?.iva != null ? Number(prod.iva) : rate / 100;
    const share = i === positive.length - 1 ? left : Math.min(r.amount, r2((reduce * r.amount) / sumPos));
    left = r2(left - share);
    const div = mode === "tax-included" ? 1 + iva : 1;
    return {
      description: (r.it.name || "").trim() || "Artículo",
      qty: r.qty,
      price: r6(r.amount / r.qty / div),
      discount: r2(Math.max(0, Math.min(share, r.amount)) / div),
      iva,
      ...(prod?.sat_code ? { satCode: prod.sat_code } : {}),
      ...(prod?.sat_unit ? { satUnit: prod.sat_unit } : {}),
      ...(prod?.id ? { sku: prod.id } : {}),
    };
  });

  // Al desglosar el IVA hacia atrás, el redondeo por renglón puede dejar la factura a un centavo de
  // lo cobrado. Se corrige moviendo unos centavos la base de los dos renglones más grandes (sus
  // precios ya son números derivados, no los que capturó el negocio): subir uno, bajar otro o
  // pasar centavos entre ellos cambia hacia dónde redondea el IVA de cada uno.
  if (mode === "tax-included") {
    const diff0 = r2(linesTotal(lines) - orderTotal);
    if (diff0 !== 0 && Math.abs(diff0) <= 0.05) {
      const order = lines.map((l, i) => ({ i, sub: lineAmounts(l).sub })).sort((a, b) => b.sub - a.sub);
      const A = order[0], B = order[1];
      const withSub = (l: InvoiceLine, sub: number): InvoiceLine | null => {
        const price = r6(sub / l.qty);
        return price > 0 && r2(l.qty * price) === r2(sub) ? { ...l, price } : null;
      };
      let best: { cost: number; diff: number; a: InvoiceLine; b?: InvoiceLine } = { cost: 0, diff: Math.abs(diff0), a: lines[A.i], b: B ? lines[B.i] : undefined };
      for (let ka = -4; ka <= 4; ka++) {
        for (let kb = B ? -4 : 0; kb <= (B ? 4 : 0); kb++) {
          if (ka === 0 && kb === 0) continue;
          const a = withSub(lines[A.i], A.sub + ka * 0.01);
          const b = B ? withSub(lines[B.i], B.sub + kb * 0.01) : undefined;
          if (!a || (B && !b)) continue;
          const trial = lines.slice(); trial[A.i] = a; if (B && b) trial[B.i] = b;
          const d = Math.abs(r2(linesTotal(trial) - orderTotal));
          const cost = Math.abs(ka) + Math.abs(kb);
          if (d < best.diff - 1e-9 || (Math.abs(d - best.diff) < 1e-9 && cost < best.cost)) best = { cost, diff: d, a, b: b ?? undefined };
        }
      }
      lines[A.i] = best.a;
      if (B && best.b) lines[B.i] = best.b;
    }
  }

  const total = linesTotal(lines);
  if (total <= 0) return fail("non-positive");
  // Lo que ni así cuadra y es un pedido de un solo renglón sin datos fiscales propios se factura
  // como un concepto por el total exacto (ver `single`).
  const only = lines.length === 1 ? lines[0] : null;
  if (mode === "tax-included" && only && total !== orderTotal && orderTotal > 0 && only.discount === 0 && only.iva === 0.16
    && (!only.satCode || only.satCode === "01010101")) {
    const description = only.qty === 1 ? only.description : `${only.qty} × ${only.description}`;
    return { ok: true, mode, rate, lines, total: orderTotal, orderTotal, addsTax: false, single: { total: orderTotal, description } };
  }
  return { ok: true, mode, rate, lines, total, orderTotal, addsTax: mode === "adds-tax" && total > orderTotal + 0.005 };
}

/** Precio de catálogo de Hiraticket → precio sin impuestos (el que guarda Facturación). */
export function toNetPrice(price: number, business: { invoice_add_tax: boolean; invoice_tax_rate: number }, iva: number | null): number {
  if (business.invoice_add_tax) return r6(price);
  const f = iva != null ? Number(iva) : (Number(business.invoice_tax_rate ?? 16) || 0) / 100;
  return r6(price / (1 + f));
}
/** Precio sin impuestos de Facturación → precio de catálogo de Hiraticket (a centavos). */
export function fromNetPrice(net: number, business: { invoice_add_tax: boolean; invoice_tax_rate: number }, iva: number | null): number {
  if (business.invoice_add_tax) return r2(net);
  const f = iva != null ? Number(iva) : (Number(business.invoice_tax_rate ?? 16) || 0) / 100;
  return r2(net * (1 + f));
}
