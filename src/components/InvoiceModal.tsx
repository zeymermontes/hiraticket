"use client";
import React, { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { getFiscalProfile, issueInvoice, notifyInvoice } from "@/app/(app)/invoicing/actions";
import type { FiscalData } from "@/lib/invoicing";

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

export function InvoiceModal({ orderId, contactId, total, lang, onClose, onCreated }: {
  orderId: string;
  contactId: string | null;
  total: number;
  lang: "es" | "en";
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
  const [result, setResult] = useState<{ invoiceId: string | null; uuid: string | null; pdfUrl: string | null } | null>(null);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!contactId) { setLoaded(true); return; }
    getFiscalProfile(contactId).then((p) => { if (p) { setFiscal(p); setHadProfile(true); } setLoaded(true); }).catch(() => setLoaded(true));
  }, [contactId]);

  const set = (k: keyof FiscalData, v: string) => setFiscal((f) => ({ ...f, [k]: v }));
  const rfcOk = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(fiscal.rfc.trim());
  const valid = fiscal.legal_name.trim().length > 2 && rfcOk && /^\d{5}$/.test(fiscal.zip.trim()) && !!fiscal.tax_system;

  const submit = async () => {
    setBusy(true); setErr(null);
    const r = await issueInvoice(orderId, fiscal, paymentForm, saveProfile, sendEmail && !!fiscal.email?.trim());
    setBusy(false);
    if (!r.ok) {
      setErr(r.error === "not-configured" ? "Falta la API Key en la configuración del plugin."
        : r.error === "no-items" ? "El pedido no tiene artículos con precio."
        : `No se pudo timbrar: ${r.error ?? "error"}.`);
      return;
    }
    setResult({ invoiceId: r.invoiceId ?? null, uuid: r.uuid ?? null, pdfUrl: r.pdfUrl ?? null });
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
                  <div className="row" style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <span className="grow t-sm" style={{ fontWeight: 700 }}>{lang === "es" ? "Total a facturar (IVA incluido)" : "Invoice total (tax incl.)"}</span>
                    <span className="mono" style={{ fontWeight: 800 }}>{money(total)}</span>
                  </div>
                  {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}><Icon name="file" size={14} />{busy ? "Timbrando…" : "Emitir factura"}</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body col gap-2" style={{ alignItems: "center", textAlign: "center", padding: "18px 16px" }}>
              <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={22} /></span>
              <div style={{ fontWeight: 800, fontSize: 16 }}>¡Factura timbrada!</div>
              {result.uuid && <div className="t-xs muted">Folio fiscal: <span className="mono">{result.uuid}</span></div>}
              <div className="row gap-2" style={{ marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
                {result.pdfUrl && <a className="btn btn-sm btn-outline" href={result.pdfUrl} target="_blank" rel="noreferrer"><Icon name="download" size={14} />PDF</a>}
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
