"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { KanbanOrder } from "@/lib/kanban";
import type { Area, Stage } from "@/lib/business";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";

export function KanbanBoard({
  orders, stages, areas,
}: {
  orders: KanbanOrder[];
  stages: Stage[];
  areas: Area[];
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [group, setGroup] = useState<"status" | "area">("status");
  const [q, setQ] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const columns = group === "status"
    ? stages.map((s) => ({ id: s.id, label: s.name, color: s.color }))
    : areas.map((a) => ({ id: a.id, label: a.name, color: a.color }));

  const pool = orders.filter((o) => {
    if (!q) return true;
    const hay = o.code + " " + (o.contact?.name ?? "");
    return hay.toLowerCase().includes(q.toLowerCase());
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
        <h1>{lang === "es" ? "Tablero" : "Board"}</h1>
        <span className="grow" />
        <span className="t-sm muted" style={{ fontWeight: 600 }}>{lang === "es" ? "Agrupar por" : "Group by"}</span>
        <div className="seg">
          <button className={group === "status" ? "on" : ""} onClick={() => setGroup("status")}><Icon name="dot" size={14} />{lang === "es" ? "Etapa" : "Stage"}</button>
          <button className={group === "area" ? "on" : ""} onClick={() => setGroup("area")}><Icon name="layers" size={14} />{lang === "es" ? "Área" : "Area"}</button>
        </div>
      </div>

      <div className="toolbar" style={{ paddingBottom: 12 }}>
        <div className="field field-sm" style={{ width: 220 }}>
          <Icon name="search" />
          <input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
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
                        <span className="grow" />
                        {o.stage && group === "area" && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}
                        {o.area && group === "status" && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}
                      </div>
                      <div className="row gap-2" style={{ marginTop: 6 }}>
                        <Avatar name={o.contact?.name} initials={deriveInitials(o.contact?.name ?? "?")} size={20} />
                        <span className="t-xs muted truncate">{o.contact?.name ?? "—"}</span>
                      </div>
                      <div className="kcard-foot">
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
