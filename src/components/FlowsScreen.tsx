"use client";
import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Automation } from "@/lib/extras";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { toggleAutomation, deleteAutomation, createAutomation, updateAutomation } from "@/app/(app)/features-actions";

const TRIGGERS: Record<string, { es: string; en: string }> = {
  order_stage: { es: "Un pedido cambia de etapa", en: "An order changes stage" },
  conversation_status: { es: "Una conversación cambia de estado", en: "A conversation changes status" },
  conversation_new: { es: "Inicia un chat nuevo", en: "A new chat starts" },
  message_hours: { es: "Llega un mensaje fuera de horario", en: "A message arrives outside hours" },
  message_date: { es: "Llega un mensaje en un día de asueto", en: "A message arrives on a holiday" },
};
const TRIGGER_ICON: Record<string, string> = {
  order_stage: "orders", conversation_status: "chat", conversation_new: "bell",
  message_hours: "moon", message_date: "calendar",
};
const isSchedule = (t: string) => t === "message_hours" || t === "message_date";
const triggerLabel = (key: string, personal: boolean, lang: "es" | "en") =>
  key === "order_stage" && personal ? (lang === "es" ? "Una tarea cambia de etapa" : "A task changes stage") : (TRIGGERS[key]?.[lang] ?? key);

const CONV_STATUS: Record<string, { es: string; en: string }> = {
  open: { es: "Abierto", en: "Open" },
  pending: { es: "Pendiente", en: "Pending" },
  resolved: { es: "Resuelto", en: "Resolved" },
};

/** Human label for a holiday date — "25 dic (cada año)" if recurring, else the full date. */
function holidayLabel(date: string | undefined, recurring: boolean | undefined, lang: "es" | "en"): string {
  if (!date) return "—";
  const d = new Date(date + "T00:00:00");
  if (recurring) return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" }) + (lang === "es" ? " (cada año)" : " (yearly)");
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "numeric" });
}

const ACTIONS: Record<string, { es: string; en: string; icon: string }> = {
  send_template: { es: "Enviar plantilla", en: "Send template", icon: "send" },
  notify_agent: { es: "Notificar al agente asignado", en: "Notify assigned agent", icon: "bell" },
  transfer_area: { es: "Transferir al área", en: "Transfer to area", icon: "swap" },
  assign_agent: { es: "Asignar a un agente", en: "Assign to an agent", icon: "agents" },
  add_tag: { es: "Agregar etiqueta", en: "Add a tag", icon: "tag" },
};

function FlowCard({ w, areas, stages, agents, onEdit, editing }: { w: Automation; areas: Area[]; stages: Stage[]; agents: Agent[]; onEdit: () => void; editing: boolean }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const payload = w.action_payload as { template?: string; area?: string; agent?: string; tag?: string };
  const act = ACTIONS[w.action_type] ?? { es: w.action_type, en: w.action_type, icon: "bolt" };
  const cfg = (w.trigger_config ?? {}) as { open_from?: string; open_to?: string; date?: string; recurring?: boolean };
  const triggerVal = w.trigger_type === "message_hours"
    ? `${cfg.open_from ?? "?"}–${cfg.open_to ?? "?"}`
    : w.trigger_type === "message_date"
      ? holidayLabel(cfg.date, cfg.recurring, lang)
      : w.trigger_value
        ? (w.trigger_type === "conversation_status"
            ? CONV_STATUS[w.trigger_value]?.[lang]
            : stages.find((s) => s.id === w.trigger_value)?.name)
        : null;
  const areaName = payload.area ? areas.find((a) => a.id === payload.area)?.name : null;
  const agentName = payload.agent ? agents.find((a) => a.id === payload.agent)?.name : null;

  return (
    <div className={"flow-card" + (w.enabled ? "" : " off") + (editing ? " sel-row" : "")}>
      <button className={"switch" + (w.enabled ? " on" : "")} aria-label="toggle" onClick={() => run(() => toggleAutomation(w.id, !w.enabled))} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-2">
          <strong className="truncate">{w.name}</strong>
          <Pill color={w.enabled ? "green" : "slate"} dot>{w.enabled ? (lang === "es" ? "Activo" : "Active") : (lang === "es" ? "Pausado" : "Paused")}</Pill>
          <span className="grow" />
          <span className="t-xs muted"><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>{w.runs.toLocaleString("es-MX")}</span> {lang === "es" ? "ejecuciones" : "runs"}</span>
        </div>
        <div className="flow-line">
          <span className="flow-node when"><Icon name={TRIGGER_ICON[w.trigger_type] ?? "bolt"} size={14} />{lang === "es" ? "Cuando" : "When"} {triggerLabel(w.trigger_type, personal, lang).toLowerCase()}</span>
          {triggerVal && <span className="pill pill-slate">{triggerVal}</span>}
          <span className="flow-arrow"><Icon name="arrowr" size={16} /></span>
          <span className="flow-node then"><Icon name={act.icon} size={14} />{act[lang]}</span>
          {w.action_type === "send_template" && payload.template && <span className="pill pill-brand">{payload.template}</span>}
          {w.action_type === "transfer_area" && areaName && <span className="pill pill-brand">{areaName}</span>}
          {w.action_type === "assign_agent" && agentName && <span className="pill pill-brand">{agentName}</span>}
          {w.action_type === "add_tag" && payload.tag && <span className="pill pill-brand">{payload.tag}</span>}
        </div>
      </div>
      <button className="iconbtn" title={lang === "es" ? "Editar" : "Edit"} onClick={onEdit}><Icon name="edit" /></button>
      <button className="iconbtn" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteAutomation(w.id))}><Icon name="trash" /></button>
    </div>
  );
}

export function FlowsScreen({
  businessId, automations, cannedTitles, areas, stages, agents,
}: {
  businessId: string;
  automations: Automation[];
  cannedTitles: string[];
  areas: Area[];
  stages: Stage[];
  agents: Agent[];
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("order_stage");
  const [stageId, setStageId] = useState("");
  const [statusVal, setStatusVal] = useState("open");
  const [action, setAction] = useState("send_template");
  const [template, setTemplate] = useState(cannedTitles[0] ?? "");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [tag, setTag] = useState("");
  // Schedule config (message_hours / message_date triggers).
  const [openFrom, setOpenFrom] = useState("10:00");
  const [openTo, setOpenTo] = useState("17:00");
  const [holidayDate, setHolidayDate] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [cooldown, setCooldown] = useState("6");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return automations.filter((w) => !needle || w.name.toLowerCase().includes(needle));
  }, [automations, q]);

  function resetForm() {
    setEditId(null); setName(""); setTag("");
    setTrigger("order_stage"); setStageId(""); setStatusVal("open"); setAction("send_template");
    setTemplate(cannedTitles[0] ?? ""); setAreaId(areas[0]?.id ?? ""); setAgentId(agents[0]?.id ?? "");
    setOpenFrom("10:00"); setOpenTo("17:00"); setHolidayDate(""); setRecurring(true); setCooldown("6");
  }

  function startEdit(w: Automation) {
    const p = (w.action_payload ?? {}) as { template?: string; area?: string; agent?: string; tag?: string };
    const cfg = (w.trigger_config ?? {}) as { open_from?: string; open_to?: string; date?: string; recurring?: boolean; cooldown_hours?: number };
    setEditId(w.id);
    setName(w.name);
    setTrigger(w.trigger_type);
    setStageId(w.trigger_type === "order_stage" ? (w.trigger_value ?? "") : "");
    setStatusVal(w.trigger_type === "conversation_status" ? (w.trigger_value ?? "open") : "open");
    // Schedule triggers always send a template; otherwise keep the stored action.
    setAction(isSchedule(w.trigger_type) ? "send_template" : w.action_type);
    setTemplate(p.template ?? cannedTitles[0] ?? "");
    setAreaId(p.area ?? areas[0]?.id ?? "");
    setAgentId(p.agent ?? agents[0]?.id ?? "");
    setTag(p.tag ?? "");
    setOpenFrom(cfg.open_from ?? "10:00");
    setOpenTo(cfg.open_to ?? "17:00");
    setHolidayDate(cfg.date ?? "");
    setRecurring(cfg.recurring ?? true);
    setCooldown(String(cfg.cooldown_hours ?? 6));
    if (typeof document !== "undefined") document.querySelector(".page")?.scrollTo?.({ top: 0 });
  }

  function save() {
    if (!name.trim()) return;
    if (trigger === "message_date" && !holidayDate) return;
    // The time/date triggers fire on inbound messages and only ever send a template.
    const effAction = isSchedule(trigger) ? "send_template" : action;
    const cool = Math.max(0, Math.round(Number(cooldown) || 0));
    const schedule = trigger === "message_hours"
      ? { open_from: openFrom, open_to: openTo, cooldown_hours: cool }
      : trigger === "message_date"
        ? { date: holidayDate, recurring, cooldown_hours: cool }
        : undefined;
    const input = {
      name,
      trigger_type: trigger,
      trigger_value: trigger === "order_stage" ? (stageId || null) : trigger === "conversation_status" ? statusVal : null,
      action_type: effAction,
      template: effAction === "send_template" ? template : undefined,
      area: effAction === "transfer_area" ? areaId : undefined,
      agent: effAction === "assign_agent" ? agentId : undefined,
      tag: effAction === "add_tag" ? tag.trim() : undefined,
      schedule,
    };
    const id = editId;
    start(async () => {
      if (id) await updateAutomation(id, input); else await createAutomation(businessId, input);
      router.refresh();
    });
    resetForm();
  }

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Flujos" : "Flows"}</h1><Pill color="slate" large>{automations.length}</Pill>
        <span className="t-sm muted hide-narrow" style={{ marginLeft: 8 }}>{lang === "es" ? "Automatiza respuestas y transferencias" : "Automate replies and transfers"}</span>
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 260 }}>
          <Icon name="search" />
          <input placeholder={lang === "es" ? "Buscar flujos…" : "Search flows…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="row gap-3" style={{ padding: "0 24px 12px", flexWrap: "wrap" }}>
        <div className="ws-block" style={{ flex: 1, minWidth: 200 }}><div className="ws-block-body row gap-3" style={{ alignItems: "center" }}><span className="t-ic" style={{ width: 38, height: 38, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="bolt" size={18} /></span><div><div className="mono" style={{ fontWeight: 800, fontSize: 22 }}>{automations.filter((w) => w.enabled).length}</div><div className="t-xs muted">{lang === "es" ? "Flujos activos" : "Enabled flows"}</div></div></div></div>
        <div className="ws-block" style={{ flex: 1, minWidth: 200 }}><div className="ws-block-body row gap-3" style={{ alignItems: "center" }}><span className="t-ic" style={{ width: 38, height: 38, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="send" size={18} /></span><div><div className="mono" style={{ fontWeight: 800, fontSize: 22 }}>{automations.reduce((s, w) => s + (w.runs || 0), 0).toLocaleString("es-MX")}</div><div className="t-xs muted">{lang === "es" ? "Mensajes automatizados" : "Messages automated"}</div></div></div></div>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <div className="col gap-2">
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "48px 24px" }}>
              <div className="empty-art"><Icon name="bolt" /></div>
              <h3>{lang === "es" ? "Sin flujos todavía" : "No flows yet"}</h3>
              <p className="muted t-sm">{lang === "es" ? "Crea tu primer flujo para automatizar respuestas y transferencias." : "Create your first flow to automate replies and transfers."}</p>
            </div>
          ) : filtered.map((w) => <FlowCard key={w.id} w={w} areas={areas} stages={stages} agents={agents} editing={editId === w.id} onEdit={() => startEdit(w)} />)}
          {filtered.length > 0 && <div className="t-xs muted" style={{ padding: "8px 4px" }}>{personal ? (lang === "es" ? "Pruébalo: avanza una tarea a “Listo” y se envía la plantilla automáticamente." : "Try it: advance a task to “Ready” and the template is sent automatically.") : (lang === "es" ? "Pruébalo: avanza un pedido a “Listo” y se envía la plantilla automáticamente." : "Try it: advance an order to “Ready” and the template is sent automatically.")}</div>}
        </div>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name={editId ? "edit" : "plus"} size={16} /><h4 className="grow">{editId ? (lang === "es" ? "Editar flujo" : "Edit flow") : (lang === "es" ? "Nuevo flujo" : "New flow")}</h4>{editId && <button className="iconbtn sm" title={lang === "es" ? "Cancelar" : "Cancel"} onClick={resetForm}><Icon name="x" size={15} /></button>}</div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Nombre" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />

            <label className="lbl">{lang === "es" ? "Cuando" : "When"}</label>
            <select className="select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {Object.keys(TRIGGERS).map((k) => <option key={k} value={k}>{triggerLabel(k, personal, lang)}</option>)}
            </select>
            {trigger === "order_stage" && (
              <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">{lang === "es" ? "Cualquier etapa" : "Any stage"}</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {trigger === "conversation_status" && (
              <select className="select" value={statusVal} onChange={(e) => setStatusVal(e.target.value)}>
                {Object.keys(CONV_STATUS).map((k) => <option key={k} value={k}>{CONV_STATUS[k][lang]}</option>)}
              </select>
            )}
            {trigger === "message_hours" && (
              <>
                <div className="row gap-2">
                  <div className="col gap-1 grow"><label className="lbl">{lang === "es" ? "Abre" : "Opens"}</label><input className="inp-inline" type="time" value={openFrom} onChange={(e) => setOpenFrom(e.target.value)} /></div>
                  <div className="col gap-1 grow"><label className="lbl">{lang === "es" ? "Cierra" : "Closes"}</label><input className="inp-inline" type="time" value={openTo} onChange={(e) => setOpenTo(e.target.value)} /></div>
                </div>
                <span className="t-xs muted">{lang === "es" ? `Fuera de ${openFrom}–${openTo} (hora del negocio) se responde con la plantilla.` : `Outside ${openFrom}–${openTo} (business time) the template is sent.`}</span>
              </>
            )}
            {trigger === "message_date" && (
              <>
                <input className="inp-inline" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
                <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                  <span className="t-sm">{lang === "es" ? "Repetir cada año (asueto permanente)" : "Repeat every year (permanent holiday)"}</span>
                </label>
              </>
            )}
            {isSchedule(trigger) && (
              <div className="col gap-1">
                <label className="lbl">{lang === "es" ? "No repetir antes de (horas)" : "Don't repeat before (hours)"}</label>
                <input className="inp-inline" type="number" min={0} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
              </div>
            )}

            <label className="lbl">{lang === "es" ? "Entonces" : "Then"}</label>
            {isSchedule(trigger) ? (
              <div className="row gap-2" style={{ alignItems: "center" }}><Pill color="brand"><Icon name="send" size={13} />{lang === "es" ? "Enviar plantilla" : "Send template"}</Pill></div>
            ) : (
              <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
                {Object.keys(ACTIONS).map((k) => <option key={k} value={k}>{ACTIONS[k][lang]}</option>)}
              </select>
            )}
            {(isSchedule(trigger) || action === "send_template") && (
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
                {cannedTitles.length === 0 && <option value="">{lang === "es" ? "(crea una plantilla)" : "(create a template)"}</option>}
                {cannedTitles.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {!isSchedule(trigger) && action === "transfer_area" && (
              <select className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {!isSchedule(trigger) && action === "assign_agent" && (
              <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.filter((a) => a.role !== "viewer").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {!isSchedule(trigger) && action === "add_tag" && (
              <input className="inp-inline" placeholder={lang === "es" ? "Etiqueta (ej. VIP)" : "Tag (e.g. VIP)"} value={tag} onChange={(e) => setTag(e.target.value)} />
            )}

            <button className="btn btn-primary btn-block" disabled={pending || !name.trim() || (trigger === "message_date" && !holidayDate)} onClick={save}>
              <Icon name={editId ? "check" : "plus"} size={15} />{editId ? (lang === "es" ? "Guardar cambios" : "Save changes") : (lang === "es" ? "Crear flujo" : "Create flow")}
            </button>
            {editId && <button className="btn btn-outline btn-block" onClick={resetForm}>{lang === "es" ? "Cancelar" : "Cancel"}</button>}
          </div>
        </section>
      </div>
    </div>
  );
}
