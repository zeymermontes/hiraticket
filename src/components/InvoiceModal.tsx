"use client";
import React, { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { getFiscalProfile, issueInvoice, notifyInvoice, previewInvoice, type InvoicePreview } from "@/app/(app)/invoicing/actions";
import type { FiscalData } from "@/lib/invoicing";
import type { InvoicingProvider } from "@/lib/plugins";

// Issue a CFDI 4.0 for the order. One form: the contact's fiscal data (auto-filled from their saved
// profile — recurring customers never retype), CFDI use / payment form selects, and options to save
// the profile + email the invoice. Result: folio fiscal + PDF + WhatsApp notify.

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
const PAYMENT_FORMS: [string, string][] = [
  ["03", "03 · Transferencia"],
  ["04", "04 · Tarjeta de crédito"],
  ["28", "28 · Tarjeta de débito"],
  ["01", "01 · Efectivo"],
  ["99", "99 · Por definir"],
];

const EMPTY: FiscalData = { legal_name: "", rfc: "", tax_system: "612", zip: "", email: "", cfdi_use: "G03" };

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
  const [result, setResult] = useState<{ invoiceId: string | null; uuid: string | null; pdfUrl: string | null; publicUrl: string | null; simulated: boolean } | null>(null);
  const [notified, setNotified] = useState(false);
  // Cuánto va a decir la factura. Puede no ser el total del pedido: si el negocio suma el IVA al
  // facturar y el pedido se cobró sin él, la factura sale por más.
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [foliosUrl, setFoliosUrl] = useState<string | null>(null);
  const fx = provider === "hiraticket_facturacion";
  const es = lang === "es";
  useEffect(() => { previewInvoice(orderId).then(setPreview).catch(() => {}); }, [orderId]);
  const invoiceTotal = preview?.ok ? preview.total : total;

  useEffect(() => {
    if (!contactId) { setLoaded(true); return; }
    getFiscalProfile(contactId).then((p) => { if (p) { setFiscal(p); setHadProfile(true); } setLoaded(true); }).catch(() => setLoaded(true));
  }, [contactId]);

  const set = (k: keyof FiscalData, v: string) => setFiscal((f) => ({ ...f, [k]: v }));
  const rfcOk = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(fiscal.rfc.trim());
  const valid = fiscal.legal_name.trim().length > 2 && rfcOk && /^\d{5}$/.test(fiscal.zip.trim()) && !!fiscal.tax_system;

  const submit = async () => {
    setBusy(true); setErr(null);
    // El aviso de "la factura lleva IVA" está a la vista en este mismo formulario: emitir es aceptarlo.
    const r = await issueInvoice(orderId, fiscal, paymentForm, saveProfile, sendEmail && !!fiscal.email?.trim(), !!preview?.addsTax);
    setBusy(false);
    if (!r.ok) {
      setErr(r.code === "confirm-tax" ? (es ? `La factura saldrá por ${money(r.total ?? 0)} (se suma el IVA). Vuelve a pulsar Emitir para confirmar.` : `The invoice will be for ${money(r.total ?? 0)} (tax added). Press Issue again to confirm.`)
        : r.code === "sin-folios" ? (es ? "Tu cuenta de Hiraticket Facturación no tiene folios. Los folios se compran ahí; en cuanto tengas, vuelve a emitir." : "Your Hiraticket Facturación account has no folios left. Folios are bought there; once you have some, issue again.")
        : r.code === "retry" ? (es ? "No se pudo confirmar el timbrado. Vuelve a intentar: si ya se timbró se recupera la misma factura, no se duplica." : "Couldn't confirm the stamping. Try again: if it was already stamped the same invoice is recovered, not duplicated.")
        : r.code === "link-changed" ? (es ? "El link de este pedido ya no estaba abierto (se cerró o la venta entró a la factura global). Ya quedó al día: vuelve a pulsar Emitir." : "This order's link was no longer open (it was closed or the sale went into the global invoice). It's up to date now: press Issue again.")
        : r.error === "already-issued" ? (es ? "Este pedido ya tiene factura: el cliente se facturó con el link. Cierra esta ventana para verla." : "This order already has an invoice: the customer used the link. Close this window to see it.")
        : r.error === "not-configured" ? (es ? "Falta terminar de configurar el plugin (llave y RFC)." : "Finish setting up the plugin (key and RFC).")
        : r.error === "no-items" ? (es ? "El pedido no tiene artículos con precio." : "The order has no priced items.")
        : r.error === "non-positive" ? (es ? "No hay nada que facturar: el total del pedido es cero o negativo." : "Nothing to invoice: the order total is zero or negative.")
        : r.error ? (es ? `No se pudo timbrar: ${r.error}` : `Couldn't stamp: ${r.error}`)
        : (es ? "No se pudo conectar con el servicio de facturación. Intenta de nuevo." : "Couldn't reach the invoicing service. Try again."));
      setFoliosUrl(r.code === "sin-folios" ? r.foliosUrl ?? null : null);
      if (r.code === "confirm-tax") setPreview((p) => (p ? { ...p, addsTax: true, total: r.total ?? p.total } : p));
      return;
    }
    setResult({ invoiceId: r.invoiceId ?? null, uuid: r.uuid ?? null, pdfUrl: r.pdfUrl ?? null, publicUrl: r.publicUrl ?? null, simulated: !!r.simulated });
    onCreated();
  };

  const money = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2 });

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="file" /></span>
          <h3 className="grow">{result ? "Factura emitida" : "Emitir factura (CFDI 4.0)"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        {!result ? (
          <>
            <div className="modal-body col gap-2">
              {!loaded ? <span className="t-sm muted">…</span> : (
                <>
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
                      <label className="lbl" style={{ margin: 0 }}>Forma de pago</label>
                      <select className="select" value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)}>
                        {PAYMENT_FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
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
                  {preview?.ok && preview.addsTax && (
                    <div className="t-xs" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--amber-bg)", color: "var(--amber)", border: "1px solid var(--amber-bd)" }}>
                      {es
                        ? `Este pedido se cobró sin IVA (${money(preview.orderTotal)}). La factura lleva IVA ${preview.rate}% y saldrá por ${money(preview.total)}. Para cobrarle la diferencia al cliente, cierra y marca «Requiere factura» en el pedido.`
                        : `This order was charged without tax (${money(preview.orderTotal)}). The invoice adds ${preview.rate}% tax and will be for ${money(preview.total)}. To charge the customer the difference, close this and tick "Requires invoice" on the order.`}
                    </div>
                  )}
                  {preview && !preview.ok && (preview.error === "no-items" || preview.error === "non-positive") && (
                    <div className="t-xs" style={{ color: "var(--red)" }}>
                      {preview.error === "no-items" ? (es ? "El pedido no tiene artículos con precio." : "The order has no priced items.") : (es ? "No hay nada que facturar: el total del pedido es cero o negativo." : "Nothing to invoice: the order total is zero or negative.")}
                    </div>
                  )}
                  <div className="row" style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <span className="grow t-sm" style={{ fontWeight: 700 }}>{lang === "es" ? "Total a facturar (IVA incluido)" : "Invoice total (tax incl.)"}</span>
                    <span className="mono" style={{ fontWeight: 800 }}>{money(invoiceTotal)}</span>
                  </div>
                  {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
                  {foliosUrl && <a className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} href={foliosUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} />{es ? "Comprar folios" : "Buy folios"}</a>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" disabled={!valid || busy || (!!preview && !preview.ok && (preview.error === "no-items" || preview.error === "non-positive"))} onClick={submit}><Icon name="file" size={14} />{busy ? "Timbrando…" : "Emitir factura"}</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body col gap-2" style={{ alignItems: "center", textAlign: "center", padding: "18px 16px" }}>
              <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={22} /></span>
              <div style={{ fontWeight: 800, fontSize: 16 }}>¡Factura timbrada!</div>
              {result.uuid && <div className="t-xs muted">Folio fiscal: <span className="mono">{result.uuid}</span></div>}
              {result.simulated && <div className="t-xs" style={{ color: "var(--amber)" }}>{es ? "Factura de práctica: no tiene validez fiscal ni gastó folio." : "Practice invoice: not fiscally valid and no folio was used."}</div>}
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
