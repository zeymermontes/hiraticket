"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { DetailedAgent } from "@/lib/agents";
import type { Area } from "@/lib/business";
import { setAgentRole, setAgentName, setAgentArea, inviteAgent } from "@/app/(app)/agents/actions";

const ROLE_COLOR = { admin: "brand", agent: "blue", viewer: "slate" } as const;
const ROLE_LABEL = {
  admin: { es: "Admin", en: "Admin" },
  agent: { es: "Agente", en: "Agent" },
  viewer: { es: "Lector", en: "Viewer" },
};
const ROLE_DESC = {
  admin: { es: "Acceso total: equipo, config y conexión.", en: "Full access: team, config and connection." },
  agent: { es: "Atiende chats y pedidos asignados.", en: "Handles assigned chats and orders." },
  viewer: { es: "Solo lectura.", en: "Read-only." },
};

export function AgentsScreen({
  businessId, agents, areas, isAdmin,
}: {
  businessId: string;
  agents: DetailedAgent[];
  areas: Area[];
  isAdmin: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [showInvite, setShowInvite] = useState(false);
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Agentes" : "Agents"}</h1>
        <Pill color="slate" large>{agents.length}</Pill>
        <span className="grow" />
        {isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setShowInvite(true)}><Icon name="plus" size={14} />{lang === "es" ? "Invitar agente" : "Invite agent"}</button>}
      </div>

      <div className="tablewrap scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>{lang === "es" ? "Agente" : "Agent"}</th>
              <th>{lang === "es" ? "Rol" : "Role"}</th>
              <th>{lang === "es" ? "Área" : "Area"}</th>
              <th>{lang === "es" ? "Chats abiertos" : "Open chats"}</th>
              <th>{lang === "es" ? "Pedidos abiertos" : "Open orders"}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="cust" style={{ gap: 10 }}>
                    <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={34} presence="online" />
                    <div style={{ minWidth: 0 }}>
                      {isAdmin ? (
                        <input className="inp-inline" style={{ height: 28, fontWeight: 600 }} defaultValue={a.name}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.name) run(() => setAgentName(businessId, a.id, v)); }} />
                      ) : <div style={{ fontWeight: 600 }} className="truncate">{a.name}</div>}
                      {a.email && <div className="t-xs muted truncate">{a.email}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  {isAdmin ? (
                    <select className="select select-sm" defaultValue={a.role} onChange={(e) => run(() => setAgentRole(businessId, a.id, e.target.value as DetailedAgent["role"]))}>
                      <option value="admin">Admin</option>
                      <option value="agent">{ROLE_LABEL.agent[lang]}</option>
                      <option value="viewer">{ROLE_LABEL.viewer[lang]}</option>
                    </select>
                  ) : <Pill color={ROLE_COLOR[a.role]}><Icon name="shield" size={11} />{ROLE_LABEL[a.role][lang]}</Pill>}
                </td>
                <td>
                  {isAdmin ? (
                    <select className="select select-sm" defaultValue={a.area ? areas.find((ar) => ar.name === a.area!.name)?.id ?? "" : ""} onChange={(e) => run(() => setAgentArea(businessId, a.id, e.target.value || null))}>
                      <option value="">—</option>
                      {areas.map((ar) => <option key={ar.id} value={ar.id}>{ar.name}</option>)}
                    </select>
                  ) : a.area ? <Pill color={a.area.color as PillColor}>{a.area.name}</Pill> : <span className="muted t-sm">—</span>}
                </td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{a.openChats}</span></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{a.openOrders}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteModal businessId={businessId} areas={areas} onClose={() => setShowInvite(false)} />}
    </div>
  );
}

function InviteModal({ businessId, areas, onClose }: { businessId: string; areas: Area[]; onClose: () => void }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent" | "viewer">("agent");
  const [areaId, setAreaId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function invite() {
    const e = email.trim();
    if (!e) return;
    start(async () => {
      const r = await inviteAgent(businessId, e, role, role === "viewer" ? null : areaId || null);
      if (r.ok) { router.refresh(); onClose(); }
      else setMsg(r.error ?? "error");
    });
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-head"><span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="agents" size={18} /></span><h3 className="grow">{lang === "es" ? "Invitar agente" : "Invite agent"}</h3><button className="iconbtn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body col gap-3">
          <div>
            <label className="lbl">{lang === "es" ? "Correo" : "Email"}</label>
            <div className="field field-lg" style={{ height: 42 }}><Icon name="mail" /><input type="email" placeholder="correo@ejemplo.com" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div>
            <label className="lbl">{lang === "es" ? "Rol" : "Role"}</label>
            <div className="col gap-2">
              {(["admin", "agent", "viewer"] as const).map((r) => (
                <button key={r} className="radio-card" data-on={role === r} onClick={() => setRole(r)} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, border: "1px solid var(--border)", borderRadius: 10, textAlign: "left", background: role === r ? "var(--brand-50)" : "var(--surface)", borderColor: role === r ? "var(--brand)" : "var(--border)", cursor: "pointer" }}>
                  <Icon name="shield" size={16} />
                  <span><span style={{ fontWeight: 700, display: "block" }}>{ROLE_LABEL[r][lang]}</span><span className="t-xs muted">{ROLE_DESC[r][lang]}</span></span>
                </button>
              ))}
            </div>
          </div>
          {role !== "viewer" && (
            <div>
              <label className="lbl">{lang === "es" ? "Área" : "Area"}</label>
              <select className="select" style={{ width: "100%" }} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                <option value="">{lang === "es" ? "Sin área" : "No area"}</option>
                {areas.map((ar) => <option key={ar.id} value={ar.id}>{ar.name}</option>)}
              </select>
            </div>
          )}
          {msg && <div className="t-sm" style={{ color: "var(--danger)" }}>{msg}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !email.trim()} onClick={invite}><Icon name="send" size={15} />{lang === "es" ? "Enviar invitación" : "Send invite"}</button>
        </div>
      </div>
    </div>
  );
}
