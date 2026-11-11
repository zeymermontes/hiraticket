// Retenciones de ISR e IVA en la factura. Las mismas opciones que ofrece Hiraticket Facturación al
// timbrar a mano: se eligen por factura (dependen de quién recibe, no del producto) y aplican a
// todos los conceptos; el IVA retenido solo donde se cobra IVA. Sin dependencias de servidor.

import { lineAmounts, linesTotal, type InvoicePlan } from "@/lib/invoiceLines";

export interface RetentionPreset { id: string; es: string; en: string; isr: number; iva: number }

export const RETENTIONS: RetentionPreset[] = [
  { id: "", es: "Sin retenciones", en: "No withholding", isr: 0, iva: 0 },
  { id: "honorarios", es: "Honorarios o arrendamiento a persona moral (ISR 10 % · IVA 10.6667 %)", en: "Professional fees or rent to a company (ISR 10% · VAT 10.6667%)", isr: 0.1, iva: 0.106667 },
  { id: "resico", es: "RESICO a persona moral (ISR 1.25 %)", en: "RESICO to a company (ISR 1.25%)", isr: 0.0125, iva: 0 },
  { id: "resico-iva", es: "RESICO a persona moral con IVA retenido (ISR 1.25 % · IVA 10.6667 %)", en: "RESICO to a company with VAT withheld (ISR 1.25% · VAT 10.6667%)", isr: 0.0125, iva: 0.106667 },
  { id: "fletes", es: "Autotransporte de carga (IVA 4 %)", en: "Freight transport (VAT 4%)", isr: 0, iva: 0.04 },
];

export const retentionOf = (id: string | null | undefined): RetentionPreset => RETENTIONS.find((r) => r.id === (id ?? "")) ?? RETENTIONS[0];
export const isRetentionId = (id: unknown): id is string => typeof id === "string" && RETENTIONS.some((r) => r.id === id);

/** Nombre corto para una tarjeta o un hilo: «ISR 10 % · IVA 10.6667 %». */
export function retentionShort(id: string | null | undefined): string {
  const r = retentionOf(id);
  const parts = [r.isr ? `ISR ${Math.round(r.isr * 10000) / 100} %` : "", r.iva ? `IVA ${Math.round(r.iva * 1e6) / 1e4} %` : ""].filter(Boolean);
  return parts.join(" · ");
}

/**
 * El plan con las retenciones del preset en cada concepto. Con retención ya no vale el atajo de
 * «un concepto por el total exacto» (ese lo timbra el link sin desglose), así que se quita y se
 * mandan los conceptos; el total baja lo retenido.
 */
export function withRetention(plan: InvoicePlan, id: string | null | undefined): InvoicePlan {
  const r = retentionOf(id);
  if (!plan.ok || (!r.isr && !r.iva)) return plan;
  const lines = plan.lines.map((l) => ({ ...l, ...(r.isr ? { retIsr: r.isr } : {}), ...(r.iva && l.iva > 0 ? { retIva: r.iva } : {}) }));
  const total = linesTotal(lines);
  if (total <= 0) return { ...plan, lines, total, single: undefined, ok: false, error: "non-positive" };
  return { ...plan, lines, total, single: undefined, retention: r.id };
}

/** Lo retenido en total (ISR + IVA) de un plan. */
export const retainedOf = (plan: InvoicePlan) => Math.round(plan.lines.reduce((s, l) => { const a = lineAmounts(l); return s + a.retIsr + a.retIva; }, 0) * 100) / 100;
