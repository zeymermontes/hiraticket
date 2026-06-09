"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor, priorityColor, PRIORITY_LABEL as PRIO } from "@/lib/types";
import type { KanbanOrder } from "@/lib/kanban";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";

export function KanbanBoard({
  orders, stages, areas, agents,
}: {
  orders: KanbanOrder[];
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [group, setGroup] = useState<"status" | "area">("status");
  const [q, setQ] = useState("");
  const [areaF, setAreaF] = useState("");
  const [assigneeF, setAssigneeF] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const columns = group === "status"
    ? stages.map((s) => ({ id: s.id, label: s.name, color: s.color }))
    : areas.map((a) => ({ id: a.id, label: a.name, color: a.color }));

  const pool = orders.filter((o) => {
    if (q && !(o.code + " " + (o.contact?.name ?? "")).toLowerCase().includes(q.toLowerCase())) return false;
    if (areaF && o.area_id !== areaF) return false;
    if (assigneeF && o.assignee_id !== assigneeF) return false;
    return true;
  });
  const colOrders = (colId: string) =>
    pool.filter((o) => (group === "status" ? o.stage_id : o.area_id) === colId);

  function onDrop(colId: string) {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (!id) return;
    start(async () => {
      if (group === "status") await moveOrderStage(id, colId);
      else await moveOrderArea(id, colId);
      router.refresh();
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>Kanban</h1>
        <span className="grow" />
        <span className="t-sm muted" style={{ fontWeight: 600 }}>{lang === "es" ? "Agrupar por" : "Group by"}</span>
        <div className="seg">
          <button className={group === "status" ? "on" : ""} onClick={() => setGroup("status")}><Icon name="kanban" size={14} />{lang === "es" ? "Etapa" : "Stage"}</button>
          <button className={group === "area" ? "on" : ""} onClick={() => setGroup("area")}><Icon name="layers" size={14} />{lang === "es" ? "Área" : "Area"}</button>
        </div>
      </div>

      <div className="toolbar" style={{ paddingBottom: 12 }}>
        <div className="field field-sm" style={{ width: 220 }}>
          <Icon name="search" />
          <input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select select-sm" value={areaF} onChange={(e) => setAreaF(e.target.value)}>
          <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select select-sm" value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)}>
          <option value="">{lang === "es" ? "Todo agente" : "All agents"}</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="board scroll">
        <div className="board-inner">
          {columns.map((col) => {
            const list = colOrders(col.id);
            return (
              <div key={col.id} className={"kcol" + (over === col.id ? " drop" : "")}
                onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={() => onDrop(col.id)}>
                <div className="kcol-head">
                  <span className="ttl">
                    <span className="dot" style={{ width: 9, height: 9, borderRadius: 9, background: `var(--${col.color})`, display: "inline-block", flex: "none" }} />
                    <span className="truncate">{col.label}</span>
                  </span>
                  <span className="badge badge-soft">{list.length}</span>
                  <span className="grow" />
                </div>
                <div className="kcol-list scroll">
                  {list.map((o) => (
                    <div key={o.id} className={"kcard" + (drag === o.id ? " dragging" : "")} draggable
                      onDragStart={() => setDrag(o.id)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                      <div className="row gap-2">
                        <span className="mono t-xs" style={{ fontWeight: 700, color: "var(--text-muted)" }}>{o.code}</span>
                        {o.priority && o.priority !== "normal" && <Pill color={priorityColor(o.priority as never)}><Icon name="flag" size={10} />{PRIO[o.priority]?.[lang] ?? o.priority}</Pill>}
                        <span className="grow" />
                        {o.stage && group === "area" && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}
                        {o.area && group === "status" && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}
                      </div>
                      {o.items?.[0]?.name && <div className="truncate" style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{o.items[0].name}{o.items.length > 1 ? <span className="muted"> +{o.items.length - 1}</span> : null}</div>}
                      <div className="row gap-2" style={{ marginTop: 6 }}>
                        <Avatar name={o.contact?.name} initials={deriveInitials(o.contact?.name ?? "?")} size={20} />
                        <span className="t-xs muted truncate">{o.contact?.name ?? "—"}</span>
                      </div>
                      <div className="kcard-foot">
                        {(() => { const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null; return ag ? <Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} size={20} /> : null; })()}
                        <span className="grow" />
                        <span className="kcard-meta"><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>${o.total.toLocaleString("es-MX")}</span></span>
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && <div className="center" style={{ padding: "20px 0", color: "var(--text-faint)", fontSize: 12 }}>{lang === "es" ? "Vacío" : "Empty"}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
