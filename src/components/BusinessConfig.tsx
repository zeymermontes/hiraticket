"use client";
import React, { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { VERTICALS } from "@/lib/verticals";
import { ReorderList } from "@/components/ReorderList";
import {
  createArea, updateArea, deleteArea, createStage, updateStage, deleteStage, reorderStages, updateBusinessProfile, setCustomFields,
} from "@/app/(app)/business/actions";

const COLORS: PillColor[] = ["slate", "blue", "violet", "teal", "green", "amber", "red", "brand"];

function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => setRect(rect ? null : btn.current?.getBoundingClientRect() ?? null);
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={btn} className="iconbtn sm" onClick={toggle} title="Color">
        <span style={{ width: 14, height: 14, borderRadius: 5, background: `var(--${value})`, display: "inline-block" }} />
      </button>
      {rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRect(null)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, zIndex: 201 }}>
            {COLORS.map((c) => (
              <button key={c} onClick={() => { onPick(c); setRect(null); }} style={{ width: 22, height: 22, borderRadius: 6, background: `var(--${c})`, border: c === value ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

export function BusinessConfig({
  businessId, businessName, stages, areas, agents, vertical, objectSingular, customFields,
}: {
  businessId: string;
  businessName: string;
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
  vertical: string | null;
  objectSingular: string;
  customFields: string[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [newStage, setNewStage] = useState("");
  const [newArea, setNewArea] = useState("");
  const [newField, setNewField] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const addStage = () => { if (newStage.trim()) { run(() => createStage(businessId, newStage, stages.length)); setNewStage(""); } };
  const addArea = () => { if (newArea.trim()) { run(() => createArea(businessId, newArea, areas.length)); setNewArea(""); } };


  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Negocio" : "Business"}</h1>
        <Pill color="slate" large>{businessName}</Pill>
        <span className="t-sm muted hide-narrow" style={{ marginLeft: 8 }}>{lang === "es" ? "Configura tu vertical, etapas y áreas" : "Configure your vertical, stages and areas"}</span>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Vertical + object name */}
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="store" size={16} /><h4>{lang === "es" ? "Tipo de negocio" : "Business type"}</h4></div>
          <div className="ws-block-body col gap-3">
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {VERTICALS.map((v) => (
                <button key={v.id} onClick={() => run(() => updateBusinessProfile(businessId, { vertical: v.id, object_singular: v.object[lang] }))}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                    background: vertical === v.id ? "var(--brand-50)" : "var(--surface)", border: "1px solid " + (vertical === v.id ? "var(--brand)" : "var(--border)") }}>
                  <Icon name={v.icon} size={18} /><span style={{ fontWeight: 600, fontSize: 13 }}>{v.name[lang]}</span>
                </button>
              ))}
            </div>
            <div className="row gap-2" style={{ alignItems: "center", maxWidth: 420 }}>
              <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "¿Cómo le llamas al objeto?" : "What do you call the object?"}</label>
              <input className="inp-inline grow" defaultValue={objectSingular} placeholder={lang === "es" ? "Pedido" : "Order"}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== objectSingular) run(() => updateBusinessProfile(businessId, { object_singular: v })); }} />
            </div>
          </div>
        </section>

        {/* Custom fields */}
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="sliders" size={16} /><h4>{lang === "es" ? "Campos personalizados" : "Custom fields"}</h4></div>
          <div className="ws-block-body col gap-2">
            <p className="muted t-sm">{lang === "es" ? "Datos extra que capturas por pedido (ej. Placa, Mascota, Tipo de papel)." : "Extra data captured per order (e.g. Plate, Pet, Paper type)."}</p>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {customFields.length === 0 && <span className="muted t-sm">—</span>}
              {customFields.map((f, i) => (
                <span key={i} className="row gap-1" style={{ alignItems: "center", padding: "4px 6px 4px 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 13 }}>
                  {f}<button className="iconbtn sm" style={{ width: 18, height: 18 }} onClick={() => run(() => setCustomFields(businessId, customFields.filter((_, j) => j !== i)))}><Icon name="x" size={12} /></button>
                </span>
              ))}
            </div>
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nuevo campo…" : "New field…"} value={newField} onChange={(e) => setNewField(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newField.trim()) { run(() => setCustomFields(businessId, [...customFields, newField.trim()])); setNewField(""); } }} />
              <button className="btn btn-sm btn-primary" disabled={!newField.trim()} onClick={() => { run(() => setCustomFields(businessId, [...customFields, newField.trim()])); setNewField(""); }}><Icon name="plus" size={14} />{lang === "es" ? "Agregar campo" : "Add field"}</button>
            </div>
          </div>
        </section>

        {/* Stages */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="dot" size={16} /><h4 className="grow">{lang === "es" ? "Etapas del pedido" : "Order stages"}</h4></div>
          <div className="ws-block-body col gap-2">
            <ReorderList items={stages} getKey={(s) => s.id} className="col gap-2"
              onReorder={(ids) => run(() => reorderStages(businessId, ids))}
              renderItem={(s, handle) => (
                <div className="row gap-2">
                  <span className="ws-grip" {...handle} title={lang === "es" ? "Arrastra para reordenar" : "Drag to reorder"}><Icon name="grip" size={15} /></span>
                  <ColorPicker value={s.color} onPick={(c) => run(() => updateStage(s.id, { color: c }))} />
                  <input className="inp-inline grow" defaultValue={s.name}
                    onBlur={(e) => { if (e.target.value !== s.name) run(() => updateStage(s.id, { name: e.target.value })); }} />
                  <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteStage(s.id))}><Icon name="x" size={15} /></button>
                </div>
              )} />
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva etapa…" : "New stage…"} value={newStage} onChange={(e) => setNewStage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStage(); }} />
              <button className="btn btn-sm btn-primary" disabled={!newStage.trim()} onClick={addStage}><Icon name="plus" size={14} />{lang === "es" ? "Agregar etapa" : "Add stage"}</button>
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
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva área…" : "New area…"} value={newArea} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addArea(); }} />
              <button className="btn btn-sm btn-primary" disabled={!newArea.trim()} onClick={addArea}><Icon name="plus" size={14} />{lang === "es" ? "Agregar área" : "Add area"}</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
