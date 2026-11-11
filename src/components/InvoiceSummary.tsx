"use client";
import React, { useEffect, useRef, useState } from "react";
import { SatSearch } from "@/components/SatSearch";
import { previewInvoice, type InvoicePreview } from "@/app/(app)/invoicing/actions";
import type { InvoiceSummary, SatOverrides } from "@/lib/invoiceLines";
import type { GroupChoice } from "@/lib/facturacionOps";
import type { InvoiceKind, KindChoice } from "@/lib/invoiceKinds";

/** Lo elegido sobre agrupar; `null` = lo que el negocio tenga por defecto. */
export type GroupState = { on: boolean; productId: string | null } | null;

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
export function useInvoicePreview(orderId: string, choice?: KindChoice | null) {
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [missing, setMissing] = useState<Missing | null>(null);
  const [sat, setSat] = useState<SatOverrides>({});
  // Agrupar todo en un concepto: lo que se elija aquí; null = lo que el negocio tenga por defecto.
  const [group, setGroupState] = useState<GroupState>(null);
  const [saveDefault, setSaveDefault] = useState(false);
  const seq = useRef(0);
  // El tipo de factura y el monto de un anticipo como dependencias planas: un objeto nuevo con lo
  // mismo adentro no vuelve a pedir el resumen.
  const kind = choice?.kind ?? "total";
  const amount = choice?.amount ?? 0;
  useEffect(() => {
    const id = ++seq.current; // una respuesta vieja no pisa a la de lo último que se escribió
    const t = setTimeout(() => {
      previewInvoice(orderId, sat, group as GroupChoice, { kind, amount }).then((p) => {
        if (seq.current !== id) return;
        setPreview(p);
        setMissing((m) => m ?? p.summary.missing);
      }).catch(() => {});
    }, Object.keys(sat).length || kind === "anticipo" ? 350 : 0);
    return () => clearTimeout(t);
  }, [orderId, sat, group, kind, amount]);
  const patch = (key: string, v: { code?: string; unit?: string }) => setSat((s) => ({ ...s, [key]: { ...s[key], ...v } }));
  // Al cambiar cómo se agrupa cambian los conceptos: lo que falte del SAT se vuelve a calcular.
  const setGroup = (g: GroupState) => { setGroupState(g); setMissing(null); setSat({}); };
  // Al cambiar el tipo de factura también: un anticipo no tiene renglones del pedido.
  useEffect(() => { setMissing(null); }, [kind]);
  /** Lo que se manda al servidor: la elección en pantalla (o la de por defecto, ya resuelta). */
  const groupChoice: { on: boolean; productId: string | null } | null = group ?? (preview ? { on: preview.group.on, productId: preview.group.productId } : null);
  return { preview, missing: missing ?? [], sat, patch, group, setGroup, groupChoice, saveDefault, setSaveDefault };
}

/** Se pidió agrupar pero no se ha elegido el concepto: así no se manda. */
export const groupIncomplete = (preview: InvoicePreview | null) => !!preview && preview.group.on && !preview.group.productId;

export function InvoiceSummaryView({ preview, missing, sat, onSat, lang, search, onGroup, saveDefault, onSaveDefault }: {
  preview: InvoicePreview;
  missing: Missing;
  sat: SatOverrides;
  onSat: (key: string, v: { code?: string; unit?: string }) => void;
  lang: "es" | "en";
  /** Hay de dónde buscar claves por nombre (Hiraticket Facturación). */
  search: boolean;
  /** Cambiar cómo se agrupa; sin esto no se ofrece agrupar. */
  onGroup?: (g: { on: boolean; productId: string | null }) => void;
  saveDefault?: boolean;
  onSaveDefault?: (v: boolean) => void;
}) {
  const es = lang === "es";
  const s = preview.summary;
  const g = preview.group;
  const chosen = g.productId ? g.options.find((o) => o.id === g.productId) ?? null : null;
  const differs = g.on !== g.defaultOn || (g.on && g.productId !== g.defaultProductId);
  const groupBlock = onGroup && g.options.length > 0 && (
    <div className="col gap-2" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
      <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={g.on} onChange={(e) => onGroup({ on: e.target.checked, productId: g.productId ?? g.defaultProductId })} />
        <span className="t-sm" style={{ fontWeight: 600 }}>{es ? "Facturar todo como un solo concepto" : "Invoice everything as a single line"}</span>
        {g.defaultOn && <span className="t-xs muted">{es ? "· así está por defecto" : "· the default"}</span>}
      </label>
      {g.on && (
        <div className="col gap-1">
          <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <label className="lbl" style={{ margin: 0 }}>{es ? "Concepto" : "Line item"}</label>
            <select className="select" style={{ minWidth: 220, maxWidth: "100%" }} value={g.productId ?? ""} onChange={(e) => onGroup({ on: true, productId: e.target.value || null })}>
              <option value="">{es ? "Elige un producto o servicio del catálogo…" : "Pick a catalog product or service…"}</option>
              {g.options.map((o) => <option key={o.id} value={o.id}>{o.name}{o.satCode ? ` · ${o.satCode}` : ""}</option>)}
            </select>
          </div>
          <div className="t-xs muted">
            {!chosen
              ? (es ? "El concepto sale con el nombre, la clave SAT, la unidad y el IVA de ese producto del catálogo." : "The line takes the name, SAT key, unit and tax of that catalog product.")
              : preview.groupedCount > 1
              ? (es ? `Los ${preview.groupedCount} renglones del pedido salen como «${chosen.name}», un solo concepto por el total.` : `The order's ${preview.groupedCount} lines go out as "${chosen.name}", one line for the total.`)
              : (es ? `El pedido sale como «${chosen.name}».` : `The order goes out as "${chosen.name}".`)}
          </div>
        </div>
      )}
      {onSaveDefault && differs && (
        <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={!!saveDefault} onChange={(e) => onSaveDefault(e.target.checked)} />
          <span className="t-xs">{g.on
            ? (es ? "Agrupar así por defecto en las próximas facturas de este negocio" : "Group like this by default on this business's next invoices")
            : (es ? "Dejar de agrupar por defecto en este negocio" : "Stop grouping by default on this business")}</span>
        </label>
      )}
    </div>
  );
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
      {groupBlock}
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

/** El monto que se propone para un anticipo: lo pagado que aún no se ha facturado como anticipo, o la mitad del pedido. */
export function suggestedAdvance(preview: InvoicePreview | null): number {
  if (!preview) return 0;
  const pending = Math.round((preview.paid - preview.anticipos.total) * 100) / 100;
  if (pending > 0 && pending < preview.orderTotal) return pending;
  return Math.round((preview.orderTotal / 2) * 100) / 100;
}

/**
 * Qué factura es: por el total (pagada o PPD), un anticipo o pago parcial por un monto, o el
 * finiquito. Con anticipos ya facturados, lo único que cierra el pedido es el finiquito, así que
 * el total queda apagado; sin anticipos no hay finiquito que emitir. `allow` acota las opciones
 * (el link solo sabe de total y anticipo).
 */
export function InvoiceKindPicker({ choice, onChange, preview, lang, allow }: {
  choice: KindChoice;
  onChange: (c: KindChoice) => void;
  preview: InvoicePreview | null;
  lang: "es" | "en";
  allow: InvoiceKind[];
}) {
  const es = lang === "es";
  const anticipos = preview?.anticipos ?? { count: 0, total: 0 };
  const hasAdv = anticipos.count > 0;
  const rate = preview?.rate ?? 16;
  const all: { kind: InvoiceKind; label: string; off: boolean }[] = [
    { kind: "total", label: es ? "Por el total" : "Full amount", off: hasAdv },
    { kind: "ppd", label: es ? "A crédito (PPD)" : "On credit (PPD)", off: hasAdv },
    { kind: "anticipo", label: hasAdv ? (es ? "Otro anticipo o pago parcial" : "Another advance or partial payment") : (es ? "Anticipo o pago parcial" : "Advance or partial payment"), off: false },
    { kind: "finiquito", label: es ? "Finiquito" : "Final invoice", off: !hasAdv },
  ];
  const opts = all.filter((o) => allow.includes(o.kind));
  const advTxt = `${anticipos.count === 1 ? (es ? "1 anticipo facturado" : "1 advance invoiced") : es ? `${anticipos.count} anticipos facturados` : `${anticipos.count} advances invoiced`} (${money(anticipos.total)})`;
  const hint = choice.kind === "ppd"
    ? (es ? "Factura por todo el pedido con método PPD y forma de pago 99 «Por definir». Cada pago que recibas lo timbras después como complemento de pago desde este mismo pedido." : "Invoice for the whole order with method PPD and payment form 99 \"To be defined\". Each payment you receive is stamped later as a payment complement from this same order.")
    : choice.kind === "anticipo"
    ? (es ? `Un CFDI de ingreso por este monto (IVA ${rate}% incluido) con la clave 84111506 «Anticipo del bien o servicio». Cuando entregues, emites el finiquito por el resto y se relacionan los folios.` : `An income CFDI for this amount (${rate}% tax included) with SAT key 84111506 "Advance payment". On delivery you issue the final invoice for the rest and the folios are related.`)
    : choice.kind === "finiquito"
    ? (es ? `El pedido completo con un descuento por ${advTxt}, relacionados con tipo 07. La factura sale por la diferencia.` : `The whole order with a discount for ${advTxt}, related with type 07. The invoice is for the difference.`)
    : hasAdv
    ? (es ? `Ya hay ${advTxt}: lo que cierra el pedido es el finiquito.` : `There is already ${advTxt}: the final invoice is what closes the order.`)
    : (es ? "Una sola factura por todo el pedido, pagada (PUE)." : "One invoice for the whole order, paid (PUE).");
  const amount = choice.amount ?? 0;
  const max = preview ? Math.max(0, Math.round((preview.orderTotal - anticipos.total) * 100) / 100) : 0;
  const pct = (p: number) => onChange({ kind: "anticipo", amount: Math.round(((preview?.orderTotal ?? 0) * p) * 100) / 100 });
  return (
    <div className="col gap-2" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-sm" style={{ fontWeight: 600 }}>{es ? "¿Qué factura es?" : "Which invoice is this?"}</span>
        <div className="row gap-1" style={{ flexWrap: "wrap" }} role="radiogroup">
          {opts.map((o) => (
            <button key={o.kind} type="button" role="radio" aria-checked={choice.kind === o.kind} disabled={o.off} data-kind={o.kind}
              className={"chip" + (choice.kind === o.kind ? " on" : "")} style={{ cursor: o.off ? "not-allowed" : "pointer", opacity: o.off ? 0.5 : 1 }}
              onClick={() => onChange(o.kind === "anticipo" ? { kind: "anticipo", amount: amount > 0 ? amount : suggestedAdvance(preview) } : { kind: o.kind })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {choice.kind === "anticipo" && (
        <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <label className="lbl" style={{ margin: 0 }}>{es ? "Monto del anticipo (IVA incluido)" : "Advance amount (tax included)"}</label>
          <input className="inp-inline mono" type="number" inputMode="decimal" min={0.01} step="0.01" max={max || undefined} style={{ width: 130 }} data-testid="advance-amount"
            value={amount > 0 ? String(amount) : ""} onChange={(e) => onChange({ kind: "anticipo", amount: Math.round((Number(e.target.value) || 0) * 100) / 100 })} />
          <div className="row gap-1" style={{ flexWrap: "wrap" }}>
            {preview && preview.paid - anticipos.total > 0 && preview.paid - anticipos.total < preview.orderTotal && (
              <button type="button" className="chip" style={{ cursor: "pointer" }} onClick={() => onChange({ kind: "anticipo", amount: Math.round((preview.paid - anticipos.total) * 100) / 100 })}>
                {es ? "Lo pagado" : "Paid so far"} · {money(preview.paid - anticipos.total)}
              </button>
            )}
            <button type="button" className="chip" style={{ cursor: "pointer" }} onClick={() => pct(0.5)}>50 %</button>
            <button type="button" className="chip" style={{ cursor: "pointer" }} onClick={() => pct(0.3)}>30 %</button>
          </div>
          {preview && amount > max + 0.005 && (
            <span className="t-xs" style={{ color: "var(--red)" }}>
              {es ? `Con los anticipos de antes pasaría del total del pedido (${money(preview.orderTotal)}). Máximo ${money(max)}.` : `With earlier advances it would exceed the order total (${money(preview.orderTotal)}). At most ${money(max)}.`}
            </span>
          )}
        </div>
      )}
      <div className="t-xs muted">{hint}</div>
    </div>
  );
}
