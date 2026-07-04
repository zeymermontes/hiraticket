"use client";
import React, { useCallback, useEffect, useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useConfirm } from "@/components/Confirm";
import type { PillColor } from "@/lib/types";
import type { DetailedAgent } from "@/lib/agents";
import type { Area } from "@/lib/business";
import { setAgentRole, setAgentName, setAgentArea, inviteAgent, deactivateAgent, getSeatStatus, addSeat } from "@/app/(app)/agents/actions";
import { createInviteLink, listInvites, revokeInvite, type InviteRow } from "@/app/(app)/invites/actions";

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
  const router = useRouter();
  const [, startT] = useTransition();
  const [showInvite, setShowInvite] = useState(false);
  const [editAgent, setEditAgent] = useState<DetailedAgent | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const loadInvites = useCallback(() => { if (isAdmin) listInvites(businessId).then(setInvites).catch(() => {}); }, [businessId, isAdmin]);
  useEffect(() => { loadInvites(); }, [loadInvites]);
  // Seat gate: over the agent limit (and not in trial) → prompt to remove an agent or add a seat.
  const [seat, setSeat] = useState<Awaited<ReturnType<typeof getSeatStatus>> | null>(null);
  const [gateDismissed, setGateDismissed] = useState(false);
  const refreshSeat = useCallback(() => { if (isAdmin) getSeatStatus(businessId).then(setSeat).catch(() => {}); }, [businessId, isAdmin]);
  useEffect(() => { refreshSeat(); }, [refreshSeat, agents.length]);

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
                    <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} src={a.avatar_url ?? undefined} size={34} presence="online" />
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

      {isAdmin && invites.length > 0 && (
        <div className="ws-block" style={{ margin: "0 24px 24px", maxWidth: 720 }}>
          <div className="ws-block-head"><Icon name="mail" size={16} /><h4 className="grow">{lang === "es" ? "Invitaciones pendientes" : "Pending invitations"}</h4><Pill color="slate">{invites.length}</Pill></div>
          <div className="ws-block-body col gap-2">
            {invites.map((iv) => (
              <div key={iv.id} className="row gap-2" style={{ alignItems: "center" }}>
                <span className="t-ic" style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surface-2)", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={iv.token ? "send" : "mail"} size={14} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{iv.email ?? (lang === "es" ? "Enlace de invitación" : "Invite link")}</div>
                  <div className="t-xs muted">
                    {ROLE_LABEL[iv.role][lang]}
                    {iv.token && <> · {iv.max_uses === 1 ? (lang === "es" ? "un uso" : "one-time") : (lang === "es" ? `${iv.used_count} usos` : `${iv.used_count} uses`)}</>}
                    {iv.expires_at && <> · {lang === "es" ? "expira " : "expires "}{new Date(iv.expires_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</>}
                  </div>
                </div>
                {iv.url && <button className="iconbtn sm" title={lang === "es" ? "Copiar enlace" : "Copy link"} onClick={() => navigator.clipboard?.writeText(iv.url!).catch(() => {})}><Icon name="paperclip" size={14} /></button>}
                <button className="iconbtn sm" style={{ color: "var(--red)" }} title={lang === "es" ? "Revocar" : "Revoke"} onClick={() => startT(async () => { await revokeInvite(businessId, iv.id); loadInvites(); router.refresh(); })}><Icon name="trash" size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showInvite && <InviteModal businessId={businessId} areas={areas} onClose={() => setShowInvite(false)} onChanged={loadInvites} />}
      {editAgent && <EditAgentModal businessId={businessId} agent={editAgent} areas={areas} onClose={() => setEditAgent(null)} />}
      {isAdmin && seat?.needsAction && !gateDismissed && (
        <SeatGateModal seat={seat} businessId={businessId} onDismiss={() => setGateDismissed(true)} onResolved={() => { setGateDismissed(false); refreshSeat(); router.refresh(); }} />
      )}
    </div>
  );
}

function SeatGateModal({ seat, businessId, onResolved, onDismiss }: { seat: { current: number; allowed: number; price: number }; businessId: string; onResolved: () => void; onDismiss: () => void }) {
  const { lang } = useApp();
  const [busy, setBusy] = useState(false);
  const add = () => { setBusy(true); addSeat(businessId).then(onResolved).finally(() => setBusy(false)); };
  return (
    <div className="modal-wrap" style={{ zIndex: 1100 }}>
      <div className="scrim" />
      <div className="modal" style={{ width: 460, maxWidth: "92vw" }} role="alertdialog" aria-modal="true">
        <div className="modal-head">
          <span className="t-ic" style={{ color: "var(--red)" }}><Icon name="agents" size={18} /></span>
          <h3 className="grow">{lang === "es" ? "Excediste tus agentes" : "You're over your agent limit"}</h3>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0, lineHeight: 1.55 }}>
            {lang === "es"
              ? `Tienes ${seat.current} agentes pero tu plan permite ${seat.allowed}. Para seguir, elimina un agente o agrega un asiento por $${seat.price} MXN/mes.`
              : `You have ${seat.current} agents but your plan allows ${seat.allowed}. To continue, remove an agent or add a seat for $${seat.price} MXN/mo.`}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline grow" disabled={busy} onClick={onDismiss}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar un agente" : "Remove an agent"}</button>
          <button className="btn btn-primary grow" disabled={busy} onClick={add}><Icon name="plus" size={15} />{lang === "es" ? `Agregar asiento (+$${seat.price})` : `Add a seat (+$${seat.price})`}</button>
        </div>
      </div>
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
            <button className="menu-item danger" onClick={() => { setOpen(false); if (confirm(lang === "es" ? `¿Eliminar a ${agentName} del equipo? Perderá el acceso.` : `Remove ${agentName} from the team? They'll lose access.`)) start(async () => { const r = await deactivateAgent(businessId, agentId); if (!r.ok) alert(r.error === "last-admin" ? (lang === "es" ? "No puedes quitar al último admin." : "Can't remove the last admin.") : r.error === "self" ? (lang === "es" ? "No puedes quitarte a ti mismo." : "Can't remove yourself.") : r.error ?? "error"); else router.refresh(); }); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar del equipo" : "Remove from team"}</button>
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
      if (name.trim() && name.trim() !== agent.name) {
        const r = await setAgentName(businessId, agent.id, name.trim());
        if (!r.ok) {
          alert(r.error === "forbidden"
            ? (lang === "es" ? "No tienes permisos de admin para renombrar agentes." : "You need admin rights to rename agents.")
            : (lang === "es" ? "No se pudo cambiar el nombre: " : "Couldn't change the name: ") + (r.error ?? "error"));
          return;
        }
      }
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
        <div className="modal-head"><Avatar name={agent.name} initials={deriveInitials(agent.name)} color={agent.color} src={agent.avatar_url ?? undefined} size={36} /><h3 className="grow">{lang === "es" ? "Editar agente" : "Edit agent"}</h3><button className="iconbtn" onClick={onClose}><Icon name="x" /></button></div>
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

function InviteModal({ businessId, areas, onClose, onChanged }: { businessId: string; areas: Area[]; onClose: () => void; onChanged: () => void }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent" | "viewer">("agent");
  const [areaId, setAreaId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [expiresDays, setExpiresDays] = useState("7");
  const [oneTime, setOneTime] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const errMsg = (e?: string) =>
    e === "no-account" ? (lang === "es" ? "Esta persona aún no tiene cuenta en Hiraticket. Pídele que cree una cuenta primero, o usa un enlace de invitación." : "This person doesn't have a Hiraticket account yet. Ask them to sign up first, or use an invite link.")
      : e === "in-another-team" ? (lang === "es" ? "Ya pertenece a otro equipo. Una cuenta solo puede estar en un equipo." : "Already belongs to another team. An account can only be in one team.")
        : e === "already-member" ? (lang === "es" ? "Ya está en tu equipo." : "Already in your team.")
          : e === "forbidden" ? (lang === "es" ? "Necesitas permisos de admin." : "You need admin rights.")
            : (lang === "es" ? "No se pudo invitar." : "Couldn't invite.");

  const area = () => (role === "viewer" ? null : areaId || null);
  const ask = useConfirm();
  const [busy, setBusy] = useState(false);

  const submitInvite = async (allowExtra: boolean): Promise<void> => {
    const e = email.trim();
    const r = await inviteAgent(businessId, e, role, area(), allowExtra);
    if (r.ok) { setOk(lang === "es" ? "Invitación enviada. La verá al entrar a Hiraticket." : "Invite sent. They'll see it when they open Hiraticket."); setEmail(""); onChanged(); router.refresh(); return; }
    if (r.error === "over-limit" && r.extra) {
      const yes = await ask({
        icon: "agents",
        title: lang === "es" ? "Agente adicional" : "Extra agent",
        message: lang === "es"
          ? `Tu plan incluye ${r.extra.included} agentes y ya tienes ${r.extra.current}. Este agente adicional cuesta $${r.extra.price} MXN/mes. ¿Invitarlo de todos modos?`
          : `Your plan includes ${r.extra.included} agents and you already have ${r.extra.current}. This extra agent costs $${r.extra.price} MXN/mo. Invite anyway?`,
        confirmLabel: lang === "es" ? "Invitar" : "Invite",
        cancelLabel: lang === "es" ? "Cancelar" : "Cancel",
      });
      if (yes) await submitInvite(true);
      return;
    }
    setErr(errMsg(r.error));
  };

  function invite() {
    if (!email.trim()) return;
    setErr(null); setOk(null); setBusy(true);
    submitInvite(false).finally(() => setBusy(false));
  }
  function genLink() {
    setErr(null); setLink(null);
    start(async () => {
      const r = await createInviteLink(businessId, role, area(), { expiresInDays: expiresDays === "0" ? null : Number(expiresDays), oneTime });
      if (r.ok && r.url) { setLink(r.url); onChanged(); }
      else setErr(errMsg(r.error));
    });
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal scroll" style={{ maxHeight: "92vh" }}>
        <div className="modal-head"><span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="agents" size={18} /></span><h3 className="grow">{lang === "es" ? "Invitar al equipo" : "Invite to team"}</h3><button className="iconbtn" onClick={onClose}><Icon name="x" /></button></div>
        <div className="modal-body col gap-3">
          <div>
            <label className="lbl">{lang === "es" ? "Rol" : "Role"}</label>
            <div className="col gap-2">
              {(["admin", "agent", "viewer"] as const).map((r) => (
                <button key={r} className="radio-card" data-on={role === r} onClick={() => setRole(r)} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, border: "1px solid var(--border)", borderRadius: 10, textAlign: "left", background: role === r ? "var(--brand-50)" : "var(--surface)", borderColor: role === r ? "var(--brand)" : "var(--border)", cursor: "pointer" }}>
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

          <div>
            <label className="lbl">{lang === "es" ? "Invitar por correo (cuenta existente)" : "Invite by email (existing account)"}</label>
            <div className="row gap-2">
              <div className="field field-lg grow" style={{ height: 42 }}><Icon name="mail" /><input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") invite(); }} /></div>
              <button className="btn btn-primary" disabled={pending || busy || !email.trim()} onClick={invite}><Icon name="send" size={15} />{lang === "es" ? "Invitar" : "Invite"}</button>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <label className="lbl">{lang === "es" ? "O comparte un enlace para unirse" : "Or share a join link"}</label>
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <select className="select select-sm" value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)}>
                <option value="1">{lang === "es" ? "Expira en 1 día" : "Expires in 1 day"}</option>
                <option value="7">{lang === "es" ? "Expira en 7 días" : "Expires in 7 days"}</option>
                <option value="30">{lang === "es" ? "Expira en 30 días" : "Expires in 30 days"}</option>
                <option value="0">{lang === "es" ? "Sin expiración" : "No expiration"}</option>
              </select>
              <button type="button" className={"chip" + (oneTime ? " on" : "")} onClick={() => setOneTime((v) => !v)}>{lang === "es" ? "Un solo uso" : "One-time"}</button>
              <span className="grow" />
              <button className="btn btn-sm btn-outline" disabled={pending} onClick={genLink}><Icon name="plus" size={14} />{lang === "es" ? "Generar enlace" : "Generate link"}</button>
            </div>
            {link && (
              <div className="row gap-2" style={{ marginTop: 8, alignItems: "center" }}>
                <div className="field field-sm field-filled grow"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></div>
                <button className="btn btn-sm btn-primary" onClick={() => navigator.clipboard?.writeText(link).catch(() => {})}><Icon name="paperclip" size={14} />{lang === "es" ? "Copiar" : "Copy"}</button>
              </div>
            )}
          </div>

          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
          {ok && <div className="t-sm" style={{ color: "var(--green)" }}>{ok}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline btn-block" onClick={onClose}>{lang === "es" ? "Cerrar" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}
