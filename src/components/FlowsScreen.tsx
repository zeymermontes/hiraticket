"use client";
import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Automation } from "@/lib/extras";
import type { Area, Stage } from "@/lib/business";
import { toggleAutomation, deleteAutomation, createAutomation } from "@/app/(app)/features-actions";

const TRIGGERS: Record<string, { es: string; en: string }> = {
  order_stage: { es: "Un pedido cambia de etapa", en: "An order changes stage" },
  conversation_new: { es: "Inicia un chat nuevo", en: "A new chat starts" },
};

const ACTIONS: Record<string, { es: string; en: string; icon: string }> = {
  send_template: { es: "Enviar plantilla", en: "Send template", icon: "send" },
  notify_agent: { es: "Notificar al agente asignado", en: "Notify assigned agent", icon: "bell" },
  transfer_area: { es: "Transferir al área", en: "Transfer to area", icon: "swap" },
};

function FlowCard({ w, areas, stages }: { w: Automation; areas: Area[]; stages: Stage[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const payload = w.action_payload as { template?: string; area?: string };
  const act = ACTIONS[w.action_type] ?? { es: w.action_type, en: w.action_type, icon: "bolt" };
  const stageName = w.trigger_value ? stages.find((s) => s.id === w.trigger_value)?.name : null;
  const areaName = payload.area ? areas.find((a) => a.id === payload.area)?.name : null;

  return (
    <div className={"flow-card" + (w.enabled ? "" : " off")}>
      <button className={"switch" + (w.enabled ? " on" : "")} aria-label="toggle" onClick={() => run(() => toggleAutomation(w.id, !w.enabled))} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-2">
          <strong className="truncate">{w.name}</strong>
          <span className="grow" />
          <span className="t-xs muted"><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>{w.runs.toLocaleString("es-MX")}</span> {lang === "es" ? "ejecuciones" : "runs"}</span>
        </div>
        <div className="flow-line">
          <span className="flow-node when"><Icon name="bolt" size={14} />{lang === "es" ? "Cuando" : "When"} {(TRIGGERS[w.trigger_type]?.[lang] ?? w.trigger_type).toLowerCase()}</span>
          {stageName && <span className="pill pill-slate">{stageName}</span>}
          <span className="flow-arrow"><Icon name="arrowr" size={16} /></span>
          <span className="flow-node then"><Icon name={act.icon} size={14} />{act[lang]}</span>
          {w.action_type === "send_template" && payload.template && <span className="pill pill-brand">{payload.template}</span>}
          {w.action_type === "transfer_area" && areaName && <span className="pill pill-brand">{areaName}</span>}
        </div>
      </div>
      <button className="iconbtn" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteAutomation(w.id))}><Icon name="trash" /></button>
    </div>
  );
}

export function FlowsScreen({
  businessId, automations, cannedTitles, areas, stages,
}: {
  businessId: string;
  automations: Automation[];
  cannedTitles: string[];
  areas: Area[];
  stages: Stage[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("order_stage");
  const [stageId, setStageId] = useState("");
  const [action, setAction] = useState("send_template");
  const [template, setTemplate] = useState(cannedTitles[0] ?? "");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return automations.filter((w) => !needle || w.name.toLowerCase().includes(needle));
  }, [automations, q]);

  function create() {
    if (!name.trim()) return;
    start(async () => {
      await createAutomation(businessId, {
        name,
        trigger_type: trigger,
        trigger_value: trigger === "order_stage" && stageId ? stageId : null,
        action_type: action,
        template: action === "send_template" ? template : undefined,
        area: action === "transfer_area" ? areaId : undefined,
      });
      router.refresh();
    });
    setName("");
  }

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Flujos" : "Flows"}</h1><Pill color="slate" large>{automations.length}</Pill></div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 260 }}>
          <Icon name="search" />
          <input placeholder={lang === "es" ? "Buscar flujos…" : "Search flows…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <div className="col gap-2">
          {filtered.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin flujos." : "No flows."}</div>}
          {filtered.map((w) => <FlowCard key={w.id} w={w} areas={areas} stages={stages} />)}
        </div>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nuevo flujo" : "New flow"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Nombre" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />

            <label className="lbl">{lang === "es" ? "Cuando" : "When"}</label>
            <select className="select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {Object.keys(TRIGGERS).map((k) => <option key={k} value={k}>{TRIGGERS[k][lang]}</option>)}
            </select>
            {trigger === "order_stage" && (
              <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">{lang === "es" ? "Cualquier etapa" : "Any stage"}</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}

            <label className="lbl">{lang === "es" ? "Entonces" : "Then"}</label>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              {Object.keys(ACTIONS).map((k) => <option key={k} value={k}>{ACTIONS[k][lang]}</option>)}
            </select>
            {action === "send_template" && (
              <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
                {cannedTitles.length === 0 && <option value="">{lang === "es" ? "(crea una plantilla)" : "(create a template)"}</option>}
                {cannedTitles.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {action === "transfer_area" && (
              <select className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}

            <button className="btn btn-primary btn-block" disabled={pending || !name.trim()} onClick={create}>
              <Icon name="plus" size={15} />{lang === "es" ? "Crear flujo" : "Create flow"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
