"use client";
import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import { SatSearch } from "@/components/SatSearch";
import { updateProductsFiscal } from "@/app/(app)/features-actions";
import type { Product } from "@/lib/extras";

// Datos de facturación para varios productos de una vez. Lo que se deja vacío no cambia: así se
// puede ponerles a todos la misma unidad sin tocar la clave que cada uno ya tiene, o al revés.

const UNITS = [
  { code: "H87", es: "Pieza", en: "Piece" },
  { code: "E48", es: "Servicio", en: "Service" },
  { code: "ACT", es: "Actividad", en: "Activity" },
  { code: "MTR", es: "Metro", en: "Meter" },
  { code: "MTK", es: "Metro cuadrado", en: "Square meter" },
  { code: "KGM", es: "Kilogramo", en: "Kilogram" },
  { code: "HUR", es: "Hora", en: "Hour" },
];

export function CatalogBulkFiscal({ products, businessId, lang, onClose, onDone }: {
  products: Product[];
  businessId: string;
  lang: "es" | "en";
  onClose: () => void;
  /** Cuántos productos cambiaron, para el mensaje en el catálogo. */
  onDone: (count: number) => void;
}) {
  const es = lang === "es";
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState("");
  // "keep" = no tocar; "" = el IVA del negocio; "0.16"… = una tasa propia.
  const [iva, setIva] = useState("keep");
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const codeOk = code === "" || /^\d{8}$/.test(code);
  const unitOk = unit === "" || /^[A-Z0-9]{1,3}$/.test(unit);
  const anything = code !== "" || unit !== "" || iva !== "keep";
  const n = products.length;

  const apply = async () => {
    setBusy(true); setErr(null);
    const patch: { sat_code?: string; sat_unit?: string; iva?: number | null } = {};
    if (code) patch.sat_code = code;
    if (unit) patch.sat_unit = unit;
    if (iva !== "keep") patch.iva = iva === "" ? null : Number(iva);
    const r = await updateProductsFiscal(products.map((p) => p.id), patch, onlyEmpty);
    setBusy(false);
    if (!r.ok) { setErr(es ? "No se pudieron guardar los datos. Intenta de nuevo." : "Couldn't save the data. Try again."); return; }
    onDone(r.count);
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="file" /></span>
          <div className="col grow" style={{ minWidth: 0 }}>
            <h3 className="truncate">{es ? "Datos de facturación" : "Invoicing data"}</h3>
            <span className="t-xs muted truncate">{es ? `${n} producto${n === 1 ? "" : "s"} seleccionado${n === 1 ? "" : "s"}` : `${n} product${n === 1 ? "" : "s"} selected`}</span>
          </div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          <div className="t-xs muted">
            {es
              ? "Lo que captures aquí se pone en todos los seleccionados. Lo que dejes vacío no cambia."
              : "What you enter here is set on every selected product. What you leave empty stays as it is."}
          </div>
          <div className="t-xs muted truncate" title={products.map((p) => p.name).join(", ")}>
            {products.slice(0, 6).map((p) => p.name).join(", ")}{n > 6 ? (es ? ` y ${n - 6} más` : ` and ${n - 6} more`) : ""}
          </div>
          <div className="row gap-3" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="col gap-1" style={{ flex: "1 1 240px", minWidth: 0 }}>
              <label className="lbl" style={{ margin: 0 }}>{es ? "Clave SAT (8 dígitos)" : "SAT key (8 digits)"}</label>
              <input className="inp-inline mono" style={{ width: 120, borderColor: codeOk ? undefined : "var(--red)" }} placeholder={es ? "sin cambio" : "no change"} maxLength={8} inputMode="numeric"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              <SatSearch businessId={businessId} kind="productos" lang={lang} onPick={(k) => setCode(k.clave)} />
            </div>
            <div className="col gap-1" style={{ flex: "1 1 220px", minWidth: 0 }}>
              <label className="lbl" style={{ margin: 0 }}>{es ? "Unidad SAT" : "SAT unit"}</label>
              <input className="inp-inline mono" style={{ width: 80, borderColor: unitOk ? undefined : "var(--red)" }} placeholder={es ? "sin cambio" : "none"} maxLength={3}
                value={unit} onChange={(e) => setUnit(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <div className="row gap-1" style={{ flexWrap: "wrap" }}>
                {UNITS.map((u) => (
                  <button key={u.code} type="button" className={"chip" + (unit === u.code ? " on" : "")} onClick={() => setUnit(unit === u.code ? "" : u.code)} title={u.code}>
                    {es ? u.es : u.en}
                  </button>
                ))}
              </div>
              <SatSearch businessId={businessId} kind="unidades" lang={lang} onPick={(k) => setUnit(k.clave)} />
            </div>
            <div className="col gap-1">
              <label className="lbl" style={{ margin: 0 }}>IVA</label>
              <select className="select" style={{ width: 170 }} value={iva} onChange={(e) => setIva(e.target.value)}>
                <option value="keep">{es ? "Sin cambio" : "No change"}</option>
                <option value="">{es ? "El del negocio" : "Business rate"}</option>
                <option value="0.16">16%</option><option value="0.08">8%</option><option value="0">0%</option>
              </select>
            </div>
          </div>
          <label className="row gap-2 t-sm" style={{ alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
            <span>
              {es ? "Solo rellenar lo que falta" : "Only fill what's missing"}
              <span className="muted"> · {es ? "no se pisa lo que un producto ya tenga" : "what a product already has is kept"}</span>
            </span>
          </label>
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy || !anything || !codeOk || !unitOk} onClick={apply}>
            <Icon name="check" size={14} />
            {busy ? (es ? "Guardando…" : "Saving…") : (es ? `Aplicar a ${n}` : `Apply to ${n}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
