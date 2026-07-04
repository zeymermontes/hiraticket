"use client";
import React, { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import {
  listContactAddresses, deleteContactAddress, quoteOrderShipment, createOrderShipment, notifyTracking, type SavedAddress,
} from "@/app/(app)/shipping/actions";
import type { ShipAddress, ShipParcel, ShipRate } from "@/lib/shipping";

// Generate-label flow: Destino (saved addresses for recurring customers, or a new one) →
// Paquete (weight/dims) → Cotización (pick a carrier rate) → Listo (tracking + label + notify).
// One modal, linear steps, back always available. Only reachable when a shipping plugin is active.

type Step = "dest" | "parcel" | "rates" | "done";

const EMPTY_ADDR: ShipAddress = { receiver: "", phone: "", street: "", colonia: "", city: "", state: "", zip: "", reference: "" };

export function ShippingModal({ orderId, contact, lang, onClose, onCreated }: {
  orderId: string;
  contact: { id: string; name: string; phone: string | null } | null;
  lang: "es" | "en";
  onClose: () => void;
  onCreated: () => void; // refetch the order detail
}) {
  const [step, setStep] = useState<Step>("dest");
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [selId, setSelId] = useState<string | "new">("new");
  const [addr, setAddr] = useState<ShipAddress>({ ...EMPTY_ADDR, receiver: contact?.name ?? "", phone: contact?.phone ?? "" });
  const [remember, setRemember] = useState(true);
  const [parcel, setParcel] = useState({ weight: "1", length: "20", width: "20", height: "10" });
  const [rates, setRates] = useState<ShipRate[]>([]);
  const [rateId, setRateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ shipmentId: string | null; tracking: string; labelUrl: string | null } | null>(null);
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (!contact?.id) { setLoadingSaved(false); return; }
    listContactAddresses(contact.id).then((a) => {
      setSaved(a);
      if (a.length) { setSelId(a[0].id); }
      setLoadingSaved(false);
    }).catch(() => setLoadingSaved(false));
  }, [contact?.id]);

  const dest: ShipAddress = selId === "new" ? addr : (saved.find((s) => s.id === selId) ?? addr);
  const destValid = !!(dest.receiver.trim() && dest.phone.trim() && dest.street.trim() && dest.city.trim() && dest.state.trim() && /^\d{5}$/.test(dest.zip.trim()));
  const parcelNums: ShipParcel = { weight: Number(parcel.weight) || 0, length: Number(parcel.length) || 0, width: Number(parcel.width) || 0, height: Number(parcel.height) || 0 };
  const parcelValid = parcelNums.weight > 0 && parcelNums.length > 0 && parcelNums.width > 0 && parcelNums.height > 0;

  const quote = async () => {
    setBusy(true); setErr(null);
    const r = await quoteOrderShipment(orderId, dest, parcelNums, selId === "new" && remember);
    setBusy(false);
    if (!r.ok || r.rates.length === 0) {
      setErr(r.error === "not-configured"
        ? (lang === "es" ? "Faltan credenciales u origen en la configuración del plugin." : "Missing credentials/origin in the plugin config.")
        : r.error === "auth" ? (lang === "es" ? "Credenciales de Skydropx inválidas." : "Invalid Skydropx credentials.")
        : (lang === "es" ? "No se pudieron obtener tarifas. Revisa dirección y CP." : "Couldn't fetch rates. Check the address and zip."));
      return;
    }
    setRates(r.rates); setRateId(r.rates[0]?.id ?? null); setStep("rates");
  };

  const create = async () => {
    const rate = rates.find((x) => x.id === rateId);
    if (!rate) return;
    setBusy(true); setErr(null);
    const r = await createOrderShipment(orderId, rate.quotationId, rate.id, dest, parcelNums);
    setBusy(false);
    if (!r.ok || !r.tracking) { setErr(lang === "es" ? "No se pudo generar la guía. Intenta de nuevo." : "Couldn't create the label. Try again."); return; }
    setResult({ shipmentId: r.shipmentId ?? null, tracking: r.tracking, labelUrl: r.labelUrl ?? null });
    setStep("done");
    onCreated();
  };

  const field = (label: string, key: keyof ShipAddress, ph: string, width?: number) => (
    <div className="col gap-1" style={width ? { width } : { flex: 1, minWidth: 130 }}>
      <label className="lbl" style={{ margin: 0 }}>{label}</label>
      <input className="inp-inline" value={(addr[key] as string) ?? ""} placeholder={ph} onChange={(e) => setAddr((a) => ({ ...a, [key]: e.target.value }))} />
    </div>
  );

  const money = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2 });

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="send" /></span>
          <h3 className="grow">{lang === "es" ? "Generar guía de envío" : "Create shipping label"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="modal-body col gap-3">
          {/* step indicator */}
          <div className="row gap-1" style={{ alignItems: "center" }}>
            {(["dest", "parcel", "rates"] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <span style={{ width: 18, height: 1, background: "var(--border)" }} />}
                <Pill color={step === s ? "brand" : (["dest", "parcel", "rates"].indexOf(step) > i || step === "done") ? "green" : "slate"} dot>
                  {s === "dest" ? (lang === "es" ? "Destino" : "Address") : s === "parcel" ? (lang === "es" ? "Paquete" : "Package") : (lang === "es" ? "Paquetería" : "Rates")}
                </Pill>
              </React.Fragment>
            ))}
          </div>

          {step === "dest" && (
            <>
              {loadingSaved ? <span className="t-sm muted">…</span> : saved.length > 0 && (
                <div className="col gap-2">
                  <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Direcciones guardadas" : "Saved addresses"}</label>
                  {saved.map((a) => (
                    <label key={a.id} className="row gap-2" style={{ alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: "2px solid " + (selId === a.id ? "var(--brand)" : "var(--border)"), background: selId === a.id ? "var(--brand-50)" : "var(--surface)" }}>
                      <input type="radio" name="addr" checked={selId === a.id} onChange={() => setSelId(a.id)} style={{ marginTop: 3 }} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, fontSize: 13.5 }}>{a.receiver || contact?.name} · {a.phone}</span>
                        <span className="t-xs muted">{a.street}{a.colonia ? `, ${a.colonia}` : ""}, {a.city}, {a.state} {a.zip}</span>
                      </span>
                      <button className="iconbtn sm" title={lang === "es" ? "Eliminar dirección" : "Delete address"}
                        onClick={(ev) => { ev.preventDefault(); deleteContactAddress(a.id).then(() => setSaved((s) => { const n = s.filter((x) => x.id !== a.id); if (selId === a.id) setSelId(n[0]?.id ?? "new"); return n; })); }}>
                        <Icon name="trash" size={13} />
                      </button>
                    </label>
                  ))}
                  <label className="row gap-2" style={{ alignItems: "center", padding: "8px 12px", borderRadius: 10, cursor: "pointer", border: "2px solid " + (selId === "new" ? "var(--brand)" : "var(--border)"), background: selId === "new" ? "var(--brand-50)" : "var(--surface)" }}>
                    <input type="radio" name="addr" checked={selId === "new"} onChange={() => setSelId("new")} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Nueva dirección" : "New address"}</span>
                  </label>
                </div>
              )}
              {selId === "new" && (
                <div className="col gap-2">
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    {field(lang === "es" ? "Recibe" : "Receiver", "receiver", contact?.name ?? "")}
                    {field(lang === "es" ? "Teléfono" : "Phone", "phone", "55 0000 0000")}
                  </div>
                  {field(lang === "es" ? "Calle y número" : "Street & number", "street", "Av. Ejemplo 123")}
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    {field("Colonia", "colonia", "Centro")}
                    {field(lang === "es" ? "Ciudad" : "City", "city", "")}
                  </div>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    {field(lang === "es" ? "Estado" : "State", "state", "")}
                    {field("C.P.", "zip", "00000", 110)}
                  </div>
                  {field(lang === "es" ? "Referencias (opcional)" : "Reference (optional)", "reference", lang === "es" ? "Portón negro…" : "")}
                  <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    <span className="t-sm">{lang === "es" ? "Guardar esta dirección para futuros envíos" : "Save this address for future shipments"}</span>
                  </label>
                </div>
              )}
            </>
          )}

          {step === "parcel" && (
            <div className="col gap-2">
              <p className="t-sm muted">{lang === "es" ? "Peso y medidas del paquete (con empaque)." : "Package weight & dimensions (packed)."}</p>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {([["weight", lang === "es" ? "Peso (kg)" : "Weight (kg)"], ["length", lang === "es" ? "Largo (cm)" : "Length (cm)"], ["width", lang === "es" ? "Ancho (cm)" : "Width (cm)"], ["height", lang === "es" ? "Alto (cm)" : "Height (cm)"]] as const).map(([k, label]) => (
                  <div key={k} className="col gap-1" style={{ width: 118 }}>
                    <label className="lbl" style={{ margin: 0 }}>{label}</label>
                    <input className="inp-inline mono" type="number" min={0} step="0.1" value={parcel[k]} onChange={(e) => setParcel((p) => ({ ...p, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="t-xs muted">{lang === "es" ? `Destino: ${dest.street}, ${dest.city} ${dest.zip}` : `To: ${dest.street}, ${dest.city} ${dest.zip}`}</div>
            </div>
          )}

          {step === "rates" && (
            <div className="col gap-2">
              {rates.map((r) => (
                <label key={r.id} className="row gap-2" style={{ alignItems: "center", padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: "2px solid " + (rateId === r.id ? "var(--brand)" : "var(--border)"), background: rateId === r.id ? "var(--brand-50)" : "var(--surface)" }}>
                  <input type="radio" name="rate" checked={rateId === r.id} onChange={() => setRateId(r.id)} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>{r.carrier}{r.service ? ` · ${r.service}` : ""}</span>
                    {r.eta ? <span className="t-xs muted">{lang === "es" ? `Entrega: ${r.eta}` : `Delivery: ${r.eta}`}</span>
                      : r.days != null && <span className="t-xs muted">{lang === "es" ? `Entrega estimada: ${r.days} día${r.days === 1 ? "" : "s"}` : `Est. delivery: ${r.days} day${r.days === 1 ? "" : "s"}`}</span>}
                  </span>
                  <span className="mono" style={{ fontWeight: 800 }}>{money(r.total)}</span>
                </label>
              ))}
            </div>
          )}

          {step === "done" && result && (
            <div className="col gap-2" style={{ alignItems: "center", textAlign: "center", padding: "8px 0" }}>
              <span style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={22} /></span>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{lang === "es" ? "¡Guía generada!" : "Label created!"}</div>
              <div className="t-sm">{lang === "es" ? "Rastreo:" : "Tracking:"} <span className="mono" style={{ fontWeight: 700 }}>{result.tracking}</span></div>
              <div className="row gap-2" style={{ marginTop: 6 }}>
                {result.labelUrl && <a className="btn btn-sm btn-outline" href={result.labelUrl} target="_blank" rel="noreferrer"><Icon name="download" size={14} />{lang === "es" ? "Etiqueta PDF" : "Label PDF"}</a>}
                <button className="btn btn-sm btn-primary" disabled={notified || busy || !result.shipmentId} onClick={async () => { setBusy(true); const r = await notifyTracking(orderId, result.shipmentId!); setBusy(false); if (r.ok) setNotified(true); else setErr(lang === "es" ? "Este pedido no tiene chat vinculado." : "This order has no linked chat."); }}>
                  <Icon name="whatsapp" size={14} />{notified ? (lang === "es" ? "Enviado ✓" : "Sent ✓") : (lang === "es" ? "Enviar rastreo por WhatsApp" : "WhatsApp the tracking")}
                </button>
              </div>
            </div>
          )}

          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>

        <div className="modal-foot">
          {step === "parcel" && <button className="btn btn-outline" style={{ marginRight: "auto" }} onClick={() => setStep("dest")}>{lang === "es" ? "Atrás" : "Back"}</button>}
          {step === "rates" && <button className="btn btn-outline" style={{ marginRight: "auto" }} onClick={() => setStep("parcel")}>{lang === "es" ? "Atrás" : "Back"}</button>}
          <button className="btn btn-outline" onClick={onClose}>{step === "done" ? (lang === "es" ? "Cerrar" : "Close") : (lang === "es" ? "Cancelar" : "Cancel")}</button>
          {step === "dest" && <button className="btn btn-primary" disabled={!destValid} onClick={() => setStep("parcel")}>{lang === "es" ? "Continuar" : "Continue"}<Icon name="arrowr" size={14} /></button>}
          {step === "parcel" && <button className="btn btn-primary" disabled={!parcelValid || busy} onClick={quote}><Icon name="refresh" size={14} />{busy ? (lang === "es" ? "Cotizando…" : "Quoting…") : (lang === "es" ? "Cotizar" : "Get rates")}</button>}
          {step === "rates" && <button className="btn btn-primary" disabled={!rateId || busy} onClick={create}><Icon name="send" size={14} />{busy ? (lang === "es" ? "Generando…" : "Creating…") : (lang === "es" ? "Generar guía" : "Create label")}</button>}
        </div>
      </div>
    </div>
  );
}
