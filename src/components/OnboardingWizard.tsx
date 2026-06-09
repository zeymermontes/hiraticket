"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import type { Business } from "@/lib/types";
import { createBusiness, completeOnboarding } from "@/app/(app)/actions";

const VERTICALS = [
  { id: "imprenta", es: "Imprenta / Stickers", en: "Print / Stickers" },
  { id: "restaurante", es: "Restaurante", en: "Restaurant" },
  { id: "estetica", es: "Estética", en: "Salon" },
  { id: "veterinaria", es: "Veterinaria", en: "Vet" },
  { id: "retail", es: "Retail", en: "Retail" },
  { id: "taller", es: "Taller", en: "Workshop" },
  { id: "other", es: "Otro / Genérico", en: "Other / Generic" },
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-xl)", boxShadow: "var(--sh-lg)", padding: 28 }}>
        <div className="row gap-2" style={{ marginBottom: 18 }}>
          <div className="rail-logo" style={{ width: 34, height: 34, margin: 0, fontSize: 18 }}>H</div>
          <strong style={{ fontSize: 16 }}>Hiraticket</strong>
        </div>
        {children}
      </div>
    </div>
  );
}

export function OnboardingWizard({ business }: { business: Business | null }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("imprenta");
  const [err, setErr] = useState<string | null>(null);

  // Phase A — create the business (required; this is the tenant).
  if (!business) {
    function submit() {
      if (!name.trim()) return;
      setErr(null);
      start(async () => {
        try { await createBusiness(name, vertical); router.refresh(); }
        catch (e) { setErr(e instanceof Error ? e.message : "error"); }
      });
    }
    return (
      <Shell>
        <h1 style={{ fontSize: 24 }}>{lang === "es" ? "Crea tu negocio" : "Create your business"}</h1>
        <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>
          {lang === "es" ? "Configuramos tu pipeline según tu rubro. Sin datos de ejemplo." : "We'll set up your pipeline for your industry. No sample data."}
        </p>
        <div className="col gap-2">
          <label className="lbl">{lang === "es" ? "Nombre del negocio" : "Business name"}</label>
          <div className="field field-lg" style={{ height: 44 }}>
            <Icon name="store" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hirata" autoFocus />
          </div>
          <label className="lbl" style={{ marginTop: 6 }}>{lang === "es" ? "Rubro" : "Industry"}</label>
          <select className="select" value={vertical} onChange={(e) => setVertical(e.target.value)}>
            {VERTICALS.map((v) => <option key={v.id} value={v.id}>{lang === "es" ? v.es : v.en}</option>)}
          </select>
          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
          <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 10 }} disabled={pending || !name.trim()} onClick={submit}>
            <Icon name="arrowr" size={16} />{lang === "es" ? "Continuar" : "Continue"}
          </button>
        </div>
      </Shell>
    );
  }

  // Phase B — quick welcome, skippable. Both buttons finish onboarding.
  const finish = () => start(async () => { await completeOnboarding(business.id); router.refresh(); });
  const steps: [string, string, string][] = [
    ["whatsapp", lang === "es" ? "Conecta WhatsApp" : "Connect WhatsApp", lang === "es" ? "Vincula tu número en Ajustes para chatear." : "Link your number in Settings to chat."],
    ["sliders", lang === "es" ? "Ajusta tu negocio" : "Tune your business", lang === "es" ? "Edita etapas y áreas en Negocio." : "Edit stages and areas in Business."],
    ["agents", lang === "es" ? "Invita a tu equipo" : "Invite your team", lang === "es" ? "Agrega agentes en Agentes." : "Add agents in Agents."],
  ];

  return (
    <Shell>
      <h1 style={{ fontSize: 24 }}>{lang === "es" ? `¡Listo, ${business.name}!` : `You're set, ${business.name}!`}</h1>
      <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>
        {lang === "es" ? "Tu espacio está vacío y listo. Próximos pasos opcionales:" : "Your workspace is empty and ready. Optional next steps:"}
      </p>
      <div className="col gap-2" style={{ marginBottom: 18 }}>
        {steps.map(([ic, title, desc]) => (
          <div key={title} className="row gap-3" style={{ alignItems: "flex-start", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={ic} size={17} /></span>
            <div><div style={{ fontWeight: 600 }}>{title}</div><div className="t-sm muted">{desc}</div></div>
          </div>
        ))}
      </div>
      <div className="row gap-2">
        <button className="btn btn-outline grow" disabled={pending} onClick={finish}>{lang === "es" ? "Saltar" : "Skip"}</button>
        <button className="btn btn-primary grow" disabled={pending} onClick={finish}><Icon name="arrowr" size={16} />{lang === "es" ? "Empezar" : "Get started"}</button>
      </div>
    </Shell>
  );
}
