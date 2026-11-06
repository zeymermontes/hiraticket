"use client";
import React, { useEffect, useRef, useState } from "react";
import { SatSearch } from "@/components/SatSearch";
import { previewInvoice, type InvoicePreview } from "@/app/(app)/invoicing/actions";
import type { InvoiceSummary, SatOverrides } from "@/lib/invoiceLines";

// Lo que va a decir la factura de un pedido, antes de mandar el link o de timbrar: los conceptos
// con su clave y unidad del SAT, subtotal, descuento, impuestos y total. Si a un concepto le
// faltan la clave o la unidad, aquí mismo se piden: antes el link salía con la clave genérica sin
// que nadie lo viera, y el total de la factura se conocía hasta que el cliente la recibía.
//
// Lo comparten la ventana del link y la de emitir la factura.

type Missing = InvoiceSummary["missing"];

// Las unidades que cubren casi todo lo que vende un negocio; cualquier otra se escribe o se busca.
const COMMON_UNITS: [string, string][] = [
  ["H87", "Pieza"], ["E48", "Servicio"], ["ACT", "Actividad"], ["MTR", "Metro"], ["MTK", "Metro cuadrado"],
  ["HUR", "Hora"], ["KGM", "Kilogramo"], ["LTR", "Litro"], ["XBX", "Caja"], ["XPK", "Paquete"],
];

const money = (n: number) => "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (f: number) => `${Math.round(f * 10000) / 100}%`;

/**
 * El resumen del pedido y lo que se va capturando. `missing` se queda con los renglones a los que
 * les faltaban datos al abrir: si se recalculara con cada tecla, el campo desaparecería en cuanto
 * se escribe la clave y antes de capturar la unidad.
 */
export function useInvoicePreview(orderId: string) {
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [missing, setMissing] = useState<Missing | null>(null);
  const [sat, setSat] = useState<SatOverrides>({});
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current; // una respuesta vieja no pisa a la de lo último que se escribió
    const t = setTimeout(() => {
      previewInvoice(orderId, sat).then((p) => {
        if (seq.current !== id) return;
        setPreview(p);
        setMissing((m) => m ?? p.summary.missing);
      }).catch(() => {});
    }, Object.keys(sat).length ? 350 : 0);
    return () => clearTimeout(t);
  }, [orderId, sat]);
  const patch = (key: string, v: { code?: string; unit?: string }) => setSat((s) => ({ ...s, [key]: { ...s[key], ...v } }));
  return { preview, missing: missing ?? [], sat, patch };
}

export function InvoiceSummaryView({ preview, missing, sat, onSat, lang, search }: {
  preview: InvoicePreview;
  missing: Missing;
  sat: SatOverrides;
  onSat: (key: string, v: { code?: string; unit?: string }) => void;
  lang: "es" | "en";
  /** Hay de dónde buscar claves por nombre (Hiraticket Facturación). */
  search: boolean;
}) {
  const es = lang === "es";
  const s = preview.summary;
  if (!preview.ok) {
    if (preview.error !== "no-items" && preview.error !== "non-positive") return null;
    return (
      <div className="t-xs" style={{ color: "var(--red)" }}>
        {preview.error === "no-items" ? (es ? "El pedido no tiene artículos con precio." : "The order has no priced items.") : (es ? "No hay nada que facturar: el total del pedido es cero o negativo." : "Nothing to invoice: the order total is zero or negative.")}
      </div>
    );
  }
  const diff = Math.round((preview.total - preview.orderTotal) * 100) / 100;
  const cents = Math.abs(Math.round(diff * 100));
  const warn: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, background: "var(--amber-bg)", color: "var(--amber)", border: "1px solid var(--amber-bd)" };
  const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div className="col gap-2">
      {missing.length > 0 && (
        <div className="col gap-2" style={warn}>
          <div className="t-sm" style={{ fontWeight: 700 }}>
            {missing.length === 1
              ? (es ? "A un concepto le faltan datos del SAT" : "One line is missing SAT data")
              : (es ? `A ${missing.length} conceptos les faltan datos del SAT` : `${missing.length} lines are missing SAT data`)}
          </div>
          {missing.map((m) => {
            const v = sat[m.key] ?? {};
            const badCode = !!v.code && !/^\d{8}$/.test(v.code);
            return (
              <div key={m.key} className="col gap-1" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
                <div className="t-sm" style={{ fontWeight: 600 }}>{m.description}</div>
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                  {m.code && (
                    <div className="col gap-1">
                      <label className="lbl" style={{ margin: 0 }}>{es ? "Clave SAT (8 dígitos)" : "SAT key (8 digits)"}</label>
                      <input className="inp-inline mono" style={{ width: 120, ...(badCode ? { borderColor: "var(--red)" } : {}) }} placeholder="01010101" maxLength={8} inputMode="numeric"
                        value={v.code ?? ""} onChange={(e) => onSat(m.key, { code: e.target.value.replace(/\D/g, "") })} />
                    </div>
                  )}
                  {m.unit && (
                    <div className="col gap-1">
                      <label className="lbl" style={{ margin: 0 }}>{es ? "Unidad SAT" : "SAT unit"}</label>
                      <input className="inp-inline mono" style={{ width: 96 }} placeholder="H87" maxLength={3} list="sat-common-units"
                        value={v.unit ?? ""} onChange={(e) => onSat(m.key, { unit: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
                    </div>
                  )}
                  {m.unit && (
                    <div className="row gap-1" style={{ flexWrap: "wrap", paddingBottom: 2 }}>
                      {COMMON_UNITS.slice(0, 5).map(([c, n]) => (
                        <button key={c} type="button" className={"chip" + (v.unit === c ? " on" : "")} style={{ cursor: "pointer" }} onClick={() => onSat(m.key, { unit: c })}>{n}</button>
                      ))}
                    </div>
                  )}
                </div>
                {m.code && search && preview.businessId && <SatSearch businessId={preview.businessId} kind="productos" lang={lang} onPick={(k) => onSat(m.key, { code: k.clave })} />}
                <div className="t-xs muted">
                  {m.inCatalog
                    ? (es ? "Se guardan en el producto del catálogo: no se vuelven a pedir." : "Saved to the catalog product: you won't be asked again.")
                    : (es ? "Este renglón no es un producto del catálogo: se usan solo en esta factura." : "This line isn't a catalog product: used for this invoice only.")}
                </div>
              </div>
            );
          })}
          <datalist id="sat-common-units">{COMMON_UNITS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</datalist>
          <div className="t-xs">
            {preview.exact
              ? (es
                ? "Si lo dejas vacío, este pedido se factura como un solo concepto por el total exacto, con la clave genérica 01010101. Si capturas la clave o la unidad, el concepto se desglosa y el redondeo del IVA puede mover la factura un centavo."
                : "If left empty, this order is invoiced as a single line for the exact total, with the generic key 01010101. If you enter the key or unit, the line is itemised and tax rounding may move the invoice by one cent.")
              : (es
                ? "Lo que dejes vacío sale con la clave genérica 01010101 («No existe en el catálogo») y la unidad E48 (servicio)."
                : "Anything left empty goes out with the generic key 01010101 and unit E48 (service).")}
          </div>
        </div>
      )}

      <div className="col" style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div className="row gap-2 t-xs muted" style={{ padding: "6px 10px", background: "var(--surface-2)", fontWeight: 600 }}>
          <span className="grow">{es ? "Concepto" : "Line"}</span>
          <span style={{ ...num, width: 44 }}>{es ? "Cant." : "Qty"}</span>
          <span style={{ ...num, width: 84 }}>{es ? "P. unitario" : "Unit price"}</span>
          <span style={{ ...num, width: 88 }}>{es ? "Importe" : "Amount"}</span>
        </div>
        {s.lines.map((l, i) => (
          <div key={i} className="row gap-2" style={{ padding: "7px 10px", borderTop: "1px solid var(--border)", alignItems: "flex-start" }}>
            <div className="col grow" style={{ minWidth: 0 }}>
              <span className="t-sm" style={{ wordBreak: "break-word" }}>{l.description}</span>
              <span className="t-xs mono muted">
                <span style={l.satCode ? undefined : { color: "var(--amber)" }}>{l.satCode ?? (es ? "sin clave" : "no key")}</span>
                {" · "}
                <span style={l.satUnit ? undefined : { color: "var(--amber)" }}>{l.satUnit ?? (es ? "sin unidad" : "no unit")}</span>
                {" · IVA "}{pct(l.iva)}
                {l.discount > 0 ? ` · ${es ? "descuento" : "discount"} ${money(l.discount)}` : ""}
              </span>
            </div>
            <span className="mono t-sm" style={{ ...num, width: 44 }}>{l.qty}</span>
            <span className="mono t-sm" style={{ ...num, width: 84 }}>{money(l.price)}</span>
            <span className="mono t-sm" style={{ ...num, width: 88 }}>{money(l.amount)}</span>
          </div>
        ))}
        <div className="col gap-1" style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div className="row t-sm"><span className="grow muted">{es ? "Subtotal (sin impuestos)" : "Subtotal (before tax)"}</span><span className="mono">{money(s.subtotal)}</span></div>
          {s.discount > 0 && <div className="row t-sm"><span className="grow muted">{es ? "Descuento" : "Discount"}</span><span className="mono">−{money(s.discount)}</span></div>}
          <div className="row t-sm"><span className="grow muted">IVA</span><span className="mono">{money(s.tax)}</span></div>
          <div className="row" style={{ paddingTop: 4, borderTop: "1px solid var(--border)" }}>
            <span className="grow t-sm" style={{ fontWeight: 700 }}>{es ? "Total de la factura" : "Invoice total"}</span>
            <span className="mono" style={{ fontWeight: 800 }}>{money(preview.total)}</span>
          </div>
          {cents > 0 && <div className="row t-xs muted"><span className="grow">{es ? "Total del pedido" : "Order total"}</span><span className="mono">{money(preview.orderTotal)}</span></div>}
        </div>
      </div>

      {preview.addsTax ? (
        <div className="t-xs" style={warn}>
          {es
            ? `Este pedido se cobró sin IVA (${money(preview.orderTotal)}). La factura lleva IVA ${preview.rate}% y saldrá por ${money(preview.total)}. Para cobrarle la diferencia al cliente, cierra y marca «Requiere factura» en el pedido.`
            : `This order was charged without tax (${money(preview.orderTotal)}). The invoice adds ${preview.rate}% tax and will be for ${money(preview.total)}. To charge the customer the difference, close this and tick "Requires invoice" on the order.`}
        </div>
      ) : cents > 0 && cents <= 5 ? (
        <div className="t-xs muted">
          {es
            ? `Por el redondeo del IVA la factura sale ${cents === 1 ? "un centavo" : `${cents} centavos`} ${diff > 0 ? "arriba" : "abajo"} de lo cobrado.`
            : `Because of tax rounding the invoice is ${cents} cent${cents === 1 ? "" : "s"} ${diff > 0 ? "above" : "below"} what was charged.`}
        </div>
      ) : null}
    </div>
  );
}

/** ¿Algo de lo capturado está a medias? (una clave que no llega a 8 dígitos). No se manda así. */
export const satIncomplete = (sat: SatOverrides) => Object.values(sat).some((v) => !!v.code && !/^\d{8}$/.test(v.code));
