"use client";
import React, { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor, priorityColor, formatMoney, tagColor, isOverdue } from "@/lib/types";
import { TagPicker } from "@/components/TagPicker";
import type { OrderDetail } from "@/lib/orders";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { Thread } from "@/components/chat/ChatScreen";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { ConvDetail } from "@/lib/chat";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";
import { addOrderNote, chargeOrder, markPaid, assignOrder, setOrderPriority, addOrderTag, setItemStage, addPayment, deletePayment, loadOrderDetail, setOrderDue } from "@/app/(app)/orders/actions";
import { removeContactTag } from "@/app/(app)/chat/actions";

const PRIO: Record<string, { es: string; en: string }> = {
  low: { es: "Baja", en: "Low" }, normal: { es: "Normal", en: "Normal" },
  high: { es: "Alta", en: "High" }, urgent: { es: "Urgente", en: "Urgent" },
};

/** ISO → "YYYY-MM-DDTHH:mm" in local time, for a datetime-local input. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function OrderDrawer({
  detail: detailProp, stages, areas, agents, onClose, businessId, convDetail, connected,
}: {
  detail: OrderDetail; stages: Stage[]; areas: Area[]; agents: Agent[]; onClose: () => void;
  businessId: string; convDetail: ConvDetail | null; connected: boolean;
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Keep the detail live: re-seed from the prop, and re-fetch after each mutation so the drawer
  // updates in place (it's often opened from local state — Kanban/chat — that router.refresh
  // doesn't touch).
  const [detail, setDetail] = useState(detailProp);
  useEffect(() => { setDetail(detailProp); }, [detailProp]);
  const [note, setNote] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [xfer, setXfer] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const tagBtn = useRef<HTMLButtonElement>(null);
  const [tagRect, setTagRect] = useState<DOMRect | null>(null);
  const [chatW, setChatW] = useState(380);
  const run = (fn: () => Promise<unknown>) => start(async () => {
    await fn();
    const fresh = await loadOrderDetail(detailProp.id);
    if (fresh) setDetail(fresh);
    router.refresh();
  });
  // Optimistic: reflect the change in the drawer immediately, then run + reconcile in the background.
  const runOpt = (patch: Partial<OrderDetail>, fn: () => Promise<unknown>) => {
    setDetail((c) => (c ? { ...c, ...patch } : c));
    run(fn);
  };

  const DRAWER_W = 560; // width of the order drawer this panel docks against
  useEffect(() => {
    const saved = Number(localStorage.getItem("hira.orderChatW"));
    // Default: fill the space left of the drawer (comfortable, no dead gap); else the saved width.
    if (saved >= 320) setChatW(saved);
    else setChatW(Math.max(440, window.innerWidth - DRAWER_W - 24));
  }, []);
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    // Capture the pointer so dragging keeps working over the chat thread (which scrolls/re-renders).
    try { el.setPointerCapture(e.pointerId); } catch {}
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(320, Math.min(window.innerWidth - (DRAWER_W + 40), (window.innerWidth - DRAWER_W) - ev.clientX));
      setChatW(w);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      try { el.releasePointerCapture(e.pointerId); } catch {}
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  }
  useEffect(() => { try { localStorage.setItem("hira.orderChatW", String(chatW)); } catch {} }, [chatW]);

  const assignee = detail.assignee_id ? agents.find((a) => a.id === detail.assignee_id) : null;
  const curIdx = stages.findIndex((s) => s.id === detail.stage_id);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const advance = () => { const next = stages[Math.min(curIdx + 1, stages.length - 1)]; if (next) runOpt({ stage_id: next.id, stage: { name: next.name, color: next.color } }, () => moveOrderStage(detail.id, next.id)); };
  const isLast = curIdx >= stages.length - 1;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        {pending && <div className="drawer-progress" aria-hidden />}
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
            <label className="lbl">{personal ? (lang === "es" ? "Etapa de la tarea" : "Task stage") : (lang === "es" ? "Etapa del pedido" : "Order stage")}{detail.product_stages && <span className="muted" style={{ fontWeight: 400 }}> · {personal ? (lang === "es" ? "derivada de las subtareas" : "rolled up from subtasks") : (lang === "es" ? "derivada de los productos" : "rolled up from products")}</span>}</label>
            <div className="pipe">
              {stages.map((s, i) => {
                const cls = i < curIdx ? "done" : i === curIdx ? "cur" : "";
                return <button className={"pipe-step " + cls} key={s.id} disabled={pending || detail.product_stages} onClick={() => runOpt({ stage_id: s.id, stage: { name: s.name, color: s.color } }, () => moveOrderStage(detail.id, s.id))}>{s.name}</button>;
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
            <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {(detail.contact?.tags ?? []).map((tg) => <Pill key={tg} color={tagColor(tg)}><Icon name="tag" size={10} />{tg}</Pill>)}
              <button ref={tagBtn} className="btn btn-sm btn-outline" onClick={() => { if (tagBtn.current) setTagRect(tagBtn.current.getBoundingClientRect()); }}><Icon name="tag" size={13} />{lang === "es" ? "Etiqueta" : "Tag"}</button>
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
            <div className="col gap-1"><label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Prioridad" : "Priority"}</label>
              <PriorityPicker value={detail.priority} lang={lang} onChange={(p) => runOpt({ priority: p }, () => setOrderPriority(detail.id, p))} />
            </div>
            <div className="col gap-1" style={{ minWidth: 190 }}>
              <label className="lbl row gap-1" style={{ margin: 0 }}>{lang === "es" ? "Fecha límite" : "Deadline"}{isOverdue(detail.due_at, isLast) && <Pill color="red" dot>{lang === "es" ? "Vencida" : "Overdue"}</Pill>}</label>
              <input type="datetime-local" className="inp-inline" style={{ colorScheme: "light" }} value={toLocalInput(detail.due_at)}
                onChange={(e) => { const v = e.target.value ? new Date(e.target.value).toISOString() : null; runOpt({ due_at: v }, () => setOrderDue(detail.id, v)); }} />
            </div>
          </div>

          {/* line items */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4>{personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Artículos del pedido" : "Line items")}</h4></div>
            <div style={{ padding: "4px 14px 12px" }}>
              {detail.items.map((li) => (
                <div className="lineitem" key={li.id}>
                  <div className="lineitem-thumb" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{li.name}</div>
                    {li.note && <div className="t-xs muted" style={{ marginTop: 1, whiteSpace: "pre-wrap" }}>{li.note}</div>}
                    <div className="row gap-2" style={{ marginTop: 2 }}>
                      {!personal && <span className="t-xs muted mono">{li.qty} × ${formatMoney(li.unit_price)}</span>}
                      {personal && li.qty > 1 && <span className="t-xs muted mono">{li.qty}×</span>}
                      {detail.product_stages && <StageChip itemId={li.id} value={li.stage_id} stages={stages} lang={lang} onChange={(sid) => { const st = stages.find((s) => s.id === sid); runOpt({ items: detail.items.map((it) => (it.id === li.id ? { ...it, stage_id: sid, stage: st ? { name: st.name, color: st.color } : null } : it)) }, () => setItemStage(li.id, sid)); }} />}
                    </div>
                  </div>
                  {!personal && <span className="mono" style={{ fontWeight: 700 }}>${formatMoney(li.subtotal)}</span>}
                </div>
              ))}
              {!personal && (
                <div className="row" style={{ paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--border)" }}>
                  <span className="grow" style={{ fontWeight: 700 }}>{lang === "es" ? "Total" : "Total"}</span>
                  <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(detail.total)}</span>
                </div>
              )}
            </div>
          </div>

          {/* payment */}
          {!personal && (
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Pagos" : "Payments"}</h4><Pill color={detail.pay_status === "paid" ? "green" : detail.pay_status === "partial" ? "amber" : "slate"} dot>{detail.pay_status === "paid" ? (lang === "es" ? "Pagado" : "Paid") : detail.pay_status === "partial" ? (lang === "es" ? "Parcial" : "Partial") : (lang === "es" ? "Pendiente" : "Pending")}</Pill></div>
            <div style={{ padding: "12px 14px" }} className="col gap-2">
              <div className="col gap-1">
                <div className="kv"><span className="k">{lang === "es" ? "Total" : "Total"}</span><span className="v mono">${formatMoney(detail.total)}</span></div>
                <div className="kv"><span className="k">{lang === "es" ? "Pagado" : "Paid"}</span><span className="v mono" style={{ color: "var(--green)" }}>${formatMoney(detail.paid)}</span></div>
                <div className="kv"><span className="k">{lang === "es" ? "Saldo" : "Balance"}</span><span className="v mono" style={{ fontWeight: 800, color: detail.total - detail.paid > 0 ? "var(--amber)" : "var(--text)" }}>${formatMoney(Math.max(0, detail.total - detail.paid))}</span></div>
              </div>

              {detail.payments.length > 0 && (
                <div className="col gap-1" style={{ paddingTop: 2 }}>
                  {detail.payments.map((p) => {
                    const au = p.created_by ? agents.find((a) => a.id === p.created_by) : null;
                    return (
                      <div className="row gap-2" key={p.id} style={{ alignItems: "center", fontSize: 12.5 }}>
                        <span className="mono" style={{ fontWeight: 700 }}>${formatMoney(p.amount)}</span>
                        {p.method && <Pill color="slate">{p.method}</Pill>}
                        <span className="t-xs muted truncate grow">{p.note || (au ? au.name : "")} · {new Date(p.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</span>
                        <button className="iconbtn sm" title={lang === "es" ? "Eliminar pago" : "Delete payment"} onClick={() => run(() => deletePayment(p.id))}><Icon name="x" size={13} /></button>
                      </div>
                    );
                  })}
                </div>
              )}

              {detail.pay_status !== "paid" && (
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <div className="field field-sm field-filled grow"><span className="t-sm muted">$</span><input type="number" min={0} placeholder={lang === "es" ? "Monto del pago" : "Payment amount"} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
                  <button className="btn btn-sm btn-outline" disabled={pending || !(Number(payAmount) > 0)} onClick={() => { run(() => addPayment(detail.id, Number(payAmount))); setPayAmount(""); }}><Icon name="plus" size={14} />{lang === "es" ? "Registrar" : "Add"}</button>
                </div>
              )}

              <div className="row gap-2">
                <button className="btn btn-sm btn-outline grow" disabled={pending || !detail.conversation_id} onClick={() => run(() => chargeOrder(detail.id))}><Icon name="send" size={14} />{lang === "es" ? "Enviar link de pago" : "Send pay link"}</button>
                {detail.pay_status !== "paid" && <button className="btn btn-sm btn-primary grow" disabled={pending} onClick={() => run(() => markPaid(detail.id))}><Icon name="check" size={14} />{lang === "es" ? "Marcar pagado" : "Mark paid"}</button>}
              </div>
            </div>
          </div>
          )}

          {/* notes */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
            <div style={{ padding: "12px 14px" }}>
              <MentionTextarea value={note} onChange={setNote} agents={agents} placeholder={lang === "es" ? "Agregar nota… usa @ para mencionar" : "Add a note… use @ to mention"} />
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
                {agents.filter((a) => a.role !== "viewer").map((a) => <button className="menu-item" key={a.id} onClick={() => { setXfer(false); runOpt({ assignee_id: a.id }, () => assignOrder(detail.id, a.id)); }}><Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={20} />{a.name}</button>)}
                <div className="menu-sep" />
                <div className="menu-label">{lang === "es" ? "A un área" : "To an area"}</div>
                {areas.map((ar) => <button className="menu-item" key={ar.id} onClick={() => { setXfer(false); runOpt({ area_id: ar.id, area: { name: ar.name, color: ar.color } }, () => moveOrderArea(detail.id, ar.id)); }}><Pill color={ar.color as PillColor}>{ar.name}</Pill></button>)}
              </div>
            )}
          </span>
          {!isLast
            ? <button className="btn btn-primary grow" disabled={pending} onClick={advance}><Icon name="arrowr" size={15} />{lang === "es" ? "Avanzar etapa" : "Advance stage"}</button>
            : <button className="btn btn-dark grow" onClick={onClose}><Icon name="check" size={15} />{lang === "es" ? "Cerrar" : "Close"}</button>}
        </div>
      </aside>
      {chatOpen && convDetail && (
        <div style={{ position: "fixed", top: 0, bottom: 0, right: DRAWER_W, width: chatW, maxWidth: `calc(100vw - ${DRAWER_W + 40}px)`, zIndex: 92, boxShadow: "var(--sh-lg)", display: "flex", background: "var(--surface)" }}>
          <div className="order-chat-resizer" onPointerDown={startResize} title={lang === "es" ? "Arrastra para redimensionar" : "Drag to resize"} />
          <Thread detail={convDetail} agents={agents} areas={areas} connected={connected} businessId={businessId} floating />
        </div>
      )}
      {tagRect && (
        <TagPicker businessId={businessId} current={detail.contact?.tags ?? []} rect={tagRect}
          onPick={(t) => runOpt({ contact: detail.contact ? { ...detail.contact, tags: Array.from(new Set([...(detail.contact.tags ?? []), t])) } : detail.contact }, () => addOrderTag(detail.id, t))}
          onRemove={detail.contact ? (t) => runOpt({ contact: { ...detail.contact!, tags: (detail.contact!.tags ?? []).filter((x) => x !== t) } }, () => removeContactTag(detail.contact!.id, t)) : undefined}
          onClose={() => setTagRect(null)} />
      )}
    </>
  );
}

/** Per-product stage chip + popover (used when the business tracks stages per product). */
function StageChip({ value, stages, lang, onChange }: { itemId: string; value: string | null; stages: Stage[]; lang: "es" | "en"; onChange: (stageId: string | null) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = stages.find((s) => s.id === value) ?? null;
  return (
    <>
      <button ref={btn} onClick={() => setRect(rect ? null : btn.current?.getBoundingClientRect() ?? null)}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
        {cur ? <Pill color={cur.color as PillColor} dot>{cur.name}</Pill> : <Pill color="slate">{lang === "es" ? "Sin etapa" : "No stage"}</Pill>}
        <Icon name="chevd" size={12} />
      </button>
      {rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRect(null)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: 180, maxHeight: 280, zIndex: 201 }}>
            {stages.map((s) => (
              <button key={s.id} className={"menu-item" + (s.id === value ? " on" : "")} onClick={() => { setRect(null); onChange(s.id); }}>
                <Pill color={s.color as PillColor} dot>{s.name}</Pill>{s.id === value && <><span className="grow" /><Icon name="check" size={14} /></>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Priority selector that shows the value (and each option) as a correctly-colored chip. */
function PriorityPicker({ value, lang, onChange }: { value: string; lang: "es" | "en"; onChange: (p: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => setRect(rect ? null : btn.current?.getBoundingClientRect() ?? null);
  return (
    <>
      <button ref={btn} className="btn btn-sm btn-outline" style={{ gap: 6 }} onClick={toggle}>
        <Pill color={priorityColor(value as never)}><Icon name="flag" size={11} />{PRIO[value]?.[lang] ?? value}</Pill>
        <Icon name="chevd" size={14} />
      </button>
      {rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRect(null)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: 170, zIndex: 201 }}>
            {(["low", "normal", "high", "urgent"] as const).map((p) => (
              <button key={p} className={"menu-item" + (p === value ? " on" : "")} onClick={() => { setRect(null); if (p !== value) onChange(p); }}>
                <Pill color={priorityColor(p)}><Icon name="flag" size={11} />{PRIO[p][lang]}</Pill>
                {p === value && <><span className="grow" /><Icon name="check" size={14} /></>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
