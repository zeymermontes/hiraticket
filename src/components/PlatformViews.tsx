"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { PlatformOverview } from "@/lib/platform";
import { bootstrapPlatformAdmin } from "@/app/platform/actions";

const SUB_COLOR: Record<string, PillColor> = {
  active: "green", trialing: "blue", past_due: "amber", canceled: "red",
};
const WA_COLOR: Record<string, PillColor> = {
  connected: "green", qr: "amber", connecting: "blue", reconnecting: "blue", disconnected: "slate",
};

export function PlatformClaim({ canClaim }: { canClaim: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="view-placeholder">
      <span className="vp-ic"><Icon name="lock" size={26} /></span>
      <h2 style={{ fontSize: 22 }}>{lang === "es" ? "Consola de plataforma" : "Platform console"}</h2>
      {canClaim ? (
        <>
          <p className="muted" style={{ maxWidth: 420 }}>
            {lang === "es"
              ? "Nadie es super-admin todavía. Reclama el acceso para gestionar todos los negocios, planes y suscripciones."
              : "No super-admin yet. Claim access to manage all businesses, plans and subscriptions."}
          </p>
          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
          <button className="btn btn-primary btn-lg" disabled={pending}
            onClick={() => start(async () => { const r = await bootstrapPlatformAdmin(); if (!r.ok) setErr(r.error ?? "error"); else router.refresh(); })}>
            <Icon name="shield" size={16} />{lang === "es" ? "Reclamar super-admin" : "Claim super-admin"}
          </button>
        </>
      ) : (
        <p className="muted" style={{ maxWidth: 420 }}>
          {lang === "es" ? "No tienes acceso a la consola de plataforma." : "You don't have access to the platform console."}
        </p>
      )}
    </div>
  );
}

export function PlatformOverviewView({ data }: { data: PlatformOverview }) {
  const { lang } = useApp();
  const money = (n: number) => "$" + new Intl.NumberFormat("es-MX").format(n);

  const kpis = [
    { icon: "store", label: lang === "es" ? "Negocios" : "Tenants", value: String(data.totals.tenants) },
    { icon: "layers", label: "MRR", value: money(data.totals.mrr) },
    { icon: "check", label: lang === "es" ? "Activos" : "Active", value: String(data.totals.active) },
    { icon: "whatsapp", label: lang === "es" ? "WhatsApp" : "WhatsApp", value: String(data.totals.connected) },
  ];

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Resumen" : "Overview"}</h1></div>

      <div className="scroll" style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
          {kpis.map((k) => (
            <div key={k.label} className="ws-block" style={{ padding: 16 }}>
              <div className="row gap-2 muted t-sm"><Icon name={k.icon} size={15} />{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }} className="mono">{k.value}</div>
            </div>
          ))}
        </div>

        <section className="ws-block" style={{ marginBottom: 20 }}>
          <div className="ws-block-head"><Icon name="store" size={16} /><h4>{lang === "es" ? "Negocios" : "Businesses"}</h4></div>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr>
                <th>{lang === "es" ? "Negocio" : "Business"}</th>
                <th>{lang === "es" ? "Rubro" : "Vertical"}</th>
                <th>{lang === "es" ? "Plan" : "Plan"}</th>
                <th>{lang === "es" ? "Estado" : "Status"}</th>
                <th>MRR</th>
                <th>WhatsApp</th>
              </tr></thead>
              <tbody>
                {data.tenants.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td className="t-sm muted">{t.vertical}</td>
                    <td><Pill color="slate">{t.plan}</Pill></td>
                    <td><Pill color={SUB_COLOR[t.status] ?? "slate"} dot>{t.status}</Pill></td>
                    <td className="mono">{money(t.mrr)}</td>
                    <td><Pill color={WA_COLOR[t.wa] ?? "slate"} dot>{t.wa}</Pill></td>
                  </tr>
                ))}
                {data.tenants.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 30 }}>{lang === "es" ? "Sin negocios." : "No businesses."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="layers" size={16} /><h4>{lang === "es" ? "Planes" : "Plans"}</h4></div>
          <div className="ws-block-body" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {data.plans.map((p) => (
              <div key={p.id} style={{ border: "1px solid " + (p.popular ? "var(--brand)" : "var(--border)"), borderRadius: "var(--r-lg)", padding: 16 }}>
                <div className="row gap-2"><strong style={{ fontSize: 16 }}>{p.name}</strong>{p.popular && <Pill color="brand">Popular</Pill>}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }} className="mono">{money(p.price_monthly)}<span className="t-sm muted">/mes</span></div>
                <div className="t-xs muted">{money(p.price_annual)} / {lang === "es" ? "año" : "yr"}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
