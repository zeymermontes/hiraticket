// Tipos de factura de un pedido (0104) y cómo se arma el plan de cada uno. Sin dependencias de
// servidor: lo usan las ventanas de facturar y las acciones por igual.
//
//   total      por todo el pedido, pagada (PUE). Lo de siempre.
//   ppd        por todo el pedido a crédito o en parcialidades (PPD, forma de pago 99). Cada abono
//              se timbra después como complemento de pago (`pago`).
//   anticipo   anticipo o pago parcial por un monto. Es un CFDI de ingreso con un solo concepto,
//              clave 84111506 y unidad ACT, como lo pide la guía de llenado del SAT (apéndice 6).
//   finiquito  la factura final: los conceptos del pedido con un descuento igual a lo que ya se
//              facturó en anticipos (sin IVA), relacionando sus folios con el tipo 07.
//   pago       complemento de pago (CFDI tipo P) de una factura PPD.
//
// Un pedido queda facturado cuando tiene una factura que lo cierra: total, ppd o finiquito.

import { lineAmounts, linesTotal, fixedTaxFor, type InvoiceLine, type InvoicePlan } from "@/lib/invoiceLines";

export type InvoiceKind = "total" | "ppd" | "anticipo" | "finiquito" | "pago";
export const INVOICE_KINDS: InvoiceKind[] = ["total", "ppd", "anticipo", "finiquito", "pago"];

/** Lo que se eligió al facturar: el tipo y, para un anticipo, su monto con IVA incluido. */
export interface KindChoice { kind: InvoiceKind; amount?: number }

/** Una factura de este tipo deja el pedido facturado (ya no se ofrece facturarlo otra vez). */
export const closesOrder = (kind: string | null | undefined): boolean => !kind || kind === "total" || kind === "ppd" || kind === "finiquito";

export const asKind = (v: unknown): InvoiceKind => (INVOICE_KINDS as string[]).includes(v as string) ? (v as InvoiceKind) : "total";

/** Clave, unidad y descripción que el SAT pide para un anticipo. */
export const ANTICIPO_SAT = { code: "84111506", unit: "ACT", description: "Anticipo del bien o servicio" } as const;
/** c_TipoRelacion: la factura final relaciona los anticipos que le aplican. */
export const RELACION_ANTICIPO = "07";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que se descuenta en el finiquito por un anticipo: su importe sin IVA. */
export const anticipoNet = (total: number, iva: number) => r2((Number(total) || 0) / (1 + iva));

/**
 * El concepto de un anticipo por `amount` (con IVA incluido). El precio va a centavos y el IVA se
 * fija para que precio + IVA den exactamente el monto ($500, no $499.99); si el redondeo no lo
 * permite dentro del centavo que tolera el SAT, se queda base × tasa y el total del plan dice lo
 * que saldrá de verdad.
 */
export function anticipoLine(amount: number, iva: number, orderCode: string): InvoiceLine {
  const line: InvoiceLine = {
    description: `${ANTICIPO_SAT.description} · Pedido ${orderCode}`, qty: 1, price: r2(amount / (1 + iva)), discount: 0, iva,
    satCode: ANTICIPO_SAT.code, satUnit: ANTICIPO_SAT.unit, key: "anticipo",
  };
  const ivaTotal = fixedTaxFor(line, r2(amount));
  return ivaTotal === undefined ? line : { ...line, ivaTotal };
}

/** El plan de un anticipo: un solo concepto por `amount`, con la tasa general del plan del pedido. */
export function anticipoPlan(base: InvoicePlan, amount: number, orderCode: string): InvoicePlan {
  const amt = r2(Number(amount) || 0);
  const empty: InvoicePlan = { ok: false, error: "non-positive", mode: base.mode, rate: base.rate, lines: [], total: 0, orderTotal: base.orderTotal, addsTax: false };
  if (!(amt > 0)) return empty;
  const line = anticipoLine(amt, base.rate / 100, orderCode);
  return { ok: true, mode: base.mode, rate: base.rate, lines: [line], total: lineAmounts(line).total, orderTotal: base.orderTotal, addsTax: false };
}

/**
 * El plan del finiquito: los conceptos del pedido con `net` (lo facturado en anticipos, sin IVA)
 * repartido como descuento, renglón por renglón hasta agotarlo. Si los anticipos ya cubren todo
 * el pedido no queda nada que facturar (eso sería una nota de crédito, no un finiquito).
 * `gross` es lo facturado en anticipos con IVA: cuando el finiquito es un solo concepto, su IVA se
 * fija para que factura + anticipos sumen exactamente lo que diría la factura por el total.
 */
export function finiquitoPlan(base: InvoicePlan, net: number, gross = 0): InvoicePlan {
  if (!base.ok) return base;
  let left = r2(Math.max(0, Number(net) || 0));
  const lines = base.lines.map((l) => {
    if (left <= 0) return l;
    const take = r2(Math.min(lineAmounts(l).base, left));
    left = r2(left - take);
    return take > 0 ? { ...l, discount: r2(l.discount + take), ivaTotal: undefined } : l;
  });
  if (lines.length === 1 && gross > 0) {
    const ivaTotal = fixedTaxFor(lines[0], r2(base.total - gross));
    if (ivaTotal !== undefined) lines[0] = { ...lines[0], ivaTotal };
  }
  const total = linesTotal(lines);
  const plan: InvoicePlan = { ...base, lines, total, single: undefined };
  if (left > 0.005 || total <= 0) return { ...plan, ok: false, error: "non-positive" };
  return plan;
}

export function invoiceKindLabel(kind: string | null | undefined, lang: "es" | "en" = "es"): string {
  switch (kind) {
    case "ppd": return lang === "es" ? "Factura PPD" : "PPD invoice";
    case "anticipo": return lang === "es" ? "Anticipo" : "Advance";
    case "finiquito": return lang === "es" ? "Finiquito" : "Final invoice";
    case "pago": return lang === "es" ? "Complemento de pago" : "Payment complement";
    default: return lang === "es" ? "Factura" : "Invoice";
  }
}
