"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useToast } from "@/components/Toast";
import type { CatalogEntry, PluginPricing } from "@/lib/plugins";
import { installPlugin, uninstallPlugin, setPluginEnabled, savePluginConfig } from "@/app/(app)/plugins/actions";

// Mirror of secrets.MASK — kept local so this client bundle never imports node:crypto.
const MASK = "••••••••";

const addonOf = (p: PluginPricing) => Number(p.addon_monthly ?? 0);

/** Catalogue icon: an image path (/plugins/*.png — real brand logo) or an Icon name. */
function PluginLogo({ icon, size = 40 }: { icon: string | null; size?: number }) {
  const isImg = !!icon && (icon.startsWith("/") || icon.startsWith("http"));
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.28, background: isImg ? "var(--surface-2)" : "var(--brand-50)", color: "var(--brand-700)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", overflow: "hidden", border: isImg ? "1px solid var(--border)" : "none" }}>
      {isImg
        ? <img src={icon!} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} />
        : <Icon name={icon || "sparkles"} size={size / 2} />}
    </span>
  );
}

const CATEGORY_LABEL: Record<string, { es: string; en: string }> = {
  payments: { es: "Pagos", en: "Payments" },
  invoicing: { es: "Facturación", en: "Invoicing" },
  shipping: { es: "Envíos", en: "Shipping" },
  automation: { es: "Automatización", en: "Automation" },
  ai: { es: "IA", en: "AI" },
};

function priceBadge(p: PluginPricing, lang: "es" | "en"): string {
  const fee = Number(p.addon_monthly ?? 0);
  const base = fee > 0 ? `$${fee.toLocaleString("es-MX")}/${lang === "es" ? "mes" : "mo"}` : (lang === "es" ? "Gratis" : "Free");
  // Model-specific extras stack on top of the flat activation fee.
  const extra = p.model === "metered" ? (lang === "es" ? ` · $${p.metered_price} por ${p.metered_unit}` : ` · $${p.metered_price} per ${p.metered_unit}`) : "";
  return base + extra;
}

export function PluginsScreen({ businessId, entries, isAdmin }: { businessId: string; entries: CatalogEntry[]; isAdmin: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const { push } = useToast();
  const [, start] = useTransition();
  const [cat, setCat] = useState<string>("all");
  const [configId, setConfigId] = useState<string | null>(null);
  const [guideId, setGuideId] = useState<string | null>(null);
  // Surface failures (RLS, missing migration) instead of silently doing nothing.
  const run = (fn: () => Promise<{ ok?: boolean; error?: string } | unknown>) => start(async () => {
    const r = (await fn()) as { ok?: boolean; error?: string } | undefined;
    if (r && r.ok === false) push({ kind: "info", title: lang === "es" ? "No se pudo aplicar" : "Couldn't apply", message: r.error ?? "" });
    router.refresh();
  });

  const cats = Array.from(new Set(entries.map((e) => e.category)));
  const shown = cat === "all" ? entries : entries.filter((e) => e.category === cat);
  const configEntry = entries.find((e) => e.id === configId) ?? null;

  return (
    <div className="page">
      <div className="phead">
        <h1>Plugins</h1>
        <Pill color="slate" large>{entries.filter((e) => e.installed?.status === "active").length} {lang === "es" ? "activos" : "active"}</Pill>
        <span className="t-sm muted hide-narrow" style={{ marginLeft: 8 }}>{lang === "es" ? "Conecta servicios de pago, facturación y envíos · cada plugin activo cuesta $99/mes, cancelable en cualquier momento" : "Connect payment, invoicing and shipping · each active plugin is $99/mo, cancel anytime"}</span>
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
                      <PluginLogo icon={e.icon} />
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
                    {e.guide.length > 0 && (
                      <button onClick={() => setGuideId(e.id)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--brand-700)", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start" }}>
                        <Icon name="canned" size={13} />{lang === "es" ? "¿Cómo se configura?" : "How to set it up?"}
                      </button>
                    )}

                    <div className="row gap-2" style={{ alignItems: "center" }}>
                      <Pill color="slate"><Icon name="orders" size={11} />{priceBadge(e.pricing, lang)}</Pill>
                      <span className="grow" />
                      {soon && !inst ? (
                        <Pill color="violet">{lang === "es" ? "Próximamente" : "Coming soon"}</Pill>
                      ) : !inst ? (
                        <button className="btn btn-sm btn-primary" disabled={!isAdmin} title={lang === "es" ? "Se suma a tu mensualidad; cancela cuando quieras" : "Added to your monthly bill; cancel anytime"}
                          onClick={() => run(() => installPlugin(businessId, e.id))}><Icon name="plus" size={14} />{lang === "es" ? "Activar" : "Activate"}{addonOf(e.pricing) > 0 ? ` · $${addonOf(e.pricing)}/mes` : ""}</button>
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
      {(() => {
        const g = entries.find((e) => e.id === guideId);
        return g ? <GuideModal entry={g} lang={lang} onClose={() => setGuideId(null)} onConfigure={g.installed && isAdmin ? () => { setGuideId(null); setConfigId(g.id); } : undefined} /> : null;
      })()}
    </div>
  );
}

/** Step-by-step setup instructions for a plugin (catalogue-curated: plugins.guide). */
function GuideModal({ entry, lang, onClose, onConfigure }: { entry: CatalogEntry; lang: "es" | "en"; onClose: () => void; onConfigure?: () => void }) {
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <PluginLogo icon={entry.icon} size={38} />
          <h3 className="grow">{lang === "es" ? "Cómo configurar" : "How to set up"} {entry.name}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          {entry.guide.map((s, i) => (
            <div key={i} className="row gap-3" style={{ alignItems: "flex-start" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--brand-50)", color: "var(--brand-700)", fontWeight: 800, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.title}</div>
                <div className="t-sm muted" style={{ marginTop: 2 }}>{s.body}</div>
                {s.url && <a className="btn btn-sm btn-outline" href={s.url} target="_blank" rel="noreferrer" style={{ marginTop: 6, display: "inline-flex" }}><Icon name="arrowr" size={13} />{lang === "es" ? "Abrir" : "Open"}</a>}
              </div>
            </div>
          ))}
          {entry.guide.length === 0 && <p className="t-sm muted">—</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cerrar" : "Close"}</button>
          {onConfigure && <button className="btn btn-primary" onClick={onConfigure}><Icon name="sliders" size={14} />{lang === "es" ? "Ir a configurar" : "Configure now"}</button>}
        </div>
      </div>
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
          <PluginLogo icon={entry.icon} size={38} />
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
