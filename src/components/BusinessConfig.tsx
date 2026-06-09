"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import {
  createArea, updateArea, deleteArea, createStage, updateStage, deleteStage,
} from "@/app/(app)/business/actions";

const COLORS: PillColor[] = ["slate", "blue", "violet", "teal", "green", "amber", "red", "brand"];

function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="iconbtn sm" onClick={() => setOpen((o) => !o)} title="Color">
        <span style={{ width: 14, height: 14, borderRadius: 5, background: `var(--${value})`, display: "inline-block" }} />
      </button>
      {open && (
        <div className="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, zIndex: 50 }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => { onPick(c); setOpen(false); }} style={{ width: 22, height: 22, borderRadius: 6, background: `var(--${c})`, border: c === value ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
      )}
    </span>
  );
}

export function BusinessConfig({
  businessId, businessName, stages, areas, agents,
}: {
  businessId: string;
  businessName: string;
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [newStage, setNewStage] = useState("");
  const [newArea, setNewArea] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Negocio" : "Business"}</h1>
        <Pill color="slate" large>{businessName}</Pill>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Stages */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="dot" size={16} /><h4 className="grow">{lang === "es" ? "Etapas del pedido" : "Order stages"}</h4></div>
          <div className="ws-block-body col gap-2">
            {stages.map((s) => (
              <div key={s.id} className="row gap-2">
                <ColorPicker value={s.color} onPick={(c) => run(() => updateStage(s.id, { color: c }))} />
                <input className="inp-inline grow" defaultValue={s.name}
                  onBlur={(e) => { if (e.target.value !== s.name) run(() => updateStage(s.id, { name: e.target.value })); }} />
                <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteStage(s.id))}><Icon name="x" size={15} /></button>
              </div>
            ))}
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva etapa…" : "New stage…"} value={newStage} onChange={(e) => setNewStage(e.target.value)} />
              <button className="btn btn-sm btn-primary" disabled={!newStage.trim()} onClick={() => { run(() => createStage(businessId, newStage, stages.length)); setNewStage(""); }}><Icon name="plus" size={14} /></button>
            </div>
          </div>
        </section>

        {/* Areas */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="layers" size={16} /><h4 className="grow">{lang === "es" ? "Áreas y ruteo" : "Areas & routing"}</h4></div>
          <div className="ws-block-body col gap-2">
            {areas.map((a) => (
              <div key={a.id} className="row gap-2">
                <ColorPicker value={a.color} onPick={(c) => run(() => updateArea(a.id, { color: c }))} />
                <input className="inp-inline grow" defaultValue={a.name}
                  onBlur={(e) => { if (e.target.value !== a.name) run(() => updateArea(a.id, { name: e.target.value })); }} />
                <select className="select select-sm" defaultValue={a.route_to ?? ""}
                  onChange={(e) => run(() => updateArea(a.id, { route_to: e.target.value || null }))} title={lang === "es" ? "Asignado por defecto" : "Default assignee"}>
                  <option value="">{lang === "es" ? "Sin ruteo" : "No routing"}</option>
                  {agents.filter((ag) => ag.role !== "viewer").map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
                </select>
                <button className="iconbtn sm" onClick={() => run(() => deleteArea(a.id))}><Icon name="x" size={15} /></button>
              </div>
            ))}
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva área…" : "New area…"} value={newArea} onChange={(e) => setNewArea(e.target.value)} />
              <button className="btn btn-sm btn-primary" disabled={!newArea.trim()} onClick={() => { run(() => createArea(businessId, newArea, areas.length)); setNewArea(""); }}><Icon name="plus" size={14} /></button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
