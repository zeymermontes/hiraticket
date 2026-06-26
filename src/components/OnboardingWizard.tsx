"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import type { Business } from "@/lib/types";
import { createBusiness, completeOnboarding } from "@/app/(app)/actions";


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

export function OnboardingWizard({ business, email }: { business: Business | null; email?: string }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"business" | "personal">("business");
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState<"choose" | "create" | "join">("choose");

  // Phase A — no team yet: first choose to create your own workspace or join an existing one.
  if (!business) {
    if (path === "choose") {
      return (
        <Shell>
          <h1 style={{ fontSize: 24 }}>{lang === "es" ? "Bienvenido a Hiraticket" : "Welcome to Hiraticket"}</h1>
          <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>{lang === "es" ? "¿Cómo quieres empezar?" : "How do you want to start?"}</p>
          <div className="col gap-2">
            <button type="button" onClick={() => setPath("create")} style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer", background: "var(--surface)", border: "1px solid var(--border)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, flex: "none", background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="plus" size={19} /></span>
              <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{lang === "es" ? "Crear mi espacio" : "Create my workspace"}</span><span className="t-xs muted">{lang === "es" ? "Empieza un equipo nuevo y administra tú." : "Start a new team that you manage."}</span></span>
            </button>
            <button type="button" onClick={() => setPath("join")} style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer", background: "var(--surface)", border: "1px solid var(--border)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, flex: "none", background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="agents" size={19} /></span>
              <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{lang === "es" ? "Unirme a un equipo" : "Join a team"}</span><span className="t-xs muted">{lang === "es" ? "Alguien ya tiene un espacio y quieres entrar." : "Someone already has a workspace you want to join."}</span></span>
            </button>
          </div>
        </Shell>
      );
    }
    if (path === "join") {
      return (
        <Shell>
          <button type="button" className="row gap-1 t-sm muted" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }} onClick={() => setPath("choose")}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="arrowr" size={14} /></span>{lang === "es" ? "Atrás" : "Back"}</button>
          <h1 style={{ fontSize: 24 }}>{lang === "es" ? "Únete a un equipo" : "Join a team"}</h1>
          <p className="muted" style={{ marginTop: 4, marginBottom: 16 }}>{lang === "es" ? "Pídele al administrador del espacio que te agregue. Solo necesita tu correo:" : "Ask the workspace admin to add you. They just need your email:"}</p>
          {email && (
            <div className="row gap-2" style={{ marginBottom: 16, alignItems: "center" }}>
              <div className="field field-sm field-filled grow"><Icon name="mail" size={15} /><input readOnly value={email} onFocus={(e) => e.currentTarget.select()} /></div>
              <button className="btn btn-sm btn-outline" onClick={() => navigator.clipboard?.writeText(email).catch(() => {})}><Icon name="paperclip" size={14} />{lang === "es" ? "Copiar" : "Copy"}</button>
            </div>
          )}
          <div className="col gap-2" style={{ marginBottom: 18 }}>
            {[
              lang === "es" ? "Comparte tu correo con el admin del equipo." : "Share your email with the team admin.",
              lang === "es" ? "El admin entra a Agentes → Invitar al equipo y te invita (o te comparte un enlace de invitación)." : "The admin goes to Agents → Invite to team and invites you (or shares an invite link).",
              lang === "es" ? "Cuando te inviten, aparecerá aquí un aviso para unirte." : "Once you're invited, a prompt to join will appear here.",
            ].map((s, i) => (
              <div key={i} className="row gap-3" style={{ alignItems: "flex-start" }}>
                <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontWeight: 800, fontSize: 12 }}>{i + 1}</span>
                <span className="t-sm">{s}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-lg btn-block" disabled={pending} onClick={() => start(async () => { router.refresh(); })}><Icon name="refresh" size={16} />{lang === "es" ? "Ya me invitaron — Revisar" : "I've been invited — Check"}</button>
        </Shell>
      );
    }
    // path === "create"
    function submit() {
      if (!name.trim()) return;
      setErr(null);
      start(async () => {
        try { await createBusiness(name, mode); router.refresh(); }
        catch (e) { setErr(e instanceof Error ? e.message : "error"); }
      });
    }
    const opts: { id: "business" | "personal"; icon: string; title: string; desc: string }[] = [
      { id: "business", icon: "store", title: lang === "es" ? "Negocio" : "Business", desc: lang === "es" ? "Pedidos con productos, precios y pagos. Para vender a clientes." : "Orders with products, prices and payments. Selling to customers." },
      { id: "personal", icon: "orders", title: lang === "es" ? "Gestión personal" : "Personal management", desc: lang === "es" ? "Tareas con subtareas, sin dinero. Para organizar tu trabajo." : "Tasks with subtasks, no money. To organize your work." },
    ];
    return (
      <Shell>
        <button type="button" className="row gap-1 t-sm muted" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }} onClick={() => setPath("choose")}><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="arrowr" size={14} /></span>{lang === "es" ? "Atrás" : "Back"}</button>
        <h1 style={{ fontSize: 24 }}>{lang === "es" ? "Crea tu espacio" : "Create your workspace"}</h1>
        <p className="muted" style={{ marginTop: 4, marginBottom: 18 }}>
          {lang === "es" ? "Elige cómo lo vas a usar. Sin datos de ejemplo." : "Choose how you'll use it. No sample data."}
        </p>
        <div className="col gap-2">
          <label className="lbl">{lang === "es" ? "Nombre" : "Name"}</label>
          <div className="field field-lg" style={{ height: 44 }}>
            <Icon name="store" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hirata" autoFocus />
          </div>
          <label className="lbl" style={{ marginTop: 6 }}>{lang === "es" ? "Tipo de espacio" : "Workspace type"}</label>
          <div className="col gap-2">
            {opts.map((o) => (
              <button key={o.id} type="button" onClick={() => setMode(o.id)}
                style={{ display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer", background: mode === o.id ? "var(--brand-50)" : "var(--surface)", border: "2px solid " + (mode === o.id ? "var(--brand)" : "var(--border)") }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, flex: "none", background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={o.icon} size={19} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{o.title}</span>
                  <span className="t-xs muted">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
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
