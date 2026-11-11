"use client";
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { getFiscalProfile, issueInvoice, notifyInvoice } from "@/app/(app)/invoicing/actions";
import { InvoiceSummaryView, InvoiceKindPicker, RetentionPicker, useInvoicePreview, satIncomplete, groupIncomplete, suggestedAdvance } from "@/components/InvoiceSummary";
import type { FiscalData } from "@/lib/invoicing";
import type { InvoicingProvider } from "@/lib/plugins";
import type { InvoiceKind, KindChoice } from "@/lib/invoiceKinds";

// Issue a CFDI 4.0 for the order. One form: the contact's fiscal data (auto-filled from their saved
// profile — recurring customers never retype), CFDI use / payment form selects, and options to save
// the profile + email the invoice. Result: folio fiscal + PDF + WhatsApp notify.
//
// Con Hiraticket Facturación primero se dice qué factura es: por el total (pagada o PPD), un
// anticipo o pago parcial por un monto, o el finiquito del pedido. El resumen de abajo es el de esa
// factura. Con anticipos ya facturados la ventana abre en «Finiquito».

const TAX_SYSTEMS: [string, string][] = [
  ["601", "601 · General de Ley Personas Morales"],
  ["603", "603 · Personas Morales con Fines no Lucrativos"],
  ["605", "605 · Sueldos y Salarios"],
  ["606", "606 · Arrendamiento"],
  ["612", "612 · PF con Actividades Empresariales"],
  ["616", "616 · Sin obligaciones fiscales"],
  ["621", "621 · Incorporación Fiscal"],
  ["626", "626 · Régimen Simplificado de Confianza (RESICO)"],
];
const CFDI_USES: [string, string][] = [
  ["G03", "G03 · Gastos en general"],
  ["G01", "G01 · Adquisición de mercancías"],
  ["I01", "I01 · Construcciones"],
  ["S01", "S01 · Sin efectos fiscales"],
];
export const PAYMENT_FORMS: [string, string][] = [
  ["03", "03 · Transferencia"],
  ["04", "04 · Tarjeta de crédito"],
  ["28", "28 · Tarjeta de débito"],
  ["01", "01 · Efectivo"],
  ["99", "99 · Por definir"],
];

const EMPTY: FiscalData = { legal_name: "", rfc: "", tax_system: "612", zip: "", email: "", cfdi_use: "G03" };
const ALL_KINDS: InvoiceKind[] = ["total", "ppd", "anticipo", "finiquito"];

export function InvoiceModal({ orderId, contactId, total, lang, provider = null, onClose, onCreated }: {
  orderId: string;
  contactId: string | null;
  total: number;
  lang: "es" | "en";
  /** Plugin de CFDI activo: cambia quién manda el correo y qué se ofrece al terminar. */
  provider?: InvoicingProvider | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fiscal, setFiscal] = useState<FiscalData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [hadProfile, setHadProfile] = useState(false);
  const [saveProfile, setSaveProfile] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [paymentForm, setPaymentForm] = useState("03");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ invoiceId: string | null; uuid: string | null; pdfUrl: string | null; publicUrl: string | null; simulated: boolean; kind: InvoiceKind } | null>(null);
  const [notified, setNotified] = useState(false);
  const fx = provider === "hiraticket_facturacion";
  const es = lang === "es";
  // Qué factura es. Solo con Facturación; Facturapi factura el total y ya.
  const [choice, setChoice] = useState<KindChoice>({ kind: "total" });
  const touched = useRef(false);
  const pick = (c: KindChoice) => { touched.current = true; setChoice(c); };
  // Cuánto va a decir la factura. Puede no ser el total del pedido: si el negocio suma el IVA al
  // facturar y el pedido se cobró sin él, la factura sale por más.
  // El mismo resumen que se ve antes de mandar el link: conceptos, impuestos y total, y los datos
  // del SAT que falten se piden aquí.
  const { preview, missing, sat, patch, setGroup, groupChoice, saveDefault, setSaveDefault, retention, setRetention, saveRetention, setSaveRetention } = useInvoicePreview(orderId, fx ? choice : null);
  // Con anticipos ya facturados, lo que toca es el finiquito: la ventana abre ahí.
  useEffect(() => {
    if (!fx || touched.current || !preview) return;
    if (preview.anticipos.count > 0 && choice.kind !== "finiquito") setChoice({ kind: "finiquito" });
  }, [fx, preview, choice.kind]);
  const [foliosUrl, setFoliosUrl] = useState<string | null>(null);
  const invoiceTotal = preview?.ok ? preview.total : total;
  const kind = fx ? choice.kind : "total";

  useEffect(() => {
    if (!contactId) { setLoaded(true); return; }
    getFiscalProfile(contactId).then((p) => { if (p) { setFiscal(p); setHadProfile(true); } setLoaded(true); }).catch(() => setLoaded(true));
  }, [contactId]);

  const set = (k: keyof FiscalData, v: string) => setFiscal((f) => ({ ...f, [k]: v }));
  const rfcOk = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(fiscal.rfc.trim());
  const valid = fiscal.legal_name.trim().length > 2 && rfcOk && /^\d{5}$/.test(fiscal.zip.trim()) && !!fiscal.tax_system;
  const advanceBad = kind === "anticipo" && (!((choice.amount ?? 0) > 0) || (!!preview && (choice.amount ?? 0) > preview.orderTotal - preview.anticipos.total + 0.005));

  const submit = async () => {
    setBusy(true); setErr(null);
    // El aviso de "la factura lleva IVA" está a la vista en este mismo formulario: emitir es aceptarlo.
    const r = await issueInvoice(orderId, fiscal, kind === "ppd" ? "99" : paymentForm, saveProfile, sendEmail && !!fiscal.email?.trim(), !!preview?.addsTax, false, sat, groupChoice, saveDefault, fx ? { kind, amount: choice.amount } : null, fx ? retention : null, fx && saveRetention);
    setBusy(false);
    if (!r.ok) {
      setErr(r.code === "confirm-tax" ? (es ? `La factura saldrá por ${money(r.total ?? 0)} (se suma el IVA). Vuelve a pulsar Emitir para confirmar.` : `The invoice will be for ${money(r.total ?? 0)} (tax added). Press Issue again to confirm.`)
        : r.code === "sin-folios" ? (es ? "Tu cuenta de Hiraticket Facturación no tiene folios. Los folios se compran ahí; en cuanto tengas, vuelve a emitir." : "Your Hiraticket Facturación account has no folios left. Folios are bought there; once you have some, issue again.")
        : r.code === "retry" ? (es ? "No se pudo confirmar el timbrado. Vuelve a intentar: si ya se timbró se recupera la misma factura, no se duplica." : "Couldn't confirm the stamping. Try again: if it was already stamped the same invoice is recovered, not duplicated.")
        : r.code === "disconnected" ? (es ? "Se perdió la conexión con Facturación. Un administrador debe volver a conectar el plugin en Plugins." : "The connection to the invoicing account was lost. An admin must reconnect the plugin in Plugins.")
        : r.code === "link-changed" ? (es ? "El link de este pedido ya no estaba abierto (se cerró o la venta entró a la factura global). Ya quedó al día: vuelve a pulsar Emitir." : "This order's link was no longer open (it was closed or the sale went into the global invoice). It's up to date now: press Issue again.")
        : r.error === "already-issued" ? (es ? "Este pedido ya tiene factura: el cliente se facturó con el link. Cierra esta ventana para verla." : "This order already has an invoice: the customer used the link. Close this window to see it.")
        : r.error === "needs-finiquito" ? (es ? "Este pedido ya tiene anticipos facturados: lo que lo cierra es el finiquito. Elige «Finiquito»." : "This order already has invoiced advances: the final invoice is what closes it. Pick \"Final invoice\".")
        : r.error === "no-anticipo" ? (es ? "No hay anticipos facturados en este pedido: emite la factura por el total." : "There are no invoiced advances on this order: issue the invoice for the full amount.")
        : r.error === "kind-unsupported" ? (es ? "Con Facturapi solo se factura por el total." : "With Facturapi only the full amount can be invoiced.")
        : r.error === "migration-0104" ? (es ? "Falta aplicar la migración 0104 para facturar anticipos, finiquitos y PPD." : "Migration 0104 is needed to invoice advances, final invoices and PPD.")
        : r.error === "not-configured" ? (es ? "Falta terminar de configurar el plugin (llave y RFC)." : "Finish setting up the plugin (key and RFC).")
        : r.error === "no-items" ? (es ? "El pedido no tiene artículos con precio." : "The order has no priced items.")
        : r.error === "non-positive" ? (kind === "finiquito"
          ? (es ? "Los anticipos facturados ya cubren todo el pedido: no queda nada que facturar en el finiquito." : "The invoiced advances already cover the whole order: nothing is left for the final invoice.")
          : kind === "anticipo" ? (es ? "Escribe el monto del anticipo." : "Enter the advance amount.")
          : (es ? "No hay nada que facturar: el total del pedido es cero o negativo." : "Nothing to invoice: the order total is zero or negative."))
        : r.error ? (es ? `No se pudo timbrar: ${r.error}` : `Couldn't stamp: ${r.error}`)
        : (es ? "No se pudo conectar con el servicio de facturación. Intenta de nuevo." : "Couldn't reach the invoicing service. Try again."));
      setFoliosUrl(r.code === "sin-folios" ? r.foliosUrl ?? null : null);
      return;
    }
    setResult({ invoiceId: r.invoiceId ?? null, uuid: r.uuid ?? null, pdfUrl: r.pdfUrl ?? null, publicUrl: r.publicUrl ?? null, simulated: !!r.simulated, kind: r.kind ?? kind });
    onCreated();
  };

  const money = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2 });
  const issueLabel = kind === "anticipo" ? (es ? "Facturar anticipo" : "Invoice advance")
    : kind === "finiquito" ? (es ? "Emitir finiquito" : "Issue final invoice")
    : kind === "ppd" ? (es ? "Emitir factura PPD" : "Issue PPD invoice")
    : (es ? "Emitir factura" : "Issue invoice");
  const doneTitle = (k: InvoiceKind) => k === "anticipo" ? (es ? "¡Anticipo timbrado!" : "Advance stamped!")
    : k === "finiquito" ? (es ? "¡Finiquito timbrado!" : "Final invoice stamped!")
    : (es ? "¡Factura timbrada!" : "Invoice stamped!");

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 600 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="file" /></span>
          <h3 className="grow">{result ? (es ? "Factura emitida" : "Invoice issued") : (es ? "Emitir factura (CFDI 4.0)" : "Issue invoice (CFDI 4.0)")}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        {!result ? (
          <>
            <div className="modal-body col gap-2">
              {!loaded ? <span className="t-sm muted">…</span> : (
                <>
                  {fx && <InvoiceKindPicker choice={choice} onChange={pick} preview={preview} lang={lang} allow={ALL_KINDS} />}
                  {fx && <RetentionPicker value={retention} onChange={setRetention} preview={preview} lang={lang} save={saveRetention} onSave={setSaveRetention} />}
                  {hadProfile && <div className="t-xs" style={{ color: "var(--green)", fontWeight: 600 }}>✓ {lang === "es" ? "Datos fiscales guardados del cliente" : "Saved fiscal data loaded"}</div>}
                  <div className="col gap-1">
                    <label className="lbl" style={{ margin: 0 }}>Razón social (sin régimen societario)</label>
                    <input className="inp-inline" value={fiscal.legal_name} placeholder="EJEMPLO SA" onChange={(e) => set("legal_name", e.target.value)} />
                  </div>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    <div className="col gap-1" style={{ flex: 1, minWidth: 150 }}>
                      <label className="lbl" style={{ margin: 0 }}>RFC</label>
                      <input className="inp-inline mono" value={fiscal.rfc} placeholder="XAXX010101000" onChange={(e) => set("rfc", e.target.value.toUpperCase())} />
                    </div>
                    <div className="col gap-1" style={{ width: 130 }}>
                      <label className="lbl" style={{ margin: 0 }}>C.P. fiscal</label>
                      <input className="inp-inline mono" value={fiscal.zip} placeholder="00000" onChange={(e) => set("zip", e.target.value)} />
                    </div>
                  </div>
                  <div className="col gap-1">
                    <label className="lbl" style={{ margin: 0 }}>Régimen fiscal</label>
                    <select className="select" value={fiscal.tax_system} onChange={(e) => set("tax_system", e.target.value)}>
                      {TAX_SYSTEMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    <div className="col gap-1" style={{ flex: 1, minWidth: 170 }}>
                      <label className="lbl" style={{ margin: 0 }}>Uso CFDI</label>
                      <select className="select" value={fiscal.cfdi_use} onChange={(e) => set("cfdi_use", e.target.value)}>
                        {CFDI_USES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div className="col gap-1" style={{ flex: 1, minWidth: 170 }}>
                      <label className="lbl" style={{ margin: 0 }}>{es ? "Forma de pago" : "Payment form"}</label>
                      {kind === "ppd"
                        ? <div className="t-xs muted" style={{ padding: "8px 0" }}>{es ? "99 · Por definir: en una PPD la forma real va en cada complemento de pago." : "99 · To be defined: on a PPD the real form goes on each payment complement."}</div>
                        : (
                          <select className="select" value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)}>
                            {PAYMENT_FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        )}
                    </div>
                  </div>
                  <div className="col gap-1">
                    <label className="lbl" style={{ margin: 0 }}>Correo (para enviar la factura)</label>
                    <input className="inp-inline" type="email" value={fiscal.email ?? ""} placeholder="cliente@correo.com" onChange={(e) => set("email", e.target.value)} />
                  </div>
                  <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
                    <span className="t-sm">{lang === "es" ? "Guardar datos fiscales del cliente" : "Save the customer's fiscal data"}</span>
                  </label>
                  <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} disabled={!fiscal.email?.trim()} />
                    <span className="t-sm">{lang === "es" ? "Enviar por correo (PDF + XML)" : "Email the invoice (PDF + XML)"}</span>
                  </label>
                  {preview && preview.error !== "order"
                    ? <InvoiceSummaryView preview={preview} missing={missing} sat={sat} onSat={patch} lang={lang} search={fx} onGroup={fx && kind !== "anticipo" ? setGroup : undefined} saveDefault={saveDefault} onSaveDefault={setSaveDefault} />
                    : (
                      <div className="row" style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                        <span className="grow t-sm" style={{ fontWeight: 700 }}>{lang === "es" ? "Total a facturar (IVA incluido)" : "Invoice total (tax incl.)"}</span>
                        <span className="mono" style={{ fontWeight: 800 }}>{money(invoiceTotal)}</span>
                      </div>
                    )}
                  {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
                  {foliosUrl && <a className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} href={foliosUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} />{es ? "Comprar folios" : "Buy folios"}</a>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" disabled={!valid || busy || advanceBad || satIncomplete(sat) || groupIncomplete(preview) || (!!preview && !preview.ok && (preview.error === "no-items" || preview.error === "non-positive" || preview.error === "needs-finiquito" || preview.error === "no-anticipo"))} onClick={submit}>
                <Icon name="file" size={14} />{busy ? (es ? "Timbrando…" : "Stamping…") : issueLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body col gap-2" style={{ alignItems: "center", textAlign: "center", padding: "18px 16px" }}>
              <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={22} /></span>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{doneTitle(result.kind)}</div>
              {result.uuid && <div className="t-xs muted">Folio fiscal: <span className="mono">{result.uuid}</span></div>}
              {result.simulated && <div className="t-xs" style={{ color: "var(--amber)" }}>{es ? "Factura de práctica: no tiene validez fiscal ni gastó folio." : "Practice invoice: not fiscally valid and no folio was used."}</div>}
              {result.kind === "ppd" && <div className="t-xs muted">{es ? "Cuando el cliente pague, registra cada pago desde el pedido para timbrar su complemento." : "When the customer pays, record each payment from the order to stamp its complement."}</div>}
              {result.kind === "anticipo" && <div className="t-xs muted">{es ? "Al entregar el pedido, emite el finiquito desde aquí mismo: sale por el resto y relaciona este folio." : "On delivery, issue the final invoice from here: it covers the rest and relates this folio."}</div>}
              {fx && sendEmail && !!fiscal.email?.trim() && !result.simulated && <div className="t-xs muted">{es ? `Facturación la envió a ${fiscal.email}.` : `Sent to ${fiscal.email} by the invoicing service.`}</div>}
              <div className="row gap-2" style={{ marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
                {result.pdfUrl && <a className="btn btn-sm btn-outline" href={result.pdfUrl} target="_blank" rel="noreferrer"><Icon name="download" size={14} />PDF</a>}
                {result.publicUrl && <a className="btn btn-sm btn-outline" href={result.publicUrl} target="_blank" rel="noreferrer"><Icon name="external" size={14} />{es ? "Ver factura" : "View invoice"}</a>}
                <button className="btn btn-sm btn-primary" disabled={notified || busy || !result.invoiceId}
                  onClick={async () => { setBusy(true); const r = await notifyInvoice(orderId, result.invoiceId!); setBusy(false); if (r.ok) setNotified(true); else setErr("Este pedido no tiene chat vinculado."); }}>
                  <Icon name="whatsapp" size={14} />{notified ? "Enviado ✓" : "Enviar por WhatsApp"}
                </button>
              </div>
              {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
            </div>
            <div className="modal-foot"><button className="btn btn-outline" onClick={onClose}>Cerrar</button></div>
          </>
        )}
      </div>
    </div>
  );
}
