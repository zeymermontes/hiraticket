"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { CatalogEntry, PluginPricing } from "@/lib/plugins";
import { installPlugin, uninstallPlugin, setPluginEnabled, savePluginConfig } from "@/app/(app)/plugins/actions";

// Mirror of secrets.MASK — kept local so this client bundle never imports node:crypto.
const MASK = "••••••••";

const CATEGORY_LABEL: Record<string, { es: string; en: string }> = {
  payments: { es: "Pagos", en: "Payments" },
  invoicing: { es: "Facturación", en: "Invoicing" },
  shipping: { es: "Envíos", en: "Shipping" },
  automation: { es: "Automatización", en: "Automation" },
  ai: { es: "IA", en: "AI" },
};

function priceBadge(p: PluginPricing, lang: "es" | "en"): string {
  switch (p.model) {
    case "addon": return `$${Number(p.addon_monthly ?? 0).toLocaleString("es-MX")}/${lang === "es" ? "mes" : "mo"}`;
    case "metered": return lang === "es" ? `$${p.metered_price} por ${p.metered_unit}` : `$${p.metered_price} per ${p.metered_unit}`;
    case "revshare": return p.note || (lang === "es" ? "Comisión de partner" : "Partner commission");
    default: return lang === "es" ? "Gratis" : "Free";
  }
}

export function PluginsScreen({ businessId, entries, isAdmin }: { businessId: string; entries: CatalogEntry[]; isAdmin: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [cat, setCat] = useState<string>("all");
  const [configId, setConfigId] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  const cats = Array.from(new Set(entries.map((e) => e.category)));
  const shown = cat === "all" ? entries : entries.filter((e) => e.category === cat);
  const configEntry = entries.find((e) => e.id === configId) ?? null;

  return (
    <div className="page">
      <div className="phead">
        <h1>Plugins</h1>
        <Pill color="slate" large>{entries.filter((e) => e.installed?.status === "active").length} {lang === "es" ? "activos" : "active"}</Pill>
        <span className="t-sm muted hide-narrow" style={{ marginLeft: 8 }}>{lang === "es" ? "Conecta servicios de pago, facturación y envíos" : "Connect payment, invoicing and shipping services"}</span>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ padding: "0 24px 24px" }}>
          <div className="chip-row" style={{ marginBottom: 14 }}>
            <button className={"chip" + (cat === "all" ? " on" : "")} onClick={() => setCat("all")}>{lang === "es" ? "Todos" : "All"}</button>
            {cats.map((c) => <button key={c} className={"chip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]?.[lang] ?? c}</button>)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
            {shown.map((e) => {
              const inst = e.installed;
              const soon = e.status === "coming_soon";
              const active = inst?.status === "active";
              return (
                <section key={e.id} className="ws-block" style={{ margin: 0 }}>
                  <div style={{ padding: "14px 16px" }} className="col gap-2">
                    <div className="row gap-2" style={{ alignItems: "flex-start" }}>
                      <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--brand-50)", color: "var(--brand-700)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={e.icon || "sparkles"} size={20} /></span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row gap-1" style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{e.name}</span>
                          {e.popular && <Pill color="brand">{lang === "es" ? "Popular" : "Popular"}</Pill>}
                        </div>
                        <span className="t-xs muted">{CATEGORY_LABEL[e.category]?.[lang] ?? e.category}{e.provider ? ` · ${e.provider}` : ""}</span>
                      </div>
                      {active && <Pill color="green" dot>{lang === "es" ? "Activo" : "Active"}</Pill>}
                      {inst && !active && <Pill color="amber" dot>{lang === "es" ? "Pausado" : "Paused"}</Pill>}
                    </div>

                    <p className="t-sm muted" style={{ minHeight: 34 }}>{e.description}</p>

                    <div className="row gap-2" style={{ alignItems: "center" }}>
                      <Pill color="slate"><Icon name="orders" size={11} />{priceBadge(e.pricing, lang)}</Pill>
                      <span className="grow" />
                      {soon && !inst ? (
                        <Pill color="violet">{lang === "es" ? "Próximamente" : "Coming soon"}</Pill>
                      ) : !inst ? (
                        <button className="btn btn-sm btn-primary" disabled={!isAdmin} onClick={() => run(() => installPlugin(businessId, e.id))}><Icon name="plus" size={14} />{lang === "es" ? "Activar" : "Activate"}</button>
                      ) : (
                        <>
                          {e.config_schema.length > 0 && <button className="btn btn-sm btn-outline" disabled={!isAdmin} onClick={() => setConfigId(e.id)}><Icon name="sliders" size={14} />{lang === "es" ? "Configurar" : "Configure"}</button>}
                          <button className={"chip" + (active ? " on" : "")} disabled={!isAdmin} onClick={() => run(() => setPluginEnabled(businessId, e.id, !active))}>{active ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}</button>
                        </>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          {!isAdmin && <p className="t-xs muted" style={{ marginTop: 16 }}>{lang === "es" ? "Solo un administrador puede activar o configurar plugins." : "Only an admin can activate or configure plugins."}</p>}
        </div>
      </div>

      {configEntry && <ConfigModal key={configEntry.id} businessId={businessId} entry={configEntry} lang={lang} onClose={() => setConfigId(null)} onSaved={() => { setConfigId(null); router.refresh(); }} />}
    </div>
  );
}

function ConfigModal({ businessId, entry, lang, onClose, onSaved }: { businessId: string; entry: CatalogEntry; lang: "es" | "en"; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(entry.installed?.config ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  const save = async () => {
    // Required fields: allow the mask sentinel (means "already set") to satisfy a required secret.
    for (const f of entry.config_schema) {
      if (f.required && f.type !== "toggle") {
        const v = values[f.key];
        if (!v || (typeof v === "string" && !v.trim())) { setErr((lang === "es" ? "Falta: " : "Missing: ") + f.label); return; }
      }
    }
    setBusy(true); setErr(null);
    const r = await savePluginConfig(businessId, entry.id, values);
    setBusy(false);
    if (r.ok) onSaved(); else setErr(lang === "es" ? "No se pudo guardar." : "Couldn't save.");
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name={entry.icon || "sparkles"} /></span>
          <h3 className="grow">{lang === "es" ? "Configurar" : "Configure"} {entry.name}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          {entry.config_schema.map((f) => (
            <div key={f.key} className="col gap-1">
              <label className="lbl" style={{ margin: 0 }}>{f.label}{f.required ? " *" : ""}</label>
              {f.type === "toggle" ? (
                <button className={"chip" + (values[f.key] ? " on" : "")} onClick={() => set(f.key, !values[f.key])} style={{ alignSelf: "flex-start" }}>{values[f.key] ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}</button>
              ) : f.type === "select" ? (
                <select className="select" value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="inp-inline" type={f.type === "secret" ? "password" : "text"} value={String(values[f.key] ?? "")}
                  placeholder={f.type === "secret" ? MASK : ""} autoComplete="off"
                  onFocus={(e) => { if (f.type === "secret" && e.target.value === MASK) set(f.key, ""); }}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.type === "secret" && <span className="t-xs muted">{lang === "es" ? "Se guarda cifrado. Déjalo como está para no cambiarlo." : "Stored encrypted. Leave as-is to keep it."}</span>}
            </div>
          ))}
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" style={{ color: "var(--red)", marginRight: "auto" }} disabled={busy}
            onClick={async () => { setBusy(true); await uninstallPlugin(businessId, entry.id); onSaved(); }}><Icon name="trash" size={14} />{lang === "es" ? "Quitar" : "Remove"}</button>
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}><Icon name="check" size={14} />{busy ? (lang === "es" ? "Guardando…" : "Saving…") : (lang === "es" ? "Guardar" : "Save")}</button>
        </div>
      </div>
    </div>
  );
}
