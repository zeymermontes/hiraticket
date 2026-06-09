"use client";
import React, { useState, useTransition } from "react";
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
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("order_stage");
  const [template, setTemplate] = useState(cannedTitles[0] ?? "");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Flujos" : "Flows"}</h1><Pill color="slate" large>{automations.length}</Pill></div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="bolt" size={16} /><h4>{lang === "es" ? "Automatizaciones" : "Automations"}</h4></div>
          <div className="ws-block-body col gap-2">
            {automations.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin flujos." : "No flows."}</div>}
            {automations.map((w) => {
              const tpl = (w.action_payload as { template?: string })?.template;
              return (
                <div key={w.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
                  <div className="row gap-2">
                    <strong>{w.name}</strong>
                    <span className="grow" />
                    <span className="t-xs muted">{w.runs} {lang === "es" ? "ejecuciones" : "runs"}</span>
                    <button className={"btn btn-sm " + (w.enabled ? "btn-primary" : "btn-outline")} onClick={() => run(() => toggleAutomation(w.id, !w.enabled))}>
                      {w.enabled ? (lang === "es" ? "Activo" : "On") : (lang === "es" ? "Pausado" : "Off")}
                    </button>
                    <button className="iconbtn sm" onClick={() => run(() => deleteAutomation(w.id))}><Icon name="trash" size={15} /></button>
                  </div>
                  <div className="row gap-2 t-sm muted" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    <Pill color="blue"><Icon name="bolt" size={11} />{TRIGGERS[w.trigger_type]?.[lang] ?? w.trigger_type}</Pill>
                    <Icon name="arrowr" size={13} />
                    <Pill color="brand">{lang === "es" ? "Enviar" : "Send"}: {tpl ?? w.action_type}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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
              onClick={() => { run(() => createAutomation(businessId, { name, trigger_type: trigger, trigger_value: null, action_type: "send_template", template })); setName(""); }}>
              <Icon name="plus" size={15} />{lang === "es" ? "Crear flujo" : "Create flow"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
