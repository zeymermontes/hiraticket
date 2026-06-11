"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Campaign } from "@/lib/extras";
import { sendCampaign } from "@/app/(app)/features-actions";

export function CampaignsScreen({
  businessId, campaigns, cannedTitles,
}: {
  businessId: string;
  campaigns: Campaign[];
  cannedTitles: string[];
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(cannedTitles[0] ?? "");
  const [audience, setAudience] = useState(personal ? (lang === "es" ? "Todos los contactos" : "All contacts") : (lang === "es" ? "Todos los clientes" : "All customers"));

  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" }) : "—";

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Campañas" : "Campaigns"}</h1><Pill color="slate" large>{campaigns.length}</Pill></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="send" size={16} /><h4>{lang === "es" ? "Historial" : "History"}</h4></div>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>{lang === "es" ? "Campaña" : "Campaign"}</th><th>{lang === "es" ? "Estado" : "Status"}</th><th>{lang === "es" ? "Audiencia" : "Audience"}</th><th>{lang === "es" ? "Entregado" : "Delivered"}</th><th>{lang === "es" ? "Leído" : "Read"}</th><th>{lang === "es" ? "Fecha" : "Date"}</th></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td><Pill color={c.sent_at ? "green" : "slate"} dot>{c.sent_at ? (lang === "es" ? "Enviada" : "Sent") : (lang === "es" ? "Borrador" : "Draft")}</Pill></td>
                    <td className="t-sm muted">{c.audience}</td>
                    <td className="mono">{c.recipients ? Math.round((c.delivered / c.recipients) * 100) : 0}% <span className="muted t-xs">({c.delivered}/{c.recipients})</span></td>
                    <td className="mono">{c.recipients ? Math.round((c.read / c.recipients) * 100) : 0}%</td>
                    <td className="t-sm muted">{fmt(c.sent_at)}</td>
                  </tr>
                ))}
                {campaigns.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>{lang === "es" ? "Sin campañas." : "No campaigns."}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nueva campaña" : "New campaign"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Nombre" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="lbl">{lang === "es" ? "Plantilla" : "Template"}</label>
            <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {cannedTitles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="inp-inline" placeholder={lang === "es" ? "Audiencia" : "Audience"} value={audience} onChange={(e) => setAudience(e.target.value)} />
            <button className="btn btn-primary btn-block" disabled={pending || !name.trim()}
              onClick={() => { start(async () => { await sendCampaign(businessId, { name, template, audience }); router.refresh(); }); setName(""); }}>
              <Icon name="send" size={15} />{lang === "es" ? "Enviar" : "Send"}
            </button>
            <div className="t-xs muted">{lang === "es" ? "Envío simulado a tus contactos (la entrega real usa el worker de WhatsApp)." : "Simulated send to your contacts (real delivery uses the WhatsApp worker)."}</div>
          </div>
        </section>
      </div>
    </div>
  );
}
