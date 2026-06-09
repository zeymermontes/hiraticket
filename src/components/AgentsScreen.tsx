"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Agent } from "@/lib/chat";
import { setAgentRole, inviteAgent } from "@/app/(app)/agents/actions";

const ROLE_COLOR = { admin: "brand", agent: "blue", viewer: "slate" } as const;

export function AgentsScreen({
  businessId, agents, isAdmin,
}: {
  businessId: string;
  agents: Agent[];
  isAdmin: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent" | "viewer">("agent");
  const [msg, setMsg] = useState<string | null>(null);

  function invite() {
    const e = email.trim();
    if (!e) return;
    start(async () => {
      const r = await inviteAgent(businessId, e, role);
      setMsg(r.ok ? (lang === "es" ? "Invitación enviada." : "Invite sent.") : r.error ?? "error");
      if (r.ok) setEmail("");
      router.refresh();
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Agentes" : "Agents"}</h1>
        <Pill color="slate" large>{agents.length}</Pill>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="agents" size={16} /><h4>{lang === "es" ? "Equipo" : "Team"}</h4></div>
          <div className="ws-block-body col gap-2">
            {agents.map((a) => (
              <div key={a.id} className="row gap-3" style={{ alignItems: "center", padding: "8px 4px", borderBottom: "1px solid var(--border)" }}>
                <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={36} presence="online" />
                <div className="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }} className="truncate">{a.name}</div></div>
                {isAdmin ? (
                  <select className="select select-sm" defaultValue={a.role}
                    onChange={(e) => start(async () => { await setAgentRole(businessId, a.id, e.target.value as Agent["role"]); router.refresh(); })}>
                    <option value="admin">Admin</option>
                    <option value="agent">{lang === "es" ? "Agente" : "Agent"}</option>
                    <option value="viewer">{lang === "es" ? "Lector" : "Viewer"}</option>
                  </select>
                ) : <Pill color={ROLE_COLOR[a.role]}>{a.role}</Pill>}
              </div>
            ))}
          </div>
        </section>

        {isAdmin && (
          <section className="ws-block">
            <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Invitar" : "Invite"}</h4></div>
            <div className="ws-block-body col gap-2">
              <div className="field field-lg" style={{ height: 42 }}>
                <Icon name="mail" />
                <input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="admin">Admin</option>
                <option value="agent">{lang === "es" ? "Agente" : "Agent"}</option>
                <option value="viewer">{lang === "es" ? "Lector" : "Viewer"}</option>
              </select>
              <button className="btn btn-primary btn-block" disabled={pending || !email.trim()} onClick={invite}>
                <Icon name="send" size={15} />{lang === "es" ? "Enviar invitación" : "Send invite"}
              </button>
              {msg && <div className="t-sm muted">{msg}</div>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
