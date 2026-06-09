"use client";
import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor, priorityColor, formatMoney } from "@/lib/types";
import type { OrderDetail } from "@/lib/orders";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";
import { addOrderNote } from "@/app/(app)/orders/actions";

export function OrderDrawer({
  detail, stages, areas, agents, onClose,
}: {
  detail: OrderDetail;
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
  onClose: () => void;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const assignee = detail.assignee_id ? agents.find((a) => a.id === detail.assignee_id) : null;
  const curIdx = stages.findIndex((s) => s.id === detail.stage_id);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>{detail.code}</span>
          {detail.stage && <Pill color={detail.stage.color as PillColor} dot>{detail.stage.name}</Pill>}
          <span className="grow" />
          {detail.conversation_id && (
            <Link className="btn btn-sm btn-outline" href={`/chat?c=${detail.conversation_id}`}><Icon name="chat" size={14} />{lang === "es" ? "Abrir chat" : "Open chat"}</Link>
          )}
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="drawer-body">
          {/* customer */}
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} size={36} color="#0E8C82" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name ?? "—"}</div>
              <div className="t-xs muted mono">{detail.contact?.phone}</div>
            </div>
            <Pill color={priorityColor(detail.priority as never)}><Icon name="dot" size={10} />{detail.priority}</Pill>
          </div>

          {/* pipeline */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="dot" size={16} /><h4>{lang === "es" ? "Etapa" : "Stage"}</h4></div>
            <div className="ws-block-body row gap-1" style={{ flexWrap: "wrap" }}>
              {stages.map((s, i) => {
                const stateCls = i < curIdx ? "done" : i === curIdx ? "cur" : "todo";
                const bg = stateCls === "cur" ? "var(--brand)" : stateCls === "done" ? "var(--surface-3)" : "var(--surface)";
                const col = stateCls === "cur" ? "var(--on-brand)" : "var(--text-muted)";
                return (
                  <button key={s.id} disabled={pending} onClick={() => run(() => moveOrderStage(detail.id, s.id))}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 999, border: "1px solid var(--border)", background: bg, color: col, cursor: "pointer" }}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* meta: area + assignee + total */}
          <div className="ws-block">
            <div className="ws-block-body col gap-2">
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <span className="t-sm muted grow">{lang === "es" ? "Área" : "Area"}</span>
                <select className="select select-sm" value={detail.area_id ?? ""} onChange={(e) => run(() => moveOrderArea(detail.id, e.target.value))}>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <span className="t-sm muted grow">{lang === "es" ? "Asignado" : "Assignee"}</span>
                {assignee ? <div className="row gap-2"><Avatar name={assignee.name} initials={deriveInitials(assignee.name)} color={assignee.color} size={22} /><span className="t-sm">{assignee.name}</span></div> : <span className="muted t-sm">—</span>}
              </div>
              <div className="row gap-2"><span className="t-sm muted grow">{lang === "es" ? "Total" : "Total"}</span><span className="mono" style={{ fontWeight: 800 }}>${formatMoney(detail.total)}</span></div>
              <div className="row gap-2"><span className="t-sm muted grow">{lang === "es" ? "Pago" : "Payment"}</span><Pill color={detail.pay_status === "paid" ? "green" : detail.pay_status === "partial" ? "amber" : "slate"} dot>{detail.pay_status}</Pill></div>
            </div>
          </div>

          {/* items */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4>{lang === "es" ? "Artículos" : "Items"}</h4></div>
            <div className="ws-block-body col gap-1">
              {detail.items.length === 0 && <div className="muted t-sm">—</div>}
              {detail.items.map((it) => (
                <div key={it.id} className="row gap-2"><span className="grow truncate">{it.name}</span><span className="t-xs muted mono">×{it.qty}</span><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(it.subtotal)}</span></div>
              ))}
            </div>
          </div>

          {/* notes */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas" : "Notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
            <div className="ws-block-body col gap-2">
              <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
                <textarea className="bare" rows={2} style={{ fontSize: 13, width: "100%" }} placeholder={lang === "es" ? "Agregar nota…" : "Add a note…"} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {note.trim() && <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => { run(() => addOrderNote(detail.id, note)); setNote(""); }}><Icon name="send" size={14} />{lang === "es" ? "Publicar" : "Post"}</button>}
              {detail.notes.map((n) => {
                const au = n.author_id ? agents.find((a) => a.id === n.author_id) : null;
                return (
                  <div className="note" key={n.id}>
                    <Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={26} />
                    <div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au?.name ?? "Agente"}</span><span className="note-time">{date(n.created_at)}</span></div><div className="note-text">{n.body}</div></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* activity */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="clock" size={16} /><h4>{lang === "es" ? "Actividad" : "Activity"}</h4></div>
            <div className="ws-block-body"><div className="timeline">
              {detail.events.length === 0 ? <div className="muted t-sm">—</div> :
                detail.events.map((e) => (
                  <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "plus" ? "plus" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{date(e.created_at)}</div></div></div>
                ))}
            </div></div>
          </div>
        </div>
      </aside>
    </>
  );
}
