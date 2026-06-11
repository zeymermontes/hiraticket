"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { type PillColor, priorityColor, PRIORITY_LABEL, tagColor } from "@/lib/types";
import type { ConvDetail, Agent } from "@/lib/chat";
import type { Area, Stage } from "@/lib/business";
import type { OrderDetail } from "@/lib/orders";
import { OrderDrawer } from "@/components/OrderDrawer";
import { loadOrderDetail } from "@/app/(app)/orders/actions";
import { useApp } from "@/components/AppContext";

const money = (n: number) => "$" + (n || 0).toLocaleString("es-MX");

/** Customer 360 — full-screen takeover that replaces the chat columns (prototype's cust360). */
export function CustomerOverlay({ detail, agents, areas, stages, businessId, connected, onClose }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; stages: Stage[]; businessId: string; connected: boolean; onClose: () => void }) {
  const router = useRouter();
  const { personal } = useApp();
  const ORDERS = personal ? "Tareas" : "Pedidos";
  const [tab, setTab] = useState<"orders" | "history" | "notes">("orders");
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const openDrawer = (id: string) => { setLoadingId(id); startLoad(async () => { const d = await loadOrderDetail(id); setOpenOrder(d); setLoadingId(null); }); };
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const c = detail.contact;
  const orders = detail.orders;
  const lifetime = orders.reduce((s, o) => s + (o.total || 0), 0);
  const lastStageId = stages.length ? stages[stages.length - 1].id : null;
  const openCount = orders.filter((o) => o.stage_id !== lastStageId).length;
  const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const dateTime = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const notes = detail.notes.map((n) => ({ ...n, src: "Chat" }));

  return (
    <div className="cust360">
      <div className="cust360-head">
        <button className="btn btn-outline btn-sm" onClick={onClose}><span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon name="arrowr" size={14} /></span>Volver al chat</button>
        <Avatar name={c?.name} initials={deriveInitials(c?.name || c?.phone || "?")} color={avatarColor(c?.phone)} size={44} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2"><span style={{ fontWeight: 800, fontSize: 17 }} className="truncate">{c?.name}</span><span className="pill pill-green" style={{ height: 20 }}><Icon name="whatsapp" size={12} />WhatsApp</span></div>
          <div className="t-sm muted mono">{c?.phone}</div>
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>{(c?.tags ?? []).map((tg) => <Pill key={tg} color={tagColor(tg)}><Icon name="tag" size={11} />{tg}</Pill>)}{detail.area && <Pill color={detail.area.color as PillColor}>{detail.area.name}</Pill>}</div>
      </div>

      <div className="cust360-body scroll">
        <div className="c360-stats">
          {!personal && <div className="c360-stat"><div className="lbl2"><Icon name="orders" size={14} />Total gastado</div><div className="val2 mono">{money(lifetime)}</div></div>}
          <div className="c360-stat"><div className="lbl2"><Icon name="orders" size={14} />{ORDERS}</div><div className="val2">{orders.length}</div></div>
          <div className="c360-stat"><div className="lbl2"><Icon name="clock" size={14} />Abiertos</div><div className="val2">{openCount}</div></div>
          <div className="c360-stat"><div className="lbl2"><Icon name="calendar" size={14} />Primer contacto</div><div className="val2" style={{ fontSize: 18 }}>{date(c?.created_at ?? null)}</div></div>
        </div>

        <div className="seg c360-tabs">
          {([["orders", ORDERS, orders.length], ["history", "Historial", detail.events.length], ["notes", "Notas", notes.length]] as const).map(([id, lbl, n]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{lbl}{n > 0 && <span className="badge badge-soft">{n}</span>}</button>
          ))}
        </div>

        {tab === "orders" && (
          orders.length === 0 ? <div className="empty"><div className="empty-art"><Icon name="orders" /></div><p>{personal ? "Sin tareas." : "Sin pedidos."}</p></div> :
            <div className="c360-orders">
              {orders.map((o) => {
                const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null;
                const curIdx = stages.findIndex((s) => s.id === o.stage_id);
                return (
                  <div className="o360" key={o.id}>
                    <div className="row gap-2"><span className="mono" style={{ fontWeight: 800, fontSize: 14 }}>{o.code}</span><span className="grow" />{o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}</div>
                    <div className="pipe" style={{ marginTop: 2 }}>
                      {stages.map((s, i) => <span key={s.id} className={"pipe-step " + (i < curIdx ? "done" : i === curIdx ? "cur" : "")} style={{ cursor: "default", fontSize: 10 }}>{s.name}</span>)}
                    </div>
                    <div className="o360-items">
                      {o.items.map((li, i) => <div className="o360-item" key={i}><span className="nm truncate">{li.name}</span><span className="t-xs muted mono">×{li.qty}</span>{!personal && <span className="mono" style={{ fontWeight: 700 }}>{money(li.subtotal)}</span>}</div>)}
                    </div>
                    <div className="row gap-2">{o.area && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}<Pill color={priorityColor(o.priority as never)}><Icon name="flag" size={11} />{PRIORITY_LABEL[o.priority]?.es ?? o.priority}</Pill><span className="grow" />{!personal && <span className="mono" style={{ fontWeight: 800 }}>{money(o.total)}</span>}</div>
                    <div className="row gap-2"><span className="t-xs muted grow">Creado {date(o.created_at)} · {date(o.updated_at)}</span>{ag && <Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} size={22} />}<button className="btn btn-sm btn-outline" disabled={loadingId === o.id} onClick={() => openDrawer(o.id)}>{loadingId === o.id ? "…" : "Abrir"}<Icon name="arrowr" size={13} /></button></div>
                  </div>
                );
              })}
            </div>
        )}

        {tab === "history" && (
          <div className="c360-cols">
            <div className="ws-block"><div className="ws-block-head"><Icon name="clock" size={16} /><h4>Historial completo</h4></div>
              <div className="ws-block-body"><div className="timeline">
                {detail.events.length === 0 ? <div className="muted t-sm">Sin actividad.</div> :
                  detail.events.map((e) => <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : e.kind === "plus" ? "plus" : "clock"} size={13} /></div></div><div className="tl-body"><div className="row gap-2"><span>{e.text}</span><span className="pill pill-slate" style={{ height: 18 }}>Chat</span></div><div className="tl-time">{dateTime(e.created_at)}</div></div></div>)}
              </div></div>
            </div>
            <div className="ws-block"><div className="ws-block-head"><Icon name="chat" size={16} /><h4>Conversación</h4></div>
              <div className="ws-block-body"><div className="thread" style={{ padding: 0, background: "transparent", gap: 3 }}>
                {detail.messages.filter((m) => !m.deleted).slice(-6).map((m) => (
                  <div className={"msg " + (m.direction === "out" ? "out" : "in")} key={m.id}><div className="bubble">{m.body || (m.type !== "text" ? "📎 " + m.type : "")}</div></div>
                ))}
              </div></div>
            </div>
          </div>
        )}

        {tab === "notes" && (
          notes.length === 0 ? <div className="empty"><div className="empty-art"><Icon name="edit" /></div><p>Sin notas internas.</p></div> :
            <div style={{ maxWidth: 680 }}>{notes.map((n) => { const au = n.author_id ? agentMap.get(n.author_id) : null; return (
              <div className="note" key={n.id}><Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={30} /><div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au?.name ?? "Agente"}</span><span className="pill pill-slate" style={{ height: 17 }}>{n.src}</span><span className="note-time">{dateTime(n.created_at)}</span></div><div className="note-text">{n.body}</div></div></div>
            ); })}</div>
        )}
      </div>

      {openOrder && (
        <OrderDrawer
          detail={openOrder}
          stages={stages}
          areas={areas}
          agents={agents}
          businessId={businessId}
          convDetail={detail}
          connected={connected}
          onClose={() => { setOpenOrder(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
