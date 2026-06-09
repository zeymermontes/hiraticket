"use client";
import React, { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { DetailedAgent } from "@/lib/agents";
import type { Area } from "@/lib/business";
import { setAgentRole, setAgentName, setAgentArea, inviteAgent, resendInvite, deactivateAgent } from "@/app/(app)/agents/actions";

const ROLE_COLOR = { admin: "brand", agent: "blue", viewer: "slate" } as const;
const ROLE_ICON = { admin: "shield", agent: "user", viewer: "eye" } as const;
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
  const [showInvite, setShowInvite] = useState(false);
  const [editAgent, setEditAgent] = useState<DetailedAgent | null>(null);

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Agentes" : "Agents"}</h1>
        <Pill color="slate" large>{agents.length}</Pill>
        <span className="grow" />
        {isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setShowInvite(true)}><Icon name="plus" size={14} />{lang === "es" ? "Invitar agente" : "Invite agent"}</button>}
      </div>

      <div className="tablewrap scroll">
        <table className="tbl" style={{ minWidth: 840 }}>
          <thead>
            <tr>
              <th>{lang === "es" ? "Agente" : "Agent"}</th>
              <th>{lang === "es" ? "Rol" : "Role"}</th>
              <th>{lang === "es" ? "Área" : "Area"}</th>
              <th>{lang === "es" ? "Estado" : "Status"}</th>
              <th>{lang === "es" ? "Chats abiertos" : "Open chats"}</th>
              <th>{lang === "es" ? "Pedidos abiertos" : "Open orders"}</th>
              {isAdmin && <th style={{ width: 60 }}></th>}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="cust" style={{ gap: 10 }}>
                    <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={34} presence="online" />
                    <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{a.name}</div>
                      {a.email && <div className="t-xs muted truncate">{a.email}</div>}
                    </div>
                  </div>
                </td>
                <td><Pill color={ROLE_COLOR[a.role]}><Icon name={ROLE_ICON[a.role]} size={12} />{ROLE_LABEL[a.role][lang]}</Pill></td>
                <td>{a.area ? <Pill color={a.area.color as PillColor}>{a.area.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td><span className="row gap-2"><span style={{ width: 9, height: 9, borderRadius: 9, background: "var(--green)", display: "inline-block" }} /><span className="t-sm">{lang === "es" ? "En línea" : "Online"}</span></span></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{a.openChats}</span></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{a.openOrders}</span></td>
                {isAdmin && <td><AgentMenu businessId={businessId} agentId={a.id} agentName={a.name} onEdit={() => setEditAgent(a)} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteModal businessId={businessId} areas={areas} onClose={() => setShowInvite(false)} />}
      {editAgent && <EditAgentModal businessId={businessId} agent={editAgent} areas={areas} onClose={() => setEditAgent(null)} />}
    </div>
  );
}

function AgentMenu({ businessId, agentId, agentName, onEdit }: { businessId: string; agentId: string; agentName: string; onEdit: () => void }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => { if (!open && btn.current) setRect(btn.current.getBoundingClientRect()); setOpen((o) => !o); };
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={btn} className="iconbtn sm" onClick={toggle}><Icon name="dots" size={16} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, right: window.innerWidth - rect.right, width: 210, zIndex: 201 }}>
            <button className="menu-item" onClick={() => { setOpen(false); onEdit(); }}><Icon name="edit" size={15} />{lang === "es" ? "Editar permisos" : "Edit permissions"}</button>
            <button className="menu-item" onClick={() => { setOpen(false); start(async () => { const r = await resendInvite(businessId, agentId); alert(r.ok ? (lang === "es" ? "Invitación reenviada." : "Invite resent.") : (r.error ?? "error")); }); }}><Icon name="mail" size={15} />{lang === "es" ? "Reenviar invitación" : "Resend invite"}</button>
            <button className="menu-item danger" onClick={() => { setOpen(false); if (confirm(lang === "es" ? `¿Desactivar a ${agentName}?` : `Deactivate ${agentName}?`)) start(async () => { const r = await deactivateAgent(businessId, agentId); if (!r.ok) alert(r.error === "last-admin" ? (lang === "es" ? "No puedes quitar al último admin." : "Can't remove the last admin.") : r.error === "self" ? (lang === "es" ? "No puedes quitarte a ti mismo." : "Can't remove yourself.") : r.error ?? "error"); else router.refresh(); }); }}><Icon name="trash" size={15} />{lang === "es" ? "Desactivar" : "Deactivate"}</button>
          </div>
        </>
      )}
    </span>
  );
}

function EditAgentModal({ businessId, agent, areas, onClose }: { businessId: string; agent: DetailedAgent; areas: Area[]; onClose: () => void }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState<DetailedAgent["role"]>(agent.role);
  const [areaId, setAreaId] = useState(agent.area?.id ?? "");

  function save() {
    start(async () => {
      if (name.trim() && name.trim() !== agent.name) await setAgentName(businessId, agent.id, name.trim());
      if (role !== agent.role) await setAgentRole(businessId, agent.id, role);
      const newArea = role === "viewer" ? null : (areaId || null);
      if (newArea !== (agent.area?.id ?? null)) await setAgentArea(businessId, agent.id, newArea);
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-head"><Avatar name={agent.name} initials={deriveInitials(agent.name)} color={agent.color} size={36} /><h3 className="grow">{lang === "es" ? "Editar agente" : "Edit agent"}</h3><button className="iconbtn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body col gap-3">
          <div>
            <label className="lbl">{lang === "es" ? "Nombre" : "Name"}</label>
            <input className="inp-inline" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
            {agent.email && <div className="t-xs muted" style={{ marginTop: 4 }}>{agent.email}</div>}
          </div>
          <div>
            <label className="lbl">{lang === "es" ? "Rol" : "Role"}</label>
            <div className="col gap-2">
              {(["admin", "agent", "viewer"] as const).map((r) => (
                <button key={r} onClick={() => setRole(r)} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 10, textAlign: "left", cursor: "pointer", background: role === r ? "var(--brand-50)" : "var(--surface)", border: "1px solid " + (role === r ? "var(--brand)" : "var(--border)") }}>
                  <Icon name={ROLE_ICON[r]} size={16} />
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
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !name.trim()} onClick={save}><Icon name="check" size={15} />{lang === "es" ? "Guardar" : "Save"}</button>
        </div>
      </div>
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
