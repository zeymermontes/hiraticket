"use client";
import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Automation } from "@/lib/extras";
import { toggleAutomation, deleteAutomation, createAutomation } from "@/app/(app)/features-actions";

const TRIGGERS: Record<string, { es: string; en: string }> = {
  order_stage: { es: "Un pedido cambia de etapa", en: "An order changes stage" },
  conversation_new: { es: "Inicia un chat nuevo", en: "A new chat starts" },
};

function FlowCard({ w }: { w: Automation }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const tpl = (w.action_payload as { template?: string })?.template;

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
          <span className="flow-arrow"><Icon name="arrowr" size={16} /></span>
          <span className="flow-node then"><Icon name="send" size={14} />{lang === "es" ? "Enviar plantilla" : "Send template"}</span>
          {tpl && <span className="pill pill-brand">{tpl}</span>}
        </div>
      </div>
      <button className="iconbtn" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteAutomation(w.id))}><Icon name="trash" /></button>
    </div>
  );
}

export function FlowsScreen({
  businessId, automations, cannedTitles,
}: {
  businessId: string;
  automations: Automation[];
  cannedTitles: string[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("order_stage");
  const [template, setTemplate] = useState(cannedTitles[0] ?? "");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return automations.filter((w) => !needle || w.name.toLowerCase().includes(needle));
  }, [automations, q]);

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
          {filtered.map((w) => <FlowCard key={w.id} w={w} />)}
        </div>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nuevo flujo" : "New flow"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Nombre" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />
            <label className="lbl">{lang === "es" ? "Cuando" : "When"}</label>
            <select className="select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {Object.keys(TRIGGERS).map((k) => <option key={k} value={k}>{TRIGGERS[k][lang]}</option>)}
            </select>
            <label className="lbl">{lang === "es" ? "Enviar plantilla" : "Send template"}</label>
            <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {cannedTitles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn btn-primary btn-block" disabled={pending || !name.trim()}
              onClick={() => { start(async () => { await createAutomation(businessId, { name, trigger_type: trigger, trigger_value: null, action_type: "send_template", template }); router.refresh(); }); setName(""); }}>
              <Icon name="plus" size={15} />{lang === "es" ? "Crear flujo" : "Create flow"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
