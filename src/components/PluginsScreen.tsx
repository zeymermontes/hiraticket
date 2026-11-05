"use client";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useToast } from "@/components/Toast";
import type { CatalogEntry, PluginPricing } from "@/lib/plugins";
import { installPlugin, uninstallPlugin, setPluginEnabled, savePluginConfig } from "@/app/(app)/plugins/actions";
import { getFacturacionState, startFacturacionLink, pollFacturacionLink, cancelFacturacionLink, redeemFacturacionCode, type FacturacionState } from "@/app/(app)/plugins/link-actions";

const FX = "hiraticket_facturacion";
/** Campos de Hiraticket Facturación que la conexión por código llena sola: quedan como respaldo. */
const FX_MANUAL = ["api_key", "emisor", "marca"];

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

export function PluginsScreen({ businessId, businessName = "", entries, isAdmin, linkCode = null }: {
  businessId: string; businessName?: string; entries: CatalogEntry[]; isAdmin: boolean;
  /** Código de Facturación que llegó en la liga (/plugins?facturacion=CODIGO), ya validado. */
  linkCode?: string | null;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const { push } = useToast();
  const [, start] = useTransition();
  const [cat, setCat] = useState<string>("all");
  const fxEntry = entries.find((e) => e.id === FX) ?? null;
  // Con un código en la liga se abre la configuración del plugin directo, si ya está activado.
  const [configId, setConfigId] = useState<string | null>(linkCode && isAdmin && fxEntry?.installed ? FX : null);
  const [pendingCode, setPendingCode] = useState<string | null>(linkCode);
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
          {pendingCode && fxEntry && (!fxEntry.installed || !isAdmin) && (
            <div className="row gap-3" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--brand-50)", border: "1px solid var(--brand-300)", marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
              <Icon name="file" size={18} />
              <div className="grow" style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{lang === "es" ? "Conectar con Hiraticket Facturación" : "Connect to Hiraticket Facturación"}</div>
                <div className="t-xs muted">
                  {!isAdmin
                    ? (lang === "es" ? "Solo un administrador de este negocio puede conectar el plugin. Pásale el código." : "Only an admin of this business can connect the plugin. Share the code with them.")
                    : (lang === "es" ? `Tienes un código de Facturación (${pendingCode.slice(0, 4)}-${pendingCode.slice(4)}). Primero activa el plugin en ${businessName || "este negocio"}; se suma $${addonOf(fxEntry.pricing)}/mes a tu mensualidad.` : `You have an invoicing code (${pendingCode.slice(0, 4)}-${pendingCode.slice(4)}). First activate the plugin for ${businessName || "this business"}; it adds $${addonOf(fxEntry.pricing)}/mo.`)}
                </div>
              </div>
              {isAdmin && (
                <button className="btn btn-sm btn-primary" onClick={() => start(async () => {
                  const r = await installPlugin(businessId, FX);
                  if (r.ok) { setConfigId(FX); router.refresh(); }
                  else push({ kind: "info", title: lang === "es" ? "No se pudo activar" : "Couldn't activate", message: r.error ?? "" });
                })}><Icon name="plus" size={14} />{lang === "es" ? "Activar y conectar" : "Activate and connect"}</button>
              )}
            </div>
          )}
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

      {configEntry && <ConfigModal key={configEntry.id} businessId={businessId} businessName={businessName} entry={configEntry} lang={lang} linkCode={configEntry.id === FX ? pendingCode : null}
        onClose={() => { setConfigId(null); setPendingCode(null); }}
        onSaved={(info) => { setConfigId(null); setPendingCode(null); if (info) push({ kind: "info", title: lang === "es" ? "Guardado" : "Saved", message: info }); router.refresh(); }} />}
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

function ConfigModal({ businessId, businessName = "", entry, lang, linkCode = null, onClose, onSaved }: { businessId: string; businessName?: string; entry: CatalogEntry; lang: "es" | "en"; linkCode?: string | null; onClose: () => void; onSaved: (info?: string) => void }) {
  const isFx = entry.id === FX;
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...(entry.installed?.config ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // La cuenta del otro lado ya manda avisos a otro sistema: se pregunta antes de reemplazarlo.
  const [conflict, setConflict] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  const save = async (replaceWebhook = false) => {
    if (isFx && !values.api_key) { setErr(lang === "es" ? "Primero conecta tu cuenta de Facturación (arriba) o pega una llave manual." : "First connect your invoicing account (above) or paste a manual key."); return; }
    // Required fields: allow the mask sentinel (means "already set") to satisfy a required secret.
    for (const f of entry.config_schema) {
      if (f.required && f.type !== "toggle") {
        const v = values[f.key];
        if (!v || (typeof v === "string" && !v.trim())) { setErr((lang === "es" ? "Falta: " : "Missing: ") + f.label); return; }
      }
    }
    setBusy(true); setErr(null); setConflict(null);
    const r = await savePluginConfig(businessId, entry.id, values, { replaceWebhook });
    setBusy(false);
    if (r.ok) { onSaved(r.info); return; }
    if (r.code === "webhook-conflict") { setConflict(r.error ?? ""); return; }
    setErr(r.error && r.error !== "not-installed" ? r.error : (lang === "es" ? "No se pudo guardar." : "Couldn't save."));
  };

  const renderField = (f: CatalogEntry["config_schema"][number]) => (
            <div key={f.key} className="col gap-1">
              <label className="lbl" style={{ margin: 0 }}>{f.label}{f.required ? " *" : ""}</label>
              {f.type === "toggle" ? (
                <button className={"chip" + (values[f.key] ? " on" : "")} onClick={() => set(f.key, !values[f.key])} style={{ alignSelf: "flex-start" }}>{values[f.key] ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}</button>
              ) : f.type === "select" ? (
                <select className="select" value={String(values[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{f.labels?.[o] ?? o}</option>)}
                </select>
              ) : (
                <input className="inp-inline" type={f.type === "secret" ? "password" : "text"} value={String(values[f.key] ?? "")}
                  placeholder={f.type === "secret" ? MASK : ""} autoComplete="off"
                  onFocus={(e) => { if (f.type === "secret" && e.target.value === MASK) set(f.key, ""); }}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.type === "secret" && <span className="t-xs muted">{lang === "es" ? "Se guarda cifrado. Déjalo como está para no cambiarlo." : "Stored encrypted. Leave as-is to keep it."}</span>}
              {f.help && <span className="t-xs muted">{f.help}</span>}
            </div>
  );

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <PluginLogo icon={entry.icon} size={38} />
          <h3 className="grow">{lang === "es" ? "Configurar" : "Configure"} {entry.name}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          {isFx && <FacturacionLink businessId={businessId} businessName={businessName} lang={lang} initialCode={linkCode} onLinked={onSaved} />}
          {isFx && (
            <details open={!values.api_key}>
              <summary className="t-sm" style={{ cursor: "pointer", fontWeight: 600, color: "var(--text-muted)" }}>{lang === "es" ? "Conectar con una llave manual (respaldo y pruebas)" : "Connect with a manual key (fallback and testing)"}</summary>
              <div className="col gap-3" style={{ marginTop: 10 }}>{entry.config_schema.filter((f) => FX_MANUAL.includes(f.key)).map(renderField)}</div>
            </details>
          )}
          {entry.config_schema.filter((f) => !isFx || !FX_MANUAL.includes(f.key)).map(renderField)}
          {conflict !== null && (
            <div className="col gap-2" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--amber-bg)", border: "1px solid var(--amber-bd)" }}>
              <div className="t-sm" style={{ fontWeight: 700 }}>{lang === "es" ? "Tu cuenta ya manda avisos a otro sistema" : "Your account already notifies another system"}</div>
              <div className="t-xs">{conflict}</div>
              <div className="t-xs muted">{lang === "es" ? "Solo puede haber un destino por cuenta. Si lo reemplazas, ese otro sistema deja de recibir los avisos de facturas." : "There can be only one destination per account. If you replace it, that other system stops receiving invoice notifications."}</div>
              <button className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => save(true)}>{lang === "es" ? "Reemplazar y guardar" : "Replace and save"}</button>
            </div>
          )}
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" style={{ color: "var(--red)", marginRight: "auto" }} disabled={busy}
            onClick={async () => { setBusy(true); await uninstallPlugin(businessId, entry.id); onSaved(); }}><Icon name="trash" size={14} />{lang === "es" ? "Quitar" : "Remove"}</button>
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => save()}><Icon name="check" size={14} />{busy ? (lang === "es" ? "Guardando…" : "Saving…") : (lang === "es" ? "Guardar" : "Save")}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Conectar Hiraticket Facturación sin copiar la llave: se autoriza una vez en Facturación y la llave
 * y el aviso de facturas quedan puestos solos.
 *
 *   · «Conectar con Facturación» abre su pantalla de autorización con un código que también se
 *     enseña aquí: el dueño debe ver EL MISMO código allá antes de autorizar. Mientras tanto se
 *     pregunta cada 3 segundos si ya lo hizo.
 *   · «Tengo un código»: el que se genera en el panel de Facturación. Llega ya escrito cuando se
 *     entra por la liga /plugins?facturacion=CODIGO.
 */
function FacturacionLink({ businessId, businessName, lang, initialCode, onLinked }: {
  businessId: string; businessName: string; lang: "es" | "en"; initialCode: string | null; onLinked: (info?: string) => void;
}) {
  const es = lang === "es";
  const [state, setState] = useState<FacturacionState | null>(null);
  const [pending, setPending] = useState<{ code: string; url: string } | null>(null);
  const [code, setCode] = useState(initialCode ? `${initialCode.slice(0, 4)}-${initialCode.slice(4)}` : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const linkedRef = useRef(onLinked);
  linkedRef.current = onLinked;

  useEffect(() => {
    let alive = true;
    getFacturacionState(businessId).then((s) => { if (!alive) return; setState(s); if (s.pending) setPending({ code: s.pending.code, url: s.pending.url }); }).catch(() => {});
    return () => { alive = false; };
  }, [businessId]);

  // Mientras hay un código esperando autorización, se pregunta cada 3 s. El resultado solo se
  // puede leer una vez del otro lado, y el servidor lo guarda en la misma llamada en que llega.
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const id = setInterval(async () => {
      const r = await pollFacturacionLink(businessId).catch(() => null);
      if (!alive || !r) return;
      if (r.status === "linked") { setPending(null); linkedRef.current(r.info); }
      else if (r.status === "error" || r.status === "none") { setPending(null); if (r.error) setErr(r.error); }
    }, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [pending, businessId]);

  if (!state || !state.canLink) return null; // sin secreto de integrador solo queda la llave manual

  const start = async () => {
    // La pestaña se abre en el mismo clic (después de esperar al servidor, el navegador la
    // bloquearía como ventana emergente) y se le pone la dirección cuando llega el código.
    const tab = window.open("", "_blank");
    setBusy(true); setErr(null);
    const r = await startFacturacionLink(businessId);
    setBusy(false);
    if (r.status !== "pending" || !r.code || !r.url) { tab?.close(); setErr(r.error ?? (es ? "No se pudo pedir el código." : "Couldn't request the code.")); return; }
    if (tab) { tab.opener = null; tab.location.href = r.url; }
    setPending({ code: r.code, url: r.url });
  };
  const redeem = async () => {
    setBusy(true); setErr(null);
    const r = await redeemFacturacionCode(businessId, code);
    setBusy(false);
    if (r.status === "linked") linkedRef.current(r.info);
    else setErr(r.error ?? (es ? "No se pudo canjear el código." : "Couldn't redeem the code."));
  };
  const box: React.CSSProperties = { padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)" };

  if (pending) {
    return (
      <div className="col gap-2" style={box}>
        <div className="t-sm" style={{ fontWeight: 700 }}>{es ? "Autoriza la conexión en Facturación" : "Authorize the connection in Facturación"}</div>
        <div className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>{pending.code}</div>
        <div className="t-xs muted">{es ? "Se abrió Hiraticket Facturación en otra pestaña. Entra, comprueba que allá aparece este mismo código y autoriza. Esta ventana se actualiza sola." : "Hiraticket Facturación opened in another tab. Sign in, check the same code is shown there and authorize. This window updates on its own."}</div>
        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <a className="btn btn-sm btn-outline" href={pending.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} />{es ? "Abrir Facturación" : "Open Facturación"}</a>
          <span className="t-xs muted grow">{es ? "Esperando autorización…" : "Waiting for authorization…"}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => { setPending(null); void cancelFacturacionLink(businessId); }}>{es ? "Cancelar" : "Cancel"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="col gap-2" style={box}>
      {state.connected ? (
        <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Pill color="green" dot>{es ? "Conectado" : "Connected"}</Pill>
          <span className="t-sm grow" style={{ minWidth: 0 }}>{state.account ? `${state.account} · ` : ""}{state.emisor ? `RFC ${state.emisor}` : ""}{!state.linked ? (es ? " · llave manual" : " · manual key") : ""}</span>
          <button className="btn btn-sm btn-outline" disabled={busy} onClick={start} title={es ? "Vuelve a autorizar en Facturación: sirve si se revocó la llave o quieres cambiar de cuenta o de RFC" : "Authorize again: useful if the key was revoked or you want another account or RFC"}>{es ? "Volver a conectar" : "Reconnect"}</button>
        </div>
      ) : (
        <>
          <div className="t-sm" style={{ fontWeight: 700 }}>{es ? "Conecta tu cuenta de Hiraticket Facturación" : "Connect your Hiraticket Facturación account"}</div>
          <div className="t-xs muted">{es ? `Autorizas una vez allá y aquí queda todo puesto: llave, RFC y avisos de facturas. Se conectará con ${businessName || "este negocio"}.` : `Authorize once there and everything is set here: key, RFC and invoice notifications. It will connect to ${businessName || "this business"}.`}</div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={start}><Icon name="external" size={14} />{busy ? (es ? "Abriendo…" : "Opening…") : (es ? "Conectar con Facturación" : "Connect to Facturación")}</button>
        </>
      )}
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-xs muted">{es ? "¿Tienes un código de Facturación?" : "Have a code from Facturación?"}</span>
        <input className="inp-inline mono" style={{ width: 130 }} placeholder="XXXX-XXXX" maxLength={9} value={code} autoFocus={!!initialCode}
          onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && code.replace(/[^A-Z0-9]/g, "").length === 8) void redeem(); }} />
        <button className="btn btn-sm btn-outline" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length !== 8} onClick={redeem}>{es ? "Conectar con el código" : "Connect with code"}</button>
      </div>
      {initialCode && !state.connected && <div className="t-xs muted">{es ? `Se conectará con el negocio «${businessName || "actual"}» de Hiraticket. Si no es el correcto, cambia de negocio antes de continuar.` : `It will connect to the Hiraticket business "${businessName || "current"}". If that's not the right one, switch business first.`}</div>}
      {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
    </div>
  );
}
