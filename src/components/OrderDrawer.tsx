"use client";
import React, { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { menuStyle } from "@/lib/popover";
import { defaultDoneStageName } from "@/lib/doneStage";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useFlowToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { type PillColor, priorityColor, formatMoney, tagColor, isOverdue, payStatusColor, payStatusLabel } from "@/lib/types";
import { TagPicker } from "@/components/TagPicker";
import { CatalogAutocomplete } from "@/components/CatalogAutocomplete";
import type { OrderDetail } from "@/lib/orders";
import { chargeTitle, chargeKindLabel, chargesGap, isLive, CHARGE_KINDS, suggestKind, type Charge } from "@/lib/charges";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import type { Product } from "@/lib/extras";
import { Thread } from "@/components/chat/ChatScreen";
import { MentionTextarea } from "@/components/MentionTextarea";
import type { ConvDetail } from "@/lib/chat";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";
import { addOrderNote, chargeOrder, getPayLink, markPaid, createCharge, sendCharge, voidCharge, getChargeLink, assignOrder, setOrderPriority, addOrderTag, setItemStage, setAllItemStages, addPayment, deletePayment, reviewPaymentProof, loadOrderDetail, setOrderDue, updateOrderItem, addOrderItem, deleteOrderItem, setOrderDeleted, cancelOrder, uncancelOrder, setOrderDoneFrom, addOrderWaste, updateOrderWaste, deleteOrderWaste } from "@/app/(app)/orders/actions";
import { removeContactTag, loadConvDetail } from "@/app/(app)/chat/actions";
import { ShippingModal } from "@/components/ShippingModal";
import { notifyTracking } from "@/app/(app)/shipping/actions";
import { InvoiceModal } from "@/components/InvoiceModal";
import { notifyInvoice } from "@/app/(app)/invoicing/actions";

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
  detail: detailProp, stages, areas, agents, onClose, businessId, convDetail, connected, products = [], shipping, invoicing, doneFromStageId = null, manualMarginPct = 50,
}: {
  detail: OrderDetail; stages: Stage[]; areas: Area[]; agents: Agent[]; onClose: () => void;
  businessId: string; convDetail: ConvDetail | null; connected: boolean; products?: Product[];
  shipping?: string | null; // active shipping plugin id — gates the Envío block entirely
  invoicing?: boolean; // Facturapi active — gates the Factura (CFDI) block entirely
  doneFromStageId?: string | null; // default del negocio (0072) — solo para NOMBRARLO en el dropdown
  manualMarginPct?: number; // % de margen (Ajustes) — para estimar el costo de mermas de catálogo sin costo propio
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const flowToast = useFlowToast();
  const [pending, start] = useTransition();
  const [showCancel, setShowCancel] = useState(false);
  const ask = useConfirm(); // diálogo propio de Hiraticket, no el confirm() del navegador
  // Keep the detail live: re-seed from the prop, and re-fetch after each mutation so the drawer
  // updates in place (it's often opened from local state — Kanban/chat — that router.refresh
  // doesn't touch).
  const [detail, setDetail] = useState(detailProp);
  useEffect(() => { setDetail(detailProp); }, [detailProp]);
  const [note, setNote] = useState("");
  const [noteItem, setNoteItem] = useState(""); // selected subtask for a subtask note ("" → first)
  const [noteFilter, setNoteFilter] = useState<Set<"order" | "subtask">>(new Set()); // empty = all
  const [editItems, setEditItems] = useState(false);
  // Borrador controlado del nombre por línea, para que el autocompletar del catálogo pueda filtrar
  // en vivo mientras se escribe. El campo antes era no-controlado (defaultValue + onBlur) porque no
  // hacía falta releer cada tecla; ahora sí, para saber qué mostrar en el dropdown.
  const [itemDraft, setItemDraft] = useState<Record<string, string>>({});
  const [newItem, setNewItem] = useState({ name: "", qty: "1", price: "" });
  const [payAmount, setPayAmount] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCharge, setShowCharge] = useState(false);
  const [copiedCharge, setCopiedCharge] = useState<string | null>(null);
  const copyChargeLink = async (id: string) => {
    const url = await getChargeLink(id); if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopiedCharge(id); setTimeout(() => setCopiedCharge(null), 1500); } catch {}
  };
  const copyPayLink = async () => { const url = await getPayLink(detail.id); if (!url) return; try { await navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch {} };
  const [xfer, setXfer] = useState(false);
  const [advanceMenu, setAdvanceMenu] = useState(false);
  const [stagePrompt, setStagePrompt] = useState<Stage | null>(null); // pending target stage awaiting the subtask-sync choice
  const [chatOpen, setChatOpen] = useState(false);
  // The order's own conversation. The `convDetail` prop is only usable when it matches this order's
  // conversation (e.g. opened from the chat). Kanban / orders table pass null, so we fetch on demand;
  // otherwise the button would light up but the panel could never render.
  const [fetchedConv, setFetchedConv] = useState<ConvDetail | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const conv: ConvDetail | null =
    fetchedConv && fetchedConv.id === detail.conversation_id ? fetchedConv
    : convDetail && convDetail.id === detail.conversation_id ? convDetail
    : null;
  useEffect(() => { setChatOpen(false); setFetchedConv(null); setConvLoading(false); }, [detail.id]);
  const toggleChat = async () => {
    const next = !chatOpen;
    setChatOpen(next);
    if (next && !conv && detail.conversation_id) {
      setConvLoading(true);
      const d = await loadConvDetail(detail.conversation_id);
      setFetchedConv(d);
      setConvLoading(false);
    }
  };
  const tagBtn = useRef<HTMLButtonElement>(null);
  const [tagRect, setTagRect] = useState<DOMRect | null>(null);
  const [chatW, setChatW] = useState(380);
  const [shipOpen, setShipOpen] = useState(false);
  const [trackSent, setTrackSent] = useState<string | null>(null); // shipment id whose tracking was just WhatsApped
  const [invOpen, setInvOpen] = useState(false);
  const [invSent, setInvSent] = useState<string | null>(null); // invoice id just WhatsApped
  const [wasteItem, setWasteItem] = useState(""); // "" → merma del pedido completo
  const [wasteProductId, setWasteProductId] = useState<string | null>(null); // del catálogo → costo tomado de ahí; null = genérico
  const [wasteName, setWasteName] = useState("");
  const [wasteQty, setWasteQty] = useState("1");
  const [wasteCost, setWasteCost] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [wasteErr, setWasteErr] = useState<string | null>(null);
  const [editWaste, setEditWaste] = useState(false);
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
  const isLast = curIdx >= stages.length - 1;
  // When the order's items carry their own stage, moving the order stage prompts whether to drag
  // the items along (sync) or leave them as they are.
  const hasItemStages = detail.product_stages && detail.items.length > 0;
  // 0075: llegó a la etapa de "confirmar pago" y ningún flujo ya decidió el pago por su cuenta —
  // pregunta al que acaba de mover el pedido, sin importar por cuál de las dos rutas (con o sin
  // sincronizar subtareas) haya llegado ahí.
  const confirmMarkPaid = async () => {
    const yes = await ask({
      icon: "check",
      title: lang === "es" ? "¿Marcar como pagado?" : "Mark as paid?",
      message: lang === "es" ? "El pedido llegó a la etapa de confirmar pago." : "The order reached the confirm-payment stage.",
      confirmLabel: lang === "es" ? "Marcar pagado" : "Mark paid",
      cancelLabel: lang === "es" ? "No" : "No",
    });
    if (yes) await markPaid(detail.id);
  };
  const moveOrderTo = (s: Stage) => runOpt({ stage_id: s.id, stage: { name: s.name, color: s.color } }, async () => {
    const r = await moveOrderStage(detail.id, s.id);
    flowToast(r.flows, lang);
    if (r.confirmPayment) await confirmMarkPaid();
  });
  const goToStage = (s: Stage | undefined) => {
    if (!s || s.id === detail.stage_id) return;
    if (hasItemStages) setStagePrompt(s);
    else moveOrderTo(s);
  };
  // Resolve the subtask-sync choice: sync = move every item to the target too; keep = order only.
  const applyStage = (s: Stage, sync: boolean) => {
    setStagePrompt(null);
    if (sync) runOpt({ stage_id: s.id, stage: { name: s.name, color: s.color }, items: detail.items.map((it) => ({ ...it, stage_id: s.id, stage: { name: s.name, color: s.color } })) }, async () => {
      const r = await setAllItemStages(detail.id, s.id);
      if (r.confirmPayment) await confirmMarkPaid();
    });
    else moveOrderTo(s);
  };
  const advance = () => goToStage(stages[Math.min(curIdx + 1, stages.length - 1)]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        {pending && <div className="drawer-progress" aria-hidden />}
        <div className="drawer-head">
          <span className="t-ic" style={{ width: 40, height: 40, borderRadius: 11, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="orders" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row gap-2">
              <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>{detail.code}</span>
              {/* Cancelado desplaza a la etapa: es el estado que importa leer primero. */}
              {detail.cancelled_at
                ? <Pill color="red" dot title={detail.cancelled_reason ?? undefined}>{personal ? (lang === "es" ? "Cancelada" : "Cancelled") : (lang === "es" ? "Cancelado" : "Cancelled")}</Pill>
                : detail.stage && <Pill color={detail.stage.color as PillColor} dot>{detail.stage.name}</Pill>}
            </div>
            <div className="t-sm muted">{lang === "es" ? "Creado" : "Created"} {date(detail.created_at)} · {lang === "es" ? "Actualizado" : "Updated"} {date(detail.updated_at)}</div>
          </div>
          {detail.cancelled_at ? (
            <button className="iconbtn" title={lang === "es" ? "Reactivar" : "Reactivate"} disabled={pending}
              onClick={() => start(async () => { await uncancelOrder(detail.id); router.refresh(); })}><Icon name="refresh" /></button>
          ) : (
            <button className="iconbtn" title={personal ? (lang === "es" ? "Cancelar tarea" : "Cancel task") : (lang === "es" ? "Cancelar pedido" : "Cancel order")} style={{ color: "var(--amber)" }} disabled={pending}
              onClick={() => setShowCancel(true)}><Icon name="ban" /></button>
          )}
          <button className="iconbtn" title={personal ? (lang === "es" ? "Eliminar tarea" : "Delete task") : (lang === "es" ? "Eliminar pedido" : "Delete order")} style={{ color: "var(--red)" }} disabled={pending}
            onClick={async () => {
              const ok = await ask({
                icon: "trash", danger: true,
                title: personal ? (lang === "es" ? "Eliminar tarea" : "Delete task") : (lang === "es" ? "Eliminar pedido" : "Delete order"),
                message: personal
                  ? (lang === "es" ? "Se moverá a la papelera y se puede recuperar." : "It moves to the trash and can be restored.")
                  : (lang === "es" ? "Se moverá a la papelera y se puede recuperar." : "It moves to the trash and can be restored."),
                confirmLabel: lang === "es" ? "Eliminar" : "Delete",
                cancelLabel: lang === "es" ? "Volver" : "Back",
              });
              if (!ok) return;
              start(async () => { await setOrderDeleted(detail.id, true); onClose(); router.refresh(); });
            }}><Icon name="trash" /></button>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="drawer-body scroll">
          {/* pipeline */}
          <div>
            <label className="lbl">{personal ? (lang === "es" ? "Etapa de la tarea" : "Task stage") : (lang === "es" ? "Etapa del pedido" : "Order stage")}{detail.product_stages && <span className="muted" style={{ fontWeight: 400 }}> · {personal ? (lang === "es" ? "derivada de las subtareas" : "rolled up from subtasks") : (lang === "es" ? "derivada de los productos" : "rolled up from products")}</span>}</label>
            <div className="pipe">
              {stages.map((s, i) => {
                const cls = i < curIdx ? "done" : i === curIdx ? "cur" : "";
                return <button className={"pipe-step " + cls} key={s.id} disabled={pending} title={lang === "es" ? "Ir a " + s.name : "Go to " + s.name} onClick={() => goToStage(s)}>{s.name}</button>;
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
              <button className={"btn btn-sm btn-block " + (chatOpen ? "btn-primary" : "btn-outline")} style={{ marginTop: 12 }} onClick={toggleChat}>
                <Icon name="whatsapp" size={14} />{lang === "es" ? "Abrir conversación" : "Open conversation"}<span className="grow" />{convLoading ? <span className="t-xs">…</span> : <Icon name={chatOpen ? "x" : "arrowr"} size={14} />}
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
            {/* Solo con fecha límite: sin ella, el pedido no vive en la agenda y el umbral no
                decide nada. "Por defecto" = el del negocio (Ajustes); elegir una etapa aquí
                sobreescribe SOLO este pedido. */}
            {detail.due_at && (
              <div className="col gap-1" style={{ minWidth: 190 }}>
                <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Sale de la agenda en" : "Leaves the agenda at"}</label>
                <select className="inp-inline" value={detail.done_from_stage_id ?? ""}
                  onChange={(e) => { const v = e.target.value || null; runOpt({ done_from_stage_id: v }, () => setOrderDoneFrom(detail.id, v)); }}>
                  <option value="">{(() => { const n = defaultDoneStageName(stages, doneFromStageId); return lang === "es" ? `Por defecto del negocio${n ? ` (${n})` : ""}` : `Business default${n ? ` (${n})` : ""}`; })()}</option>
                  {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* line items */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Artículos del pedido" : "Line items")}</h4>
              {!personal && detail.requires_invoice && <Pill color="violet"><Icon name="file" size={11} />{lang === "es" ? "Factura" : "Invoice"}</Pill>}
              <button className={"btn btn-sm " + (editItems ? "btn-primary" : "btn-outline")} onClick={() => setEditItems((v) => !v)}><Icon name={editItems ? "check" : "edit"} size={13} />{editItems ? (lang === "es" ? "Listo" : "Done") : (lang === "es" ? "Editar" : "Edit")}</button>
            </div>
            <div style={{ padding: "4px 14px 12px" }}>
              {detail.items.map((li) => (editItems ? (
                <div className="row gap-2" key={li.id} style={{ alignItems: "center", padding: "5px 0" }}>
                  <CatalogAutocomplete className="inp-inline grow" products={products} personal={personal} lang={lang}
                    value={itemDraft[li.id] ?? li.name}
                    placeholder={personal ? (lang === "es" ? "Subtarea" : "Subtask") : (lang === "es" ? "Producto" : "Product")}
                    onChange={(v) => setItemDraft((d) => ({ ...d, [li.id]: v }))}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value !== li.name) run(() => updateOrderItem(li.id, { name: e.target.value })); }}
                    onPick={(p) => { setItemDraft((d) => ({ ...d, [li.id]: p.name })); runOpt({ items: detail.items.map((it) => (it.id === li.id ? { ...it, name: p.name, unit_price: p.price, subtotal: (it.qty || 1) * p.price } : it)) }, () => updateOrderItem(li.id, { name: p.name, unit_price: p.price })); }} />
                  <input key={"q" + li.qty} className="inp-inline" style={{ width: 48 }} defaultValue={String(li.qty)} title={lang === "es" ? "Cantidad" : "Qty"} onBlur={(e) => { const q = Number(e.target.value) || 1; if (q !== li.qty) runOpt({ items: detail.items.map((it) => (it.id === li.id ? { ...it, qty: q, subtotal: q * it.unit_price } : it)) }, () => updateOrderItem(li.id, { qty: q })); }} />
                  {!personal && <input key={"p" + li.unit_price} className="inp-inline" style={{ width: 80 }} defaultValue={String(li.unit_price)} title={lang === "es" ? "Precio unit." : "Unit price"} placeholder="$" onBlur={(e) => { const p = Number(e.target.value) || 0; if (p !== li.unit_price) runOpt({ items: detail.items.map((it) => (it.id === li.id ? { ...it, unit_price: p, subtotal: it.qty * p } : it)) }, () => updateOrderItem(li.id, { unit_price: p })); }} />}
                  <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} style={{ color: "var(--red)" }} onClick={() => runOpt({ items: detail.items.filter((it) => it.id !== li.id) }, () => deleteOrderItem(li.id))}><Icon name="trash" size={14} /></button>
                </div>
              ) : (
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
              )))}
              {editItems && (
                <div className="row gap-2" style={{ alignItems: "center", paddingTop: 8, marginTop: 4, borderTop: "1px dashed var(--border)" }}>
                  <CatalogAutocomplete className="inp-inline grow" products={products} personal={personal} lang={lang}
                    value={newItem.name}
                    placeholder={personal ? (lang === "es" ? "Nueva subtarea" : "New subtask") : (lang === "es" ? "Nuevo producto" : "New product")}
                    onChange={(v) => setNewItem((n) => ({ ...n, name: v }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && newItem.name.trim()) { run(() => addOrderItem(detail.id, { name: newItem.name, qty: Number(newItem.qty) || 1, price: Number(newItem.price) || 0, stageId: detail.stage_id })); setNewItem({ name: "", qty: "1", price: "" }); } }}
                    onPick={(p) => setNewItem((n) => ({ ...n, name: p.name, price: personal ? n.price : String(p.price) }))} />
                  <input className="inp-inline" style={{ width: 48 }} value={newItem.qty} onChange={(e) => setNewItem((n) => ({ ...n, qty: e.target.value }))} title={lang === "es" ? "Cantidad" : "Qty"} />
                  {!personal && <input className="inp-inline" style={{ width: 80 }} value={newItem.price} onChange={(e) => setNewItem((n) => ({ ...n, price: e.target.value }))} placeholder="$" />}
                  <button className="iconbtn sm" disabled={!newItem.name.trim()} title={lang === "es" ? "Agregar" : "Add"} onClick={() => { run(() => addOrderItem(detail.id, { name: newItem.name, qty: Number(newItem.qty) || 1, price: Number(newItem.price) || 0, stageId: detail.stage_id })); setNewItem({ name: "", qty: "1", price: "" }); }}><Icon name="plus" size={15} /></button>
                </div>
              )}
              {!personal && (() => {
                // Live preview while editing: sum the current lines plus the not-yet-added draft row,
                // so the total tracks every keystroke instead of waiting for the server refetch.
                // Orders that require an invoice carry their frozen IVA rate — show the breakdown.
                const draft = editItems ? (Number(newItem.qty) || 0) * (Number(newItem.price) || 0) : 0;
                const base = detail.items.reduce((s, it) => s + it.subtotal, 0) + draft;
                const rate = detail.requires_invoice ? Number(detail.tax_rate ?? 0) : 0;
                const disc = Math.min(base, Number(detail.discount ?? 0));
                const tax = editItems || rate === 0 ? Math.round((base - disc) * (rate / 100) * 100) / 100 : Math.max(0, detail.total - (base - disc));
                const liveTotal = editItems ? Math.round((base - disc + tax) * 100) / 100 : detail.total;
                return (
                  <div className="col gap-1" style={{ paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--border)" }}>
                    {(rate > 0 || disc > 0) && (
                      <div className="row"><span className="grow t-sm muted">Subtotal</span><span className="mono t-sm">${formatMoney(base)}</span></div>
                    )}
                    {disc > 0 && (
                      <div className="row" title={detail.discount_note ?? undefined}>
                        <span className="grow t-sm" style={{ color: "var(--green)" }}>{lang === "es" ? "Descuento" : "Discount"}{detail.discount_pct != null ? ` ${Number(detail.discount_pct)}%` : ""}{detail.discount_note ? ` — ${detail.discount_note}` : ""}</span>
                        <span className="mono t-sm" style={{ color: "var(--green)" }}>−${formatMoney(disc)}</span>
                      </div>
                    )}
                    {rate > 0 && (
                      <div className="row"><span className="grow t-sm muted">IVA {rate}%</span><span className="mono t-sm">${formatMoney(tax)}</span></div>
                    )}
                    <div className="row">
                      <span className="grow" style={{ fontWeight: 700 }}>{lang === "es" ? "Total" : "Total"}</span>
                      <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(liveTotal)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* payment */}
          {!personal && (
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Pagos" : "Payments"}</h4>{detail.proofs.some((p) => p.status === "pending") && <Pill color="violet" dot><Icon name="clock" size={11} />{lang === "es" ? "En revisión" : "In review"}</Pill>}<Pill color={payStatusColor(detail.pay_status)} dot>{payStatusLabel(detail.pay_status, lang)}</Pill></div>
            <div style={{ padding: "12px 14px" }} className="col gap-2">
              <div className="col gap-1">
                <div className="kv"><span className="k">{lang === "es" ? "Total" : "Total"}</span><span className="v mono">${formatMoney(detail.total)}</span></div>
                <div className="kv"><span className="k">{lang === "es" ? "Pagado" : "Paid"}</span><span className="v mono" style={{ color: "var(--green)" }}>${formatMoney(detail.paid)}</span></div>
                <div className="kv"><span className="k">{lang === "es" ? "Saldo" : "Balance"}</span><span className="v mono" style={{ fontWeight: 800, color: detail.total - detail.paid > 0 ? "var(--amber)" : "var(--text)" }}>${formatMoney(Math.max(0, detail.total - detail.paid))}</span></div>
              </div>

              <ChargeList
                detail={detail} lang={lang} pending={pending}
                copied={copiedCharge} onCopy={copyChargeLink}
                onSend={(id) => run(() => sendCharge(id).then(() => {}))}
                onVoid={async (c) => {
                  if (!(await ask({
                    icon: "ban", danger: true,
                    title: lang === "es" ? "Anular cobro" : "Void charge",
                    message: lang === "es"
                      ? `Se anula ${chargeTitle(c, "es")} por $${formatMoney(c.amount)}. Su link deja de cobrar, y si ya se lo mandaste al cliente le va a dejar de funcionar.`
                      : `This voids ${chargeTitle(c, "en")} for $${formatMoney(c.amount)}. Its link stops charging — if the customer already has it, it will stop working.`,
                    confirmLabel: lang === "es" ? "Anular" : "Void",
                  }))) return;
                  run(() => voidCharge(c.id).then(() => {}));
                }}
                onSettle={(c) => run(() => addPayment(detail.id, Math.max(0, c.amount - c.paid), "manual", chargeTitle(c, lang), c.id))}
              />

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

              {detail.proofs.length > 0 && (
                <div className="col gap-2" style={{ paddingTop: 4, borderTop: "1px solid var(--border)" }}>
                  <div className="t-xs muted" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{lang === "es" ? "Comprobantes de transferencia" : "Transfer receipts"}</div>
                  {detail.proofs.map((pf) => {
                    const isImg = (pf.image_mime ?? "").startsWith("image/");
                    return (
                      <div key={pf.id} className="row gap-2" style={{ alignItems: "flex-start", padding: "8px", borderRadius: 10, border: "1px solid var(--border)", background: pf.status === "pending" ? "var(--brand-50)" : "var(--surface)" }}>
                        <a href={pf.image_url} target="_blank" rel="noreferrer" style={{ flex: "none" }}>
                          {isImg
                            ? <img src={pf.image_url} alt="comprobante" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                            : <span style={{ width: 52, height: 52, borderRadius: 8, border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--surface-2)" }}><Icon name="file" size={20} /></span>}
                        </a>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="row gap-1" style={{ alignItems: "center", flexWrap: "wrap" }}>
                            {pf.amount != null && <span className="mono" style={{ fontWeight: 700 }}>${formatMoney(pf.amount)}</span>}
                            <Pill color={pf.status === "approved" ? "green" : pf.status === "rejected" ? "red" : "violet"} dot>{pf.status === "approved" ? (lang === "es" ? "Aprobado" : "Approved") : pf.status === "rejected" ? (lang === "es" ? "Rechazado" : "Rejected") : (lang === "es" ? "Por revisar" : "To review")}</Pill>
                          </div>
                          {pf.payer_note && <div className="t-xs muted truncate">{pf.payer_note}</div>}
                          <div className="t-xs muted">{(pf.account_ref ? pf.account_ref + " · " : "") + new Date(pf.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                          {pf.status === "pending" && (
                            <div className="row gap-2" style={{ marginTop: 6 }}>
                              <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => reviewPaymentProof(pf.id, "approved"))}><Icon name="check" size={13} />{lang === "es" ? "Aprobar" : "Approve"}</button>
                              <button className="btn btn-sm btn-outline" disabled={pending} onClick={() => run(() => reviewPaymentProof(pf.id, "rejected"))}><Icon name="x" size={13} />{lang === "es" ? "Rechazar" : "Reject"}</button>
                            </div>
                          )}
                        </div>
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

              {/* "Enviar link de pago" cobra el saldo ENTERO; "Crear cobro" fija el monto. Van juntos
                  y en ese orden porque el primero sigue siendo lo normal en un pedido de un pago. */}
              <div className="row gap-2">
                <button className="btn btn-sm btn-outline grow" disabled={pending || !detail.conversation_id} onClick={() => run(() => chargeOrder(detail.id))}><Icon name="send" size={14} />{lang === "es" ? "Enviar link de pago" : "Send pay link"}</button>
                <button className="btn btn-sm btn-outline" onClick={copyPayLink} title={lang === "es" ? "Copiar link de pago" : "Copy pay link"}><Icon name={linkCopied ? "check" : "file"} size={14} />{linkCopied ? (lang === "es" ? "Copiado" : "Copied") : (lang === "es" ? "Copiar link" : "Copy link")}</button>
              </div>
              {detail.pay_status !== "paid" && (
                <button className="btn btn-sm btn-outline" style={{ width: "100%", justifyContent: "center" }} disabled={pending} onClick={() => setShowCharge(true)}>
                  <Icon name="plus" size={14} />{lang === "es" ? "Crear cobro (anticipo, parcialidad…)" : "Create charge (deposit, installment…)"}
                </button>
              )}
              {detail.pay_status !== "paid" && (
                <button className="btn btn-sm btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={pending}
                  onClick={async () => {
                    // Con cobros pendientes, "marcar pagado" los cierra TODOS de un golpe. Eso está
                    // bien cuando es lo que quieres y es una sorpresa fea cuando no, así que aquí
                    // —- y solo aquí —- se pregunta. Un pedido de un solo pago sigue siendo un clic.
                    const open = detail.charges.filter((c) => isLive(c) && c.status !== "paid");
                    if (open.length && !(await ask({
                      icon: "check",
                      title: lang === "es" ? "Marcar todo el pedido como pagado" : "Mark the whole order as paid",
                      message: lang === "es"
                        ? `Hay ${open.length} ${open.length === 1 ? "cobro pendiente" : "cobros pendientes"} por $${formatMoney(open.reduce((t, c) => t + (c.amount - c.paid), 0))}. Se registrará el saldo completo como pagado y esos cobros se darán por cerrados.`
                        : `There ${open.length === 1 ? "is 1 pending charge" : `are ${open.length} pending charges`} for $${formatMoney(open.reduce((t, c) => t + (c.amount - c.paid), 0))}. The full balance will be recorded as paid and those charges will be closed.`,
                      confirmLabel: lang === "es" ? "Marcar pagado" : "Mark paid",
                    }))) return;
                    run(() => markPaid(detail.id));
                  }}><Icon name="check" size={14} />{lang === "es" ? "Marcar pagado" : "Mark paid"}</button>
              )}
            </div>
          </div>
          )}

          {/* shipping — only when the business has an active shipping plugin */}
          {!personal && shipping && (
            <div className="ws-block">
              <div className="ws-block-head"><Icon name="send" size={16} /><h4 className="grow">{lang === "es" ? "Envío" : "Shipping"}</h4>{detail.shipments.length > 0 && <Pill color="green" dot>{detail.shipments.length === 1 ? (lang === "es" ? "Guía generada" : "Label created") : `${detail.shipments.length} ${lang === "es" ? "guías" : "labels"}`}</Pill>}</div>
              <div style={{ padding: "12px 14px" }} className="col gap-2">
                {detail.shipments.map((s) => (
                  <div key={s.id} className="col gap-1" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{s.carrier || "Paquetería"}</span>
                      {s.service && <span className="t-xs muted">{s.service}</span>}
                      <span className="grow" />
                      {s.cost != null && s.cost > 0 && <span className="mono t-sm">${formatMoney(s.cost)}</span>}
                    </div>
                    {s.tracking_number && (
                      <div className="row gap-2" style={{ alignItems: "center" }}>
                        <span className="mono t-sm" style={{ fontWeight: 700 }}>{s.tracking_number}</span>
                        <button className="iconbtn sm" title={lang === "es" ? "Copiar rastreo" : "Copy tracking"} onClick={() => { try { navigator.clipboard.writeText(s.tracking_number!); } catch {} }}><Icon name="file" size={13} /></button>
                      </div>
                    )}
                    <div className="row gap-2" style={{ marginTop: 2 }}>
                      {s.label_url && <a className="btn btn-sm btn-outline" href={s.label_url} target="_blank" rel="noreferrer"><Icon name="download" size={13} />{lang === "es" ? "Etiqueta" : "Label"}</a>}
                      {detail.conversation_id && (
                        <button className="btn btn-sm btn-outline" disabled={pending || trackSent === s.id}
                          onClick={() => start(async () => { const r = await notifyTracking(detail.id, s.id); if (r.ok) setTrackSent(s.id); })}>
                          <Icon name="whatsapp" size={13} />{trackSent === s.id ? (lang === "es" ? "Enviado ✓" : "Sent ✓") : (lang === "es" ? "Enviar rastreo" : "Send tracking")}
                        </button>
                      )}
                      <span className="grow" />
                      <span className="t-xs muted">{new Date(s.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</span>
                    </div>
                  </div>
                ))}
                <button className="btn btn-sm btn-outline" onClick={() => setShipOpen(true)}>
                  <Icon name="plus" size={14} />{detail.shipments.length ? (lang === "es" ? "Nueva guía" : "New label") : (lang === "es" ? "Generar guía de envío" : "Create shipping label")}
                </button>
              </div>
            </div>
          )}

          {/* CFDI invoicing — only when Facturapi is active */}
          {!personal && invoicing && (
            <div className="ws-block">
              <div className="ws-block-head"><Icon name="file" size={16} /><h4 className="grow">{lang === "es" ? "Factura (CFDI)" : "Invoice (CFDI)"}</h4>
                {detail.requires_invoice && detail.invoices.length === 0 && <Pill color="amber" dot>{lang === "es" ? "Pendiente" : "Pending"}</Pill>}
                {detail.invoices.length > 0 && <Pill color="green" dot>{lang === "es" ? "Emitida" : "Issued"}</Pill>}
              </div>
              <div style={{ padding: "12px 14px" }} className="col gap-2">
                {detail.invoices.map((inv) => (
                  <div key={inv.id} className="col gap-1" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <span className="mono t-xs truncate" style={{ fontWeight: 700, maxWidth: 220 }} title={inv.uuid ?? undefined}>{inv.uuid ?? "—"}</span>
                      <span className="grow" />
                      {inv.total != null && <span className="mono t-sm">${formatMoney(inv.total)}</span>}
                    </div>
                    <div className="row gap-2" style={{ marginTop: 2 }}>
                      {inv.pdf_url && <a className="btn btn-sm btn-outline" href={inv.pdf_url} target="_blank" rel="noreferrer"><Icon name="download" size={13} />PDF</a>}
                      {detail.conversation_id && (
                        <button className="btn btn-sm btn-outline" disabled={pending || invSent === inv.id}
                          onClick={() => start(async () => { const r = await notifyInvoice(detail.id, inv.id); if (r.ok) setInvSent(inv.id); })}>
                          <Icon name="whatsapp" size={13} />{invSent === inv.id ? (lang === "es" ? "Enviada ✓" : "Sent ✓") : (lang === "es" ? "Enviar factura" : "Send invoice")}
                        </button>
                      )}
                      <span className="grow" />
                      <span className="t-xs muted">{new Date(inv.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</span>
                    </div>
                  </div>
                ))}
                {detail.invoices.length === 0 && (
                  <button className="btn btn-sm btn-outline" onClick={() => setInvOpen(true)}>
                    <Icon name="plus" size={14} />{lang === "es" ? "Emitir factura" : "Issue invoice"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* notes */}
          {(() => {
            const subLabel = personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Artículos" : "Items");
            const subNoteLabel = personal ? (lang === "es" ? "Nota de subtarea" : "Subtask note") : (lang === "es" ? "Nota de producto" : "Product note");
            const ordLabel = personal ? (lang === "es" ? "Tarea" : "Task") : (lang === "es" ? "Pedido" : "Order");
            const noteTitle = (id: string | null) => id ? (detail.items.find((it) => it.id === id)?.name ?? (personal ? (lang === "es" ? "Subtarea" : "Subtask") : (lang === "es" ? "Artículo" : "Item"))) : ordLabel;
            const showOrder = noteFilter.size === 0 || noteFilter.has("order");
            const showSub = noteFilter.size === 0 || noteFilter.has("subtask");
            const visible = detail.notes.filter((n) => (n.item_id ? showSub : showOrder));
            const toggle = (k: "order" | "subtask") => setNoteFilter((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
            const postNote = (itemId: string | null) => { if (!note.trim()) return; run(() => addOrderNote(detail.id, note, itemId)); setNote(""); };
            return (
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
            <div style={{ padding: "12px 14px" }}>
              <MentionTextarea value={note} onChange={setNote} agents={agents} placeholder={lang === "es" ? "Agregar nota… usa @ para mencionar" : "Add a note… use @ to mention"} />
              {note.trim() && (
                <div className="row gap-2" style={{ marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {detail.items.length > 0 && (
                    <>
                      <select className="inp-inline" style={{ maxWidth: 180 }} value={noteItem} onChange={(e) => setNoteItem(e.target.value)}>
                        {detail.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                      <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => postNote(noteItem || detail.items[0]?.id || null)}><Icon name="send" size={14} />{subNoteLabel}</button>
                    </>
                  )}
                  <button className="btn btn-sm" style={{ background: "var(--amber)", color: "#fff" }} disabled={pending} onClick={() => postNote(null)}><Icon name="send" size={14} />{lang === "es" ? "Nota de orden" : "Order note"}</button>
                </div>
              )}
              {detail.notes.length > 0 && (
                <div className="chip-row" style={{ marginTop: 12 }}>
                  <button className={"chip" + (noteFilter.size === 0 ? " on" : "")} onClick={() => setNoteFilter(new Set())}>{lang === "es" ? "Todas" : "All"}</button>
                  <button className={"chip" + (noteFilter.has("order") ? " on" : "")} onClick={() => toggle("order")}>{ordLabel}</button>
                  <button className={"chip" + (noteFilter.has("subtask") ? " on" : "")} onClick={() => toggle("subtask")}>{subLabel}</button>
                </div>
              )}
              {visible.length > 0 && <div style={{ marginTop: 10 }}>{visible.map((n) => { const au = n.author_id ? agents.find((a) => a.id === n.author_id) : null; return (<div className="note" key={n.id}><Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={26} /><div className={"note-body " + (n.item_id ? "note-subtask" : "note-order")}><div className="note-head"><Pill color={n.item_id ? "brand" : "amber"} dot>{noteTitle(n.item_id)}</Pill><span className="grow" /><span className="note-time">{date(n.created_at)}</span></div><div className="note-head" style={{ marginTop: 2 }}><span className="note-author">{au?.name ?? "Agente"}</span></div><div className="note-text">{n.body}</div></div></div>); })}</div>}
            </div>
          </div>
            );
          })()}

          {/* mermas (0074) — reimpresiones, errores de producción, cancelaciones parciales.
              Interno: nunca se manda al cliente ni afecta total/subtotal del pedido. */}
          {!personal && (() => {
            const wasteTotal = detail.waste.reduce((s, w) => s + w.cost, 0);
            // Estimación de costo compartida por los dos selectores: si hay costo de catálogo
            // (directo, o por nombre para el producto DEL PEDIDO, que no trae su propio costo) se
            // usa ese; si no, el % de margen de Ajustes aplicado al precio — igual que en reportes.
            const norm = (s: string) => s.trim().toLowerCase();
            const costByName = new Map(products.filter((p) => p.cost != null).map((p) => [norm(p.name), p.cost as number]));
            const estimateCost = (name: string, price: number) => {
              const known = costByName.get(norm(name));
              const cost = known ?? price * (1 - manualMarginPct / 100);
              return Math.round(cost * 100) / 100;
            };
            const pickWasteItem = (id: string) => {
              setWasteItem(id);
              const it = detail.items.find((x) => x.id === id);
              if (it) { setWasteName(it.name); setWasteProductId(null); setWasteCost(String(estimateCost(it.name, it.unit_price))); }
            };
            const pickWasteProduct = (p: Product) => {
              setWasteProductId(p.id); setWasteName(p.name);
              setWasteCost(String(p.cost != null ? p.cost : estimateCost(p.name, p.price)));
            };
            const addWaste = () => {
              if (!wasteName.trim()) return;
              const payload = { orderItemId: wasteItem || null, productId: wasteProductId, name: wasteName, qty: Number(wasteQty) || 1, cost: Number(wasteCost) || 0, reason: wasteReason };
              setWasteErr(null);
              start(async () => {
                const r = await addOrderWaste(detail.id, payload);
                if (!r.ok) { setWasteErr(r.error || (lang === "es" ? "No se pudo guardar la merma." : "Couldn't save the waste entry.")); return; }
                setWasteItem(""); setWasteProductId(null); setWasteName(""); setWasteQty("1"); setWasteCost(""); setWasteReason("");
                const fresh = await loadOrderDetail(detailProp.id);
                if (fresh) setDetail(fresh);
                router.refresh();
              });
            };
            return (
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="ban" size={16} /><h4 className="grow">{lang === "es" ? "Mermas" : "Waste"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill>{wasteTotal > 0 && <Pill color="red">${formatMoney(wasteTotal)}</Pill>}
              {detail.waste.length > 0 && (
                <button className={"btn btn-sm " + (editWaste ? "btn-primary" : "btn-outline")} onClick={() => setEditWaste((v) => !v)}><Icon name={editWaste ? "check" : "edit"} size={13} />{editWaste ? (lang === "es" ? "Listo" : "Done") : (lang === "es" ? "Editar" : "Edit")}</button>
              )}
            </div>
            <div style={{ padding: "12px 14px" }} className="col gap-2">
              <div className="t-xs muted">{lang === "es" ? "Reimpresiones, errores de producción o cancelaciones parciales. No se le muestra al cliente ni cambia el total del pedido." : "Reprints, production errors or partial cancellations. Never shown to the customer and doesn't change the order total."}</div>
              {detail.waste.length > 0 && (
                <div className="col gap-1" style={{ paddingTop: 2 }}>
                  {detail.waste.map((w) => (editWaste ? (
                    <div className="row gap-2" key={w.id} style={{ alignItems: "center", padding: "5px 0" }}>
                      <input key={"n" + w.name} className="inp-inline grow" defaultValue={w.name} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== w.name) run(() => updateOrderWaste(w.id, { name: e.target.value })); }} placeholder={lang === "es" ? "Qué se perdió" : "What was wasted"} />
                      <input key={"q" + w.qty} className="inp-inline" style={{ width: 48 }} defaultValue={String(w.qty)} title={lang === "es" ? "Cantidad" : "Qty"} onBlur={(e) => { const q = Number(e.target.value) || 1; if (q !== w.qty) run(() => updateOrderWaste(w.id, { qty: q })); }} />
                      <div className="field field-sm field-filled" style={{ width: 90 }}><span className="t-sm muted">$</span><input key={"c" + w.cost} type="number" min={0} defaultValue={String(w.cost)} title={lang === "es" ? "Costo" : "Cost"} onBlur={(e) => { const c = Number(e.target.value) || 0; if (c !== w.cost) run(() => updateOrderWaste(w.id, { cost: c })); }} /></div>
                      <input key={"r" + w.reason} className="inp-inline grow" defaultValue={w.reason} placeholder={lang === "es" ? "Motivo" : "Reason"} onBlur={(e) => { if (e.target.value !== w.reason) run(() => updateOrderWaste(w.id, { reason: e.target.value })); }} />
                      <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} style={{ color: "var(--red)" }} onClick={() => run(() => deleteOrderWaste(w.id))}><Icon name="trash" size={14} /></button>
                    </div>
                  ) : (
                    <div className="row gap-2" key={w.id} style={{ alignItems: "center", fontSize: 12.5 }}>
                      <span className="mono" style={{ fontWeight: 700, color: "var(--red)" }}>${formatMoney(w.cost)}</span>
                      <Pill color="slate">{w.qty}× {w.name}</Pill>
                      <span className="t-xs muted truncate grow">{w.reason} · {new Date(w.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</span>
                      <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteOrderWaste(w.id))}><Icon name="x" size={13} /></button>
                    </div>
                  )))}
                </div>
              )}
              <div className="col gap-2">
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                  {detail.items.length > 0 && (
                    <select className="inp-inline" style={{ maxWidth: 150 }} value={wasteItem} onChange={(e) => pickWasteItem(e.target.value)}>
                      <option value="">{lang === "es" ? "Pedido completo" : "Whole order"}</option>
                      {detail.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                    </select>
                  )}
                  <CatalogAutocomplete className="inp-inline grow" style={{ minWidth: 140 }} products={products} personal={personal} lang={lang}
                    value={wasteName}
                    placeholder={lang === "es" ? "Qué se perdió" : "What was wasted"}
                    onChange={(v) => { setWasteName(v); setWasteProductId(null); }}
                    onPick={pickWasteProduct} />
                </div>
                <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                  <input className="inp-inline" style={{ width: 56 }} type="number" min={1} value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} title={lang === "es" ? "Cantidad" : "Qty"} />
                  <div className="field field-sm field-filled" style={{ width: 100 }}><span className="t-sm muted">$</span><input type="number" min={0} placeholder={lang === "es" ? "Costo" : "Cost"} value={wasteCost} onChange={(e) => setWasteCost(e.target.value)} title={wasteProductId ? (lang === "es" ? "Tomado del catálogo, editable" : "From the catalog, editable") : undefined} /></div>
                  <input className="inp-inline grow" style={{ minWidth: 140 }} placeholder={lang === "es" ? "Motivo (reimpresión, error…)" : "Reason (reprint, error…)"} value={wasteReason} onChange={(e) => setWasteReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWaste(); }} />
                  <button className="btn btn-sm btn-outline" disabled={pending || !wasteName.trim()} onClick={addWaste}><Icon name="plus" size={14} />{lang === "es" ? "Registrar" : "Add"}</button>
                </div>
                {wasteErr && <div className="t-xs" style={{ color: "var(--red)" }}>{wasteErr}</div>}
              </div>
            </div>
          </div>
            );
          })()}

          {/* activity log */}
          <div className="ws-block">
            <div className="ws-block-head"><Icon name="clock" size={16} /><h4>{lang === "es" ? "Registro de actividad" : "Activity log"}</h4></div>
            <div style={{ padding: "10px 14px" }}><div className="timeline">
              {detail.events.length === 0 ? <div className="muted t-sm">—</div> : detail.events.map((e) => {
                const au = e.actor_id ? agents.find((a) => a.id === e.actor_id) : null;
                return (
                  <div className="tl" key={e.id}>
                    <div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "plus" ? "plus" : e.kind === "status" ? "dot" : "clock"} size={13} /></div></div>
                    <div className="tl-body">
                      <div className="row gap-1" style={{ alignItems: "center", flexWrap: "wrap" }}>
                        {au
                          ? <Avatar name={au.name} initials={deriveInitials(au.name)} color={au.color} src={au.avatar_url ?? undefined} size={16} />
                          : <span title={lang === "es" ? "Automático" : "Automated"} style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--surface-3)", color: "var(--text-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="bolt" size={10} /></span>}
                        <span>{e.text}</span>
                      </div>
                      <div className="tl-time">{(au?.name ? au.name + " · " : "") + date(e.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div></div>
          </div>
        </div>

        <div className="drawer-foot">
          <span style={{ position: "relative", display: "inline-flex", flex: 1 }}>
            <button className="btn btn-outline btn-block" onClick={() => setXfer((v) => !v)}><Icon name="swap" size={15} />{lang === "es" ? "Transferir" : "Transfer"}</button>
            {xfer && (
              <div className="menu scroll" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, width: 240, maxHeight: 300, zIndex: 50 }}>
                <div className="menu-label">{lang === "es" ? "A un agente" : "To an agent"}</div>
                {agents.filter((a) => a.role !== "viewer").map((a) => <button className="menu-item" key={a.id} onClick={() => { setXfer(false); runOpt({ assignee_id: a.id }, () => assignOrder(detail.id, a.id)); }}><Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} src={a.avatar_url ?? undefined} size={20} />{a.name}</button>)}
                <div className="menu-sep" />
                <div className="menu-label">{lang === "es" ? "A un área" : "To an area"}</div>
                {areas.map((ar) => <button className="menu-item" key={ar.id} onClick={() => { setXfer(false); runOpt({ area_id: ar.id, area: { name: ar.name, color: ar.color } }, () => moveOrderArea(detail.id, ar.id)); }}><Pill color={ar.color as PillColor}>{ar.name}</Pill></button>)}
              </div>
            )}
          </span>
          {!isLast
            ? (
              <span style={{ position: "relative", display: "inline-flex", flex: 1 }}>
                <button className="btn btn-primary grow" disabled={pending} onClick={advance} style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}><Icon name="arrowr" size={15} />{lang === "es" ? "Avanzar etapa" : "Advance stage"}</button>
                <button className="btn btn-primary" disabled={pending} title={lang === "es" ? "Elegir etapa" : "Pick a stage"} onClick={() => setAdvanceMenu((v) => !v)} style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(255,255,255,.3)", padding: "0 9px" }}><Icon name="chevd" size={15} /></button>
                {advanceMenu && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setAdvanceMenu(false)} />
                    <div className="menu scroll" style={{ position: "absolute", bottom: "calc(100% + 6px)", right: 0, width: 220, maxHeight: 300, zIndex: 50 }}>
                      <div className="menu-label">{lang === "es" ? "Avanzar a la etapa" : "Move to stage"}</div>
                      {stages.map((s, i) => i === curIdx ? null : (
                        <button className="menu-item" key={s.id} onClick={() => { setAdvanceMenu(false); goToStage(s); }}>
                          <Pill color={s.color as PillColor} dot>{s.name}</Pill>{i < curIdx && <span className="muted t-xs" style={{ marginLeft: 4 }}>{lang === "es" ? "(atrás)" : "(back)"}</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </span>
            )
            : <button className="btn btn-dark grow" onClick={onClose}><Icon name="check" size={15} />{lang === "es" ? "Cerrar" : "Close"}</button>}
        </div>
      </aside>
      {stagePrompt && (
        <div className="modal-wrap" style={{ zIndex: 120 }}>
          <div className="scrim" onClick={() => setStagePrompt(null)} />
          <div className="modal" role="dialog" style={{ maxWidth: 400 }}>
            <div className="modal-head">
              <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="swap" /></span>
              <h3 className="grow">{lang === "es" ? "Avanzar a " : "Move to "}{stagePrompt.name}</h3>
              <button className="iconbtn" onClick={() => setStagePrompt(null)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="t-sm muted" style={{ lineHeight: 1.5 }}>{personal
                ? (lang === "es" ? "Esta tarea tiene subtareas con su propia etapa. ¿Mover también las subtareas a esta etapa o conservarlas como están?" : "This task has subtasks with their own stage. Move the subtasks to this stage too, or keep them as they are?")
                : (lang === "es" ? "Este pedido tiene productos con su propia etapa. ¿Mover también los productos a esta etapa o conservarlos como están?" : "This order has products with their own stage. Move the products to this stage too, or keep them as they are?")}</p>
            </div>
            <div className="modal-foot">
              <button className="btn btn-outline" onClick={() => applyStage(stagePrompt, false)}>{personal ? (lang === "es" ? "Conservar subtareas" : "Keep subtasks") : (lang === "es" ? "Conservar productos" : "Keep products")}</button>
              <button className="btn btn-primary" onClick={() => applyStage(stagePrompt, true)}><Icon name="checks" size={15} />{personal ? (lang === "es" ? "Sincronizar subtareas" : "Sync subtasks") : (lang === "es" ? "Sincronizar productos" : "Sync products")}</button>
            </div>
          </div>
        </div>
      )}
      {chatOpen && (
        <div style={{ position: "fixed", top: 0, bottom: 0, right: DRAWER_W, width: chatW, maxWidth: `calc(100vw - ${DRAWER_W + 40}px)`, zIndex: 92, boxShadow: "var(--sh-lg)", display: "flex", background: "var(--surface)" }}>
          <div className="order-chat-resizer" onPointerDown={startResize} title={lang === "es" ? "Arrastra para redimensionar" : "Drag to resize"} />
          {conv ? (
            <Thread detail={conv} agents={agents} areas={areas} connected={connected} businessId={businessId} floating />
          ) : (
            <div className="col center grow gap-2" style={{ alignItems: "center", justifyContent: "center", color: "var(--text-faint)", padding: 24, textAlign: "center" }}>
              {convLoading ? <span className="t-sm muted">{lang === "es" ? "Cargando conversación…" : "Loading conversation…"}</span>
                : <span className="t-sm muted">{lang === "es" ? "No se pudo cargar la conversación." : "Couldn't load the conversation."}</span>}
            </div>
          )}
        </div>
      )}
      {shipOpen && (
        <ShippingModal orderId={detail.id} contact={detail.contact ? { id: detail.contact.id, name: detail.contact.name, phone: detail.contact.phone } : null} lang={lang}
          onClose={() => setShipOpen(false)} onCreated={() => run(() => Promise.resolve())} />
      )}
      {invOpen && (
        <InvoiceModal orderId={detail.id} contactId={detail.contact?.id ?? null} total={detail.total} lang={lang}
          onClose={() => setInvOpen(false)} onCreated={() => run(() => Promise.resolve())} />
      )}
      {tagRect && (
        <TagPicker businessId={businessId} current={detail.contact?.tags ?? []} rect={tagRect}
          onPick={(t) => runOpt({ contact: detail.contact ? { ...detail.contact, tags: Array.from(new Set([...(detail.contact.tags ?? []), t])) } : detail.contact }, () => addOrderTag(detail.id, t))}
          onRemove={detail.contact ? (t) => runOpt({ contact: { ...detail.contact!, tags: (detail.contact!.tags ?? []).filter((x) => x !== t) } }, () => removeContactTag(detail.contact!.id, t)) : undefined}
          onClose={() => setTagRect(null)} />
      )}
      {showCharge && (
        <ChargeModal
          detail={detail} lang={lang}
          onClose={() => setShowCharge(false)}
          onDone={() => { setShowCharge(false); run(async () => {}); }} />
      )}
      {showCancel && (
        <CancelOrderModal
          detail={detail} lang={lang} personal={personal}
          onClose={() => setShowCancel(false)}
          onDone={() => { setShowCancel(false); router.refresh(); }} />
      )}
    </>
  );
}

/**
 * Las órdenes de cobro del pedido (0089).
 *
 * Va entre los totales y el historial de pagos a propósito: se lee de arriba abajo como la
 * historia del dinero —- cuánto es, en qué pagos se partió, y qué ha entrado.
 *
 * Con un pedido normal (sin cobros) no se pinta nada. La función de siempre —- "Enviar link de
 * pago" y "Registrar" un abono —- sigue exactamente igual para quien cobra de un solo tirón.
 */
function ChargeList({ detail, lang, pending, copied, onCopy, onSend, onVoid, onSettle }: {
  detail: OrderDetail; lang: "es" | "en"; pending: boolean;
  copied: string | null;
  onCopy: (id: string) => void;
  onSend: (id: string) => void;
  onVoid: (c: Charge) => void;
  onSettle: (c: Charge) => void;
}) {
  const es = lang === "es";
  const live = detail.charges.filter(isLive);
  if (!detail.charges.length) return null;
  // Descuadre entre lo comprometido en cobros y el total del pedido. Se DERIVA al pintar: guardarlo
  // se quedaría viejo en cuanto alguien edite el pedido por otro camino. Ver `chargesGap`.
  const gap = chargesGap(detail.charges, detail.total);

  return (
    <div className="col gap-2" style={{ paddingTop: 6, borderTop: "1px solid var(--border)" }}>
      <div className="t-xs muted" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {es ? "Órdenes de cobro" : "Payment requests"}
      </div>

      {detail.charges.map((c) => {
        const done = c.status === "paid";
        const dead = c.status === "void";
        const title = chargeTitle(c, lang);
        return (
          <div key={c.id} className="col gap-1" style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: done ? "var(--surface)" : "var(--surface-2)", opacity: dead ? 0.55 : 1 }}>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-xs muted mono" style={{ flex: "none" }}>{c.seq}</span>
              <span className="grow truncate t-sm" style={{ fontWeight: 600, textDecoration: dead ? "line-through" : undefined }}>{title}</span>
              <span className="mono t-sm" style={{ flex: "none", fontWeight: 700 }}>${formatMoney(c.amount)}</span>
              <Pill color={done ? "green" : dead ? "slate" : c.status === "sent" ? "violet" : "amber"} dot>
                {done ? (es ? "Pagado" : "Paid")
                  : dead ? (es ? "Anulado" : "Void")
                  : c.status === "sent" ? (es ? "Enviado" : "Sent") : (es ? "Sin enviar" : "Not sent")}
              </Pill>
            </div>

            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-xs muted grow truncate">
                {c.paid > 0 && !done && <>{es ? "Abonado" : "Paid"} ${formatMoney(c.paid)} · </>}
                {c.due_at
                  ? <>{es ? "Vence" : "Due"} {new Date(c.due_at).toLocaleDateString(es ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</>
                  : <>{new Date(c.created_at).toLocaleDateString(es ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</>}
              </span>
              {!done && !dead && (
                <>
                  <button className="iconbtn sm" disabled={pending} title={es ? "Copiar link" : "Copy link"} onClick={() => onCopy(c.id)}>
                    <Icon name={copied === c.id ? "check" : "file"} size={13} />
                  </button>
                  <button className="iconbtn sm" disabled={pending || !detail.conversation_id} title={c.status === "sent" ? (es ? "Reenviar al cliente" : "Resend to customer") : (es ? "Enviar al cliente" : "Send to customer")} onClick={() => onSend(c.id)}>
                    <Icon name="send" size={13} />
                  </button>
                  {/* "Ya me pagó esto en efectivo": registra el resto del cobro y lo cierra. Sin
                      esto habría que teclear el monto a mano y acordarse de a cuál cobro iba. */}
                  <button className="iconbtn sm" disabled={pending} title={es ? "Registrar como pagado" : "Record as paid"} onClick={() => onSettle(c)}>
                    <Icon name="check" size={13} />
                  </button>
                  <button className="iconbtn sm" disabled={pending} title={es ? "Anular" : "Void"} onClick={() => onVoid(c)}>
                    <Icon name="x" size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* El descuadre se enseña, no se corrige solo: cambiar en silencio un monto que el cliente ya
          tiene en su WhatsApp es peor que el descuadre. Decide quien cobra. */}
      {live.length > 0 && gap !== 0 && (
        <div className="t-xs" style={{ padding: "7px 10px", borderRadius: 9, background: "var(--amber-bg)", border: "1px solid var(--amber-bd)" }}>
          {gap > 0
            ? (es ? `Los cobros suman $${formatMoney(detail.total - gap)} y el pedido son $${formatMoney(detail.total)}: faltan $${formatMoney(gap)} por cobrar.`
                  : `Charges add up to $${formatMoney(detail.total - gap)} but the order is $${formatMoney(detail.total)}: $${formatMoney(gap)} left to charge.`)
            : (es ? `Los cobros suman $${formatMoney(detail.total - gap)}, más que el total del pedido ($${formatMoney(detail.total)}). Revisa antes de enviarlos.`
                  : `Charges add up to $${formatMoney(detail.total - gap)}, more than the order total ($${formatMoney(detail.total)}). Check before sending.`)}
        </div>
      )}
    </div>
  );
}

/**
 * Crear una orden de cobro.
 *
 * Lo de "¿se lo mando al cliente?" es la ÚLTIMA LÍNEA de este modal y no un segundo diálogo
 * después: son la misma decisión —- cobrar—, y partirla en dos ventanas seguidas es de las cosas
 * que más cansan de usar un sistema. Apagado, el cobro queda creado y el link se copia.
 *
 * El concepto se autopropone (`suggestKind`) y se puede cambiar: sin cobros previos es un anticipo,
 * si cubre todo lo que queda es el finiquito, y en medio una parcialidad.
 */
function ChargeModal({ detail, lang, onClose, onDone }: {
  detail: OrderDetail; lang: "es" | "en"; onClose: () => void; onDone: () => void;
}) {
  const es = lang === "es";
  const balance = Math.max(0, detail.total - detail.paid);
  const existing = detail.charges.filter(isLive).length;
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<string>("");
  const [label, setLabel] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [send, setSend] = useState(!!detail.conversation_id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const n = Math.round((Number(amount.replace(/[^0-9.]/g, "")) || 0) * 100) / 100;
  // El concepto sigue al monto mientras nadie lo toque a mano: así escribir "10000" ya lo llama
  // "Anticipo" sin un clic más, pero elegirlo manda.
  const effectiveKind = kind || suggestKind({ existing, amount: n, balance });
  const pct = (p: number) => setAmount(String(Math.round(balance * p * 100) / 100));

  const submit = async () => {
    setBusy(true); setErr(null);
    const r = await createCharge(detail.id, { amount: n, kind: effectiveKind, label: label.trim() || null, dueAt: dueAt || null, send });
    setBusy(false);
    if (!r.ok) { setErr(es ? "No se pudo crear el cobro." : "Couldn't create the charge."); return; }
    // Si no se envió (o no había chat), el link se queda a la vista para copiarlo: crear un cobro
    // y que su link no aparezca por ningún lado sería dejar el trabajo a medias.
    if (r.sent) { onDone(); return; }
    setLink(r.link ?? null);
  };

  if (link) {
    return (
      <div className="modal-back" onClick={onDone}>
        <div className="modal" role="dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="check" /></span>
            <div className="grow">
              <h3 style={{ margin: 0 }}>{es ? "Cobro creado" : "Charge created"}</h3>
              <p className="muted t-sm" style={{ margin: 0 }}>
                {detail.conversation_id
                  ? (es ? "No se envió. Copia el link y mándalo cuando quieras." : "Not sent. Copy the link and send it whenever you want.")
                  : (es ? "Este pedido no tiene chat, así que hay que mandarlo a mano." : "This order has no chat, so you'll need to send it manually.")}
              </p>
            </div>
          </div>
          <div className="modal-body">
            <div className="field field-sm field-filled"><input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={onDone}>{es ? "Listo" : "Done"}</button>
            <button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); onDone(); }}>
              <Icon name="file" size={15} />{es ? "Copiar link" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="orders" /></span>
          <div className="grow">
            <h3 style={{ margin: 0 }}>{es ? "Crear cobro" : "Create charge"} · {detail.code}</h3>
            <p className="muted t-sm" style={{ margin: 0 }}>
              {es ? `Saldo del pedido: $${formatMoney(balance)} de $${formatMoney(detail.total)}`
                  : `Order balance: $${formatMoney(balance)} of $${formatMoney(detail.total)}`}
            </p>
          </div>
        </div>

        <div className="modal-body">
          <label className="lbl">{es ? "Monto" : "Amount"}</label>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="mono">$</span>
            <input className="inp-inline" style={{ width: 140 }} inputMode="decimal" autoFocus value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            {/* Atajos sobre el SALDO, no sobre el total: si ya hubo un anticipo, "50%" tiene que
                significar la mitad de lo que falta, que es lo que la persona está pensando. */}
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => pct(0.5)}>50%</button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => pct(0.3)}>30%</button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => pct(1)}>{es ? "Saldo" : "Balance"}</button>
          </div>
          {n > balance + 0.01 && (
            <p className="t-xs" style={{ color: "var(--amber)", marginTop: 6 }}>
              {es ? `Es más que el saldo ($${formatMoney(balance)}).` : `That's more than the balance ($${formatMoney(balance)}).`}
            </p>
          )}

          <label className="lbl" style={{ marginTop: 14 }}>{es ? "Concepto" : "Concept"}</label>
          <div className="seg" style={{ width: "fit-content" }}>
            {CHARGE_KINDS.map((k) => (
              <button key={k} type="button" className={effectiveKind === k ? "on" : ""} onClick={() => setKind(k)}>
                {chargeKindLabel(k, lang)}
              </button>
            ))}
          </div>
          <input className="inp-inline" style={{ width: "100%", marginTop: 8 }} value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={es ? `Otro nombre (opcional) — por defecto "${chargeKindLabel(effectiveKind, lang)}"` : `Custom name (optional) — defaults to "${chargeKindLabel(effectiveKind, lang)}"`} />

          <label className="lbl" style={{ marginTop: 14 }}>{es ? "Fecha límite" : "Due date"} <span className="muted" style={{ fontWeight: 400 }}>({es ? "opcional" : "optional"})</span></label>
          <input className="inp-inline" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />

          {/* LA pregunta, aquí y no en un segundo diálogo. */}
          <label className="row gap-2" style={{ alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", cursor: detail.conversation_id ? "pointer" : "default" }}>
            <input type="checkbox" checked={send} disabled={!detail.conversation_id} onChange={(e) => setSend(e.target.checked)} />
            <span className="grow t-sm">
              {es ? "Enviar al cliente por WhatsApp" : "Send to the customer on WhatsApp"}
              <span className="t-xs muted" style={{ display: "block" }}>
                {detail.conversation_id
                  ? (es ? "Le llega el concepto, el monto y su link de pago." : "They get the concept, the amount and their pay link.")
                  : (es ? "Este pedido no tiene chat: solo se creará el link." : "This order has no chat: only the link will be created.")}
              </span>
            </span>
          </label>

          {err && <p className="t-sm" style={{ color: "var(--red)", marginTop: 10 }}>{err}</p>}
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy || !(n > 0)} onClick={submit}>
            <Icon name={send ? "send" : "plus"} size={15} />
            {busy ? (es ? "Creando…" : "Creating…") : send ? (es ? "Crear y enviar" : "Create and send") : (es ? "Crear cobro" : "Create charge")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cancelar un pedido: motivo + qué pasó con el dinero.
 *
 *  El reembolso se pregunta en vez de asumirse porque las dos respuestas son comunes y opuestas:
 *  cancelar antes de cobrar no mueve dinero, y cancelar algo ya pagado sí. Se precarga con lo
 *  pagado (el caso más frecuente) pero se puede bajar para devoluciones parciales.
 *
 *  En modo personal no hay dinero, así que el bloque entero desaparece. */
function CancelOrderModal({
  detail, lang, personal, onClose, onDone,
}: { detail: OrderDetail; lang: "es" | "en"; personal: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(String(detail.paid > 0 ? detail.paid : 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Math.max(0, Math.min(Number(refund) || 0, detail.paid));
  const es = lang === "es";

  const submit = async () => {
    setBusy(true); setErr(null);
    const r = await cancelOrder(detail.id, { reason, refund: personal ? 0 : amount });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? (es ? "No se pudo cancelar." : "Couldn't cancel.")); return; }
    onDone();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--amber-50, var(--surface-2))", color: "var(--amber)" }}><Icon name="ban" /></span>
          <div className="grow">
            <h3 style={{ margin: 0 }}>{personal ? (es ? "Cancelar tarea" : "Cancel task") : (es ? "Cancelar pedido" : "Cancel order")} {detail.code}</h3>
            <p className="muted t-sm" style={{ margin: 0 }}>
              {es ? "Sigue visible en su historial, pero deja de contar como venta en reportes." : "It stays visible in its history but stops counting as a sale in reports."}
            </p>
          </div>
        </div>
        <div className="modal-body">
          <label className="lbl">{es ? "Motivo" : "Reason"} <span className="muted" style={{ fontWeight: 400 }}>({es ? "opcional" : "optional"})</span></label>
          <input className="inp-inline" style={{ width: "100%" }} value={reason} autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder={es ? "Ej. el cliente ya no lo quiere" : "e.g. customer changed their mind"} />

          {!personal && detail.paid > 0 && (
            <div style={{ marginTop: 14 }}>
              <label className="lbl">{es ? "Dinero devuelto" : "Money refunded"}</label>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <span className="mono">$</span>
                <input className="inp-inline" style={{ width: 120 }} inputMode="decimal" value={refund}
                  onChange={(e) => setRefund(e.target.value)} />
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setRefund(String(detail.paid))}>{es ? "Todo" : "All"}</button>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setRefund("0")}>{es ? "Nada" : "None"}</button>
              </div>
              <p className="muted t-xs" style={{ marginTop: 6 }}>
                {es
                  ? `Este pedido tiene $${formatMoney(detail.paid)} cobrados. Se registrará como reembolso en el historial de pagos.`
                  : `This order has $${formatMoney(detail.paid)} collected. It will be recorded as a refund in the payment history.`}
              </p>
            </div>
          )}
          {!personal && detail.paid <= 0 && (
            <p className="muted t-sm" style={{ marginTop: 12 }}>{es ? "No hay pagos registrados, así que no hay nada que devolver." : "No payments recorded, so there's nothing to refund."}</p>
          )}
          {err && <p className="t-sm" style={{ color: "var(--red)", marginTop: 10 }}>{err}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{es ? "Volver" : "Back"}</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? (es ? "Cancelando…" : "Cancelling…") : (es ? "Cancelar pedido" : "Cancel order")}
          </button>
        </div>
      </div>
    </div>
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
          <div className="menu" style={menuStyle(rect, { width: 180, height: 280 })}>
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
          <div className="menu" style={menuStyle(rect, { width: 170, height: 220 })}>
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
