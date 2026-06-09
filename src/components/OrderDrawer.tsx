"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor, priorityColor, formatMoney } from "@/lib/types";
import type { OrderDetail } from "@/lib/orders";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { Thread } from "@/components/chat/ChatScreen";
import type { ConvDetail } from "@/lib/chat";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";
import { addOrderNote, chargeOrder, markPaid, assignOrder } from "@/app/(app)/orders/actions";

const PRIO: Record<string, { es: string; en: string }> = {
  low: { es: "Baja", en: "Low" }, normal: { es: "Normal", en: "Normal" },
  high: { es: "Alta", en: "High" }, urgent: { es: "Urgente", en: "Urgent" },
};

export function OrderDrawer({
  detail, stages, areas, agents, onClose, businessId, convDetail, connected,
}: {
  detail: OrderDetail; stages: Stage[]; areas: Area[]; agents: Agent[]; onClose: () => void;
  businessId: string; convDetail: ConvDetail | null; connected: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [xfer, setXfer] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const assignee = detail.assignee_id ? agents.find((a) => a.id === detail.assignee_id) : null;
  const curIdx = stages.findIndex((s) => s.id === detail.stage_id);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const advance = () => { const next = stages[Math.min(curIdx + 1, stages.length - 1)]; if (next) run(() => moveOrderStage(detail.id, next.id)); };
  const isLast = curIdx >= stages.length - 1;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <span className="t-ic" style={{ width: 40, height: 40, borderRadius: 11, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="orders" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row gap-2"><span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>{detail.code}</span>{detail.stage && <Pill color={detail.stage.color as PillColor} dot>{detail.stage.name}</Pill>}</div>
            <div className="t-sm muted">{lang === "es" ? "Creado" : "Created"} {date(detail.created_at)} · {lang === "es" ? "Actualizado" : "Updated"} {date(detail.updated_at)}</div>
          </div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="drawer-body scroll">
          {/* pipeline */}
          <div>
            <label className="lbl">{lang === "es" ? "Etapa del pedido" : "Order stage"}</label>
            <div className="pipe">
              {stages.map((s, i) => {
                const cls = i < curIdx ? "done" : i === curIdx ? "cur" : "";
                return <button className={"pipe-step " + cls} key={s.id} disabled={pending} onClick={() => run(() => moveOrderStage(detail.id, s.id))}>{s.name}</button>;
              })}
            </div>
          </div>

          {/* customer + linked chat */}
          <div className="ws-block" style={{ padding: 14 }}>
            <div className="row gap-3">
              <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} size={42} color="#0E8C82" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name ?? "—"}</div>
                <div className="row gap-2"><Icon name="whatsapp" size={13} /><span className="mono t-sm muted">{detail.contact?.phone}</span></div>
              </div>
              {detail.area && <Pill color={detail.area.color as PillColor}>{detail.area.name}</Pill>}
            </div>
            {detail.conversation_id && (
              <button className={"btn btn-sm btn-block " + (chatOpen ? "btn-primary" : "btn-outline")} style={{ marginTop: 12 }} onClick={() => setChatOpen((v) => !v)}>
                <Icon name="whatsapp" size={14} />{lang === "es" ? "Abrir conversación" : "Open conversation"}<span className="grow" /><Icon name={chatOpen ? "x" : "arrowr"} size={14} />
              </button>
            )}
          </div>

          {/* meta row */}
          <div className="row gap-3" style={{ flexWrap: "wrap" }}>
            <div className="col gap-1"><label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Agente" : "Agent"}</label>{assignee ? <div className="cust"><Avatar name={assignee.name} initials={deriveInitials(assignee.name)} color={assignee.color} size={24} /><span className="t-sm">{assignee.name}</span></div> : <span className="muted t-sm">—</span>}</div>
            <div className="col gap-1"><label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Prioridad" : "Priority"}</label><Pill color={priorityColor(detail.priority as never)}><Icon name="flag" size={11} />{PRIO[detail.priority]?.[lang] ?? detail.priority}</Pill></div>
          </div>

          {/* line items */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4>{lang === "es" ? "Artículos del pedido" : "Line items"}</h4></div>
            <div style={{ padding: "4px 14px 12px" }}>
              {detail.items.map((li) => (
                <div className="lineitem" key={li.id}>
                  <div className="lineitem-thumb" />
                  <div className="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{li.name}</div><div className="t-xs muted mono">{li.qty} × ${formatMoney(li.unit_price)}</div></div>
                  <span className="mono" style={{ fontWeight: 700 }}>${formatMoney(li.subtotal)}</span>
                </div>
              ))}
              <div className="row" style={{ paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--border)" }}>
                <span className="grow" style={{ fontWeight: 700 }}>{lang === "es" ? "Total" : "Total"}</span>
                <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(detail.total)}</span>
              </div>
            </div>
          </div>

          {/* payment */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Estado de pago" : "Payment"}</h4><Pill color={detail.pay_status === "paid" ? "green" : detail.pay_status === "partial" ? "amber" : "slate"} dot>{detail.pay_status === "paid" ? (lang === "es" ? "Pagado" : "Paid") : detail.pay_status === "partial" ? (lang === "es" ? "Parcial" : "Partial") : (lang === "es" ? "Pendiente" : "Pending")}</Pill></div>
            <div style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-outline grow" disabled={pending || !detail.conversation_id} onClick={() => run(() => chargeOrder(detail.id))}><Icon name="send" size={14} />{lang === "es" ? "Enviar link de pago" : "Send pay link"}</button>
              {detail.pay_status !== "paid" && <button className="btn btn-sm btn-primary grow" disabled={pending} onClick={() => run(() => markPaid(detail.id))}><Icon name="check" size={14} />{lang === "es" ? "Marcar pagado" : "Mark paid"}</button>}
            </div>
          </div>

          {/* notes */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
            <div style={{ padding: "12px 14px" }}>
              <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}><textarea className="bare" rows={2} style={{ fontSize: 13, width: "100%" }} placeholder={lang === "es" ? "Agregar nota…" : "Add a note…"} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              {note.trim() && <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} disabled={pending} onClick={() => { run(() => addOrderNote(detail.id, note)); setNote(""); }}><Icon name="send" size={14} />{lang === "es" ? "Publicar" : "Post"}</button>}
              {detail.notes.length > 0 && <div style={{ marginTop: 10 }}>{detail.notes.map((n) => { const au = n.author_id ? agents.find((a) => a.id === n.author_id) : null; return (<div className="note" key={n.id}><Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={26} /><div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au?.name ?? "Agente"}</span><span className="note-time">{date(n.created_at)}</span></div><div className="note-text">{n.body}</div></div></div>); })}</div>}
            </div>
          </div>

          {/* activity log */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="clock" size={16} /><h4>{lang === "es" ? "Registro de actividad" : "Activity log"}</h4></div>
            <div style={{ padding: "10px 14px" }}><div className="timeline">
              {detail.events.length === 0 ? <div className="muted t-sm">—</div> : detail.events.map((e) => (
                <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "plus" ? "plus" : e.kind === "status" ? "dot" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{date(e.created_at)}</div></div></div>
              ))}
            </div></div>
          </div>
        </div>

        <div className="drawer-foot">
          <span style={{ position: "relative", display: "inline-flex", flex: 1 }}>
            <button className="btn btn-outline btn-block" onClick={() => setXfer((v) => !v)}><Icon name="swap" size={15} />{lang === "es" ? "Transferir" : "Transfer"}</button>
            {xfer && (
              <div className="menu scroll" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 240, maxHeight: 300, zIndex: 50 }}>
                <div className="menu-label">{lang === "es" ? "A un agente" : "To an agent"}</div>
                {agents.filter((a) => a.role !== "viewer").map((a) => <button className="menu-item" key={a.id} onClick={() => { setXfer(false); run(() => assignOrder(detail.id, a.id)); }}><Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={20} />{a.name}</button>)}
                <div className="menu-sep" />
                <div className="menu-label">{lang === "es" ? "A un área" : "To an area"}</div>
                {areas.map((ar) => <button className="menu-item" key={ar.id} onClick={() => { setXfer(false); run(() => moveOrderArea(detail.id, ar.id)); }}><Pill color={ar.color as PillColor}>{ar.name}</Pill></button>)}
              </div>
            )}
          </span>
          {!isLast
            ? <button className="btn btn-primary grow" disabled={pending} onClick={advance}><Icon name="arrowr" size={15} />{lang === "es" ? "Avanzar etapa" : "Advance stage"}</button>
            : <button className="btn btn-dark grow" onClick={onClose}><Icon name="check" size={15} />{lang === "es" ? "Cerrar" : "Close"}</button>}
        </div>
      </aside>
      {chatOpen && convDetail && (
        <>
          <div className="scrim" style={{ zIndex: 95 }} onClick={() => setChatOpen(false)} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 410, maxWidth: "94vw", zIndex: 96, boxShadow: "var(--sh-lg)", display: "flex" }}>
            <Thread detail={convDetail} agents={agents} areas={areas} connected={connected} businessId={businessId} floating />
          </div>
        </>
      )}
    </>
  );
}
