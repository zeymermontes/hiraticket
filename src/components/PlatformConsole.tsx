"use client";
import React, { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { PlatformConsoleData, TenantDetail } from "@/lib/platform";
import { updatePlan } from "@/app/platform/actions";

const SUB: Record<string, { color: PillColor; es: string; en: string }> = {
  active: { color: "green", es: "Activo", en: "Active" },
  trialing: { color: "blue", es: "Prueba", en: "Trial" },
  past_due: { color: "amber", es: "Vencido", en: "Past due" },
  canceled: { color: "red", es: "Cancelado", en: "Canceled" },
};
const WA: Record<string, { color: PillColor; es: string; en: string }> = {
  connected: { color: "green", es: "Conectado", en: "Connected" },
  qr: { color: "amber", es: "Vincular", en: "Needs QR" },
  connecting: { color: "blue", es: "Conectando", en: "Connecting" },
  reconnecting: { color: "blue", es: "Reconectando", en: "Reconnecting" },
  disconnected: { color: "slate", es: "Desconectado", en: "Disconnected" },
};
const money = (n: number) => "$" + new Intl.NumberFormat("es-MX").format(Math.round(n)) + " MXN";

type Tab = "overview" | "tenants" | "plans" | "billing" | "usage" | "audit";

function Kpi({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="ws-block" style={{ padding: 16 }}>
      <div className="row gap-2 muted t-sm"><Icon name={icon} size={15} />{label}</div>
      <div className="mono" style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export function PlatformConsole({ data }: { data: PlatformConsoleData }) {
  const { lang, theme, setTheme } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const [tab, setTab] = useState<Tab>("overview");
  const [openTenant, setOpenTenant] = useState<TenantDetail | null>(null);
  const t = data.totals;

  const TABS: { id: Tab; icon: string; es: string; en: string }[] = [
    { id: "overview", icon: "kanban", es: "Resumen", en: "Overview" },
    { id: "tenants", icon: "store", es: "Negocios", en: "Tenants" },
    { id: "plans", icon: "layers", es: "Planes", en: "Plans" },
    { id: "billing", icon: "orders", es: "Facturación", en: "Billing" },
    { id: "usage", icon: "sliders", es: "Uso", en: "Usage" },
    { id: "audit", icon: "clock", es: "Auditoría", en: "Audit" },
  ];

  const recent = useMemo(() => [...data.tenants].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 6), [data.tenants]);
  const planName = (id: string) => data.plans.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="app" style={{ gridTemplateColumns: "200px 1fr" }}>
      {/* sub nav */}
      <nav className="rail" style={{ width: 200, alignItems: "stretch", padding: "14px 10px" }}>
        <div className="row gap-2" style={{ padding: "0 6px 12px" }}><div className="rail-logo" style={{ margin: 0 }}>H</div><div><div style={{ fontWeight: 800 }}>Hiraticket</div><Pill color="brand">{lang === "es" ? "Plataforma" : "Platform"}</Pill></div></div>
        {TABS.map((x) => (
          <button key={x.id} className={"rail-item" + (tab === x.id ? " on" : "")} style={{ width: "100%" }} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} /><span className="rl">{x[lang]}</span>
          </button>
        ))}
        <div style={{ marginTop: "auto" }} className="col gap-1">
          <button className="rail-item" style={{ width: "100%" }} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} /><span className="rl">{lang === "es" ? "Tema" : "Theme"}</span></button>
          <Link className="rail-item" href="/chat" style={{ width: "100%" }}><Icon name="arrowr" /><span className="rl">{lang === "es" ? "Ir a la app" : "Go to app"}</span></Link>
        </div>
      </nav>

      <div className="main">
        <div className="page">
          <div className="phead"><h1>{TABS.find((x) => x.id === tab)?.[lang]}</h1></div>
          <div className="scroll" style={{ padding: "0 24px 24px" }}>

            {tab === "overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 18 }}>
                  <Kpi icon="store" label={lang === "es" ? "Negocios" : "Tenants"} value={t.tenants} />
                  <Kpi icon="orders" label="MRR" value={money(t.mrr)} />
                  <Kpi icon="check" label={lang === "es" ? "Activos" : "Active"} value={t.active} />
                  <Kpi icon="clock" label={lang === "es" ? "Pruebas" : "Trials"} value={t.trials} />
                  <Kpi icon="whatsapp" label={lang === "es" ? "WhatsApp" : "Connected"} value={t.connected} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                  <section className="ws-block">
                    <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Altas recientes" : "Recent signups"}</h4></div>
                    <div className="ws-block-body col gap-2">
                      {recent.map((b) => (
                        <button key={b.id} className="row gap-2" style={{ alignItems: "center", padding: "6px 4px", cursor: "pointer", background: "transparent", border: "none", textAlign: "left" }} onClick={() => { setTab("tenants"); setOpenTenant(b); }}>
                          <Avatar name={b.name} initials={deriveInitials(b.name)} color="#5A6373" size={28} />
                          <span className="grow truncate" style={{ fontWeight: 600 }}>{b.name}</span>
                          <Pill color={SUB[b.status]?.color ?? "slate"} dot>{SUB[b.status]?.[lang] ?? b.status}</Pill>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="ws-block">
                    <div className="ws-block-head"><Icon name="bell" size={16} /><h4 className="grow">{lang === "es" ? "Requiere atención" : "Needs attention"}</h4>{t.pastDue > 0 && <span className="badge badge-red">{t.pastDue}</span>}</div>
                    <div className="ws-block-body col gap-2">
                      {data.tenants.filter((b) => b.status === "past_due" || b.wa !== "connected").slice(0, 6).map((b) => (
                        <div key={b.id} className="row gap-2" style={{ alignItems: "center" }}>
                          <span className="grow truncate">{b.name}</span>
                          {b.status === "past_due" && <Pill color="amber" dot>{SUB.past_due[lang]}</Pill>}
                          {b.wa !== "connected" && <Pill color="slate" dot>{WA[b.wa]?.[lang] ?? b.wa}</Pill>}
                        </div>
                      ))}
                      {data.tenants.every((b) => b.status !== "past_due" && b.wa === "connected") && <div className="muted t-sm">{lang === "es" ? "Todo en orden ✓" : "All good ✓"}</div>}
                    </div>
                  </section>
                </div>
              </>
            )}

            {tab === "tenants" && (
              <div className="tablewrap">
                <table className="tbl">
                  <thead><tr><th>{lang === "es" ? "Negocio" : "Business"}</th><th>{lang === "es" ? "Vertical" : "Vertical"}</th><th>Plan</th><th>{lang === "es" ? "Estado" : "Status"}</th><th>{lang === "es" ? "Asientos" : "Seats"}</th><th>WhatsApp</th><th>MRR</th></tr></thead>
                  <tbody>
                    {data.tenants.map((b) => (
                      <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => setOpenTenant(b)}>
                        <td><div className="cust"><Avatar name={b.name} initials={deriveInitials(b.name)} color="#5A6373" size={28} /><strong>{b.name}</strong></div></td>
                        <td className="t-sm muted">{b.vertical}</td>
                        <td>{planName(b.plan)}</td>
                        <td><Pill color={SUB[b.status]?.color ?? "slate"} dot>{SUB[b.status]?.[lang] ?? b.status}</Pill></td>
                        <td className="mono">{b.seats}</td>
                        <td><Pill color={WA[b.wa]?.color ?? "slate"} dot>{WA[b.wa]?.[lang] ?? b.wa}</Pill></td>
                        <td className="mono">{money(b.mrr)}</td>
                      </tr>
                    ))}
                    {data.tenants.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>—</td></tr>}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "plans" && (
              <div className="price-grid" style={{ maxWidth: 1000 }}>
                {data.plans.map((p) => (
                  <div className={"price-card" + (p.popular ? " pop" : "")} key={p.id}>
                    {p.popular && <span className="pill pill-brand" style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)" }}>★ {lang === "es" ? "Popular" : "Popular"}</span>}
                    <div className="pname">{p.name}</div>
                    <div className="row gap-1" style={{ alignItems: "baseline" }}>
                      <span className="mono" style={{ fontWeight: 800, fontSize: 22 }}>$</span>
                      <input className="inp-inline mono" style={{ width: 96, fontSize: 20, fontWeight: 800, height: 34 }} defaultValue={String(p.price_monthly)} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v !== p.price_monthly) run(() => updatePlan(p.id, { price_monthly: v })); }} />
                      <span className="t-sm muted">MXN/{lang === "es" ? "mes" : "mo"}</span>
                    </div>
                    <button className={"btn btn-sm " + (p.popular ? "btn-primary" : "btn-outline")} onClick={() => run(() => updatePlan(p.id, { popular: !p.popular }))}><Icon name="bolt" size={13} />{p.popular ? (lang === "es" ? "Popular ✓" : "Popular ✓") : (lang === "es" ? "Marcar popular" : "Mark popular")}</button>
                    <div className="t-sm muted">{p.subscribers} {lang === "es" ? "suscriptores" : "subscribers"}</div>
                    <div className="price-feats">
                      {Object.entries(p.limits || {}).map(([k, v]) => <div className="price-feat" key={k}><span className="ck"><Icon name="check" size={12} /></span>{k}: {v < 0 ? "∞" : v}</div>)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "billing" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 18 }}>
                  <Kpi icon="orders" label={lang === "es" ? "MRR cobrado" : "MRR collected"} value={money(t.mrr)} />
                  <Kpi icon="clock" label={lang === "es" ? "En prueba" : "On trial"} value={t.trials} />
                  <Kpi icon="bell" label={lang === "es" ? "Pagos vencidos" : "Past due"} value={t.pastDue} />
                </div>
                <div className="tablewrap">
                  <table className="tbl">
                    <thead><tr><th>{lang === "es" ? "Negocio" : "Business"}</th><th>Plan</th><th>{lang === "es" ? "Estado" : "Status"}</th><th>MRR</th></tr></thead>
                    <tbody>
                      {data.tenants.map((b) => (
                        <tr key={b.id}><td><strong>{b.name}</strong></td><td>{planName(b.plan)}</td><td><Pill color={SUB[b.status]?.color ?? "slate"} dot>{SUB[b.status]?.[lang] ?? b.status}</Pill></td><td className="mono">{money(b.mrr)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === "usage" && (
              <div className="tablewrap">
                <table className="tbl">
                  <thead><tr><th>{lang === "es" ? "Negocio" : "Business"}</th><th>Plan</th><th>{lang === "es" ? "Agentes" : "Agents"}</th><th>{lang === "es" ? "Pedidos" : "Orders"}</th><th>{lang === "es" ? "Números" : "Numbers"}</th></tr></thead>
                  <tbody>
                    {data.tenants.map((b) => {
                      const plan = data.plans.find((p) => p.id === b.plan);
                      const agentLimit = plan?.limits?.agents ?? 0;
                      const near = agentLimit > 0 && b.seats / agentLimit >= 0.7;
                      return (
                        <tr key={b.id}>
                          <td><strong>{b.name}</strong></td><td>{planName(b.plan)}</td>
                          <td className="mono">{b.seats}{agentLimit > 0 ? ` / ${agentLimit}` : ""} {near && <Pill color="amber">{lang === "es" ? "cerca del límite" : "near limit"}</Pill>}</td>
                          <td className="mono">{b.orders}</td>
                          <td className="mono">{b.phones.length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "audit" && (
              <section className="ws-block">
                <div className="ws-block-head"><Icon name="clock" size={16} /><h4>{lang === "es" ? "Actividad reciente" : "Recent activity"}</h4></div>
                <div className="ws-block-body"><div className="timeline">
                  {data.audit.length === 0 ? <div className="muted t-sm">—</div> : data.audit.map((e) => (
                    <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "plus" ? "plus" : e.kind === "check" ? "check" : "clock"} size={13} /></div></div>
                      <div className="tl-body">{e.text}<span className="muted"> · {e.business}</span><div className="tl-time">{new Date(e.created_at).toLocaleString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div></div></div>
                  ))}
                </div></div>
              </section>
            )}
          </div>
        </div>
      </div>

      {openTenant && <TenantDrawer t={openTenant} planName={planName(openTenant.plan)} onClose={() => setOpenTenant(null)} />}
    </div>
  );
}

function TenantDrawer({ t, planName, onClose }: { t: TenantDetail; planName: string; onClose: () => void }) {
  const { lang } = useApp();
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <Avatar name={t.name} initials={deriveInitials(t.name)} color="#5A6373" size={40} />
          <div className="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 16 }} className="truncate">{t.name}</div><div className="t-sm muted">{t.vertical} · {lang === "es" ? "Desde" : "Since"} {new Date(t.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", year: "numeric" })}</div></div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="drawer-body scroll">
          <div className="ws-block"><div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Suscripción" : "Subscription"}</h4><Pill color={SUB[t.status]?.color ?? "slate"} dot>{SUB[t.status]?.[lang] ?? t.status}</Pill></div>
            <div className="ws-block-body col gap-2">
              <div className="row gap-2"><span className="grow muted">Plan</span><strong>{planName}</strong></div>
              <div className="row gap-2"><span className="grow muted">MRR</span><span className="mono" style={{ fontWeight: 700 }}>{money(t.mrr)}</span></div>
            </div>
          </div>
          <div className="row gap-3" style={{ flexWrap: "wrap" }}>
            <div className="ws-block" style={{ flex: 1 }}><div className="ws-block-body"><div className="t-xs muted">{lang === "es" ? "Asientos" : "Seats"}</div><div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{t.seats}</div></div></div>
            <div className="ws-block" style={{ flex: 1 }}><div className="ws-block-body"><div className="t-xs muted">{lang === "es" ? "Pedidos" : "Orders"}</div><div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{t.orders}</div></div></div>
          </div>
          <div className="ws-block"><div className="ws-block-head"><Icon name="whatsapp" size={16} /><h4>{lang === "es" ? "Números de WhatsApp" : "WhatsApp numbers"}</h4></div>
            <div className="ws-block-body col gap-2">
              {t.phones.length === 0 ? <div className="muted t-sm">—</div> : t.phones.map((p, i) => (
                <div key={i} className="row gap-2"><span className="grow">{p.label}{p.phone ? <span className="muted mono t-xs"> · {p.phone}</span> : null}</span><Pill color={WA[p.status]?.color ?? "slate"} dot>{WA[p.status]?.[lang] ?? p.status}</Pill></div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
