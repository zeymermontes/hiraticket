"use client";
import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type OrderRow, type PillColor, type PriceTier, priorityColor, formatMoney, tierPrice, isOverdue, PRIORITY_LABEL as PRIO_LABEL } from "@/lib/types";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import type { OrderDetail } from "@/lib/orders";
import type { ConvDetail } from "@/lib/chat";
import type { Product } from "@/lib/extras";
import { OrderDrawer } from "@/components/OrderDrawer";
import { TransferModal } from "@/components/TransferModal";
import { createOrder, assignOrder, addOrderNote } from "@/app/(app)/orders/actions";
import { moveOrderArea } from "@/app/(app)/actions";

type SortKey = "code" | "total" | "updated_at" | "created_at" | "due_at";

function PriorityFlag({ p, lang }: { p: string; lang: "es" | "en" }) {
  return <Pill color={priorityColor(p as never)}><Icon name="flag" size={11} />{PRIO_LABEL[p]?.[lang] ?? p}</Pill>;
}

export function OrdersTable({
  rows, objectName, businessId, areas, stages, agents, openOrder, autoOpen, defaultContact, convDetail, connected, products, contacts,
}: {
  rows: OrderRow[];
  objectName: string;
  businessId: string;
  areas: Area[];
  stages: Stage[];
  agents: Agent[];
  openOrder: OrderDetail | null;
  autoOpen?: boolean;
  defaultContact?: string;
  convDetail: ConvDetail | null;
  connected: boolean;
  products: Product[];
  contacts: { id: string; name: string }[];
}) {
  const { t, lang, personal } = useApp();
  const router = useRouter();
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showNew, setShowNew] = useState(false);
  const [stageF, setStageF] = useState("");
  const [areaF, setAreaF] = useState("");
  const [assigneeF, setAssigneeF] = useState("");
  const [prioF, setPrioF] = useState("");
  const [dense, setDense] = useState(false);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showXfer, setShowXfer] = useState(false);
  const PER = 25;
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => { if (autoOpen) setShowNew(true); }, [autoOpen]);
  useEffect(() => { setPage(0); }, [q, stageF, areaF, assigneeF, prioF]);

  const sortedAll = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((o) =>
      (!needle || o.code.toLowerCase().includes(needle) || (o.contact?.name ?? "").toLowerCase().includes(needle)) &&
      (!stageF || o.stage?.name === stageF) &&
      (!areaF || o.area?.name === areaF) &&
      (!assigneeF || o.assignee_id === assigneeF) &&
      (!prioF || o.priority === prioF),
    );
    const sorted = [...filtered].sort((a, b) => {
      let av: string | number, bv: string | number;
      if (sortKey === "total") { av = a.total; bv = b.total; }
      else if (sortKey === "updated_at") { av = a.updated_at; bv = b.updated_at; }
      else if (sortKey === "created_at") { av = a.created_at ?? a.updated_at; bv = b.created_at ?? b.updated_at; }
      else if (sortKey === "due_at") { av = a.due_at ?? "9999"; bv = b.due_at ?? "9999"; } // no deadline sorts last
      else { av = a.code; bv = b.code; }
      const r = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? r : -r;
    });
    return sorted;
  }, [rows, q, sortKey, dir, stageF, areaF, assigneeF, prioF]);

  const pageCount = Math.max(1, Math.ceil(sortedAll.length / PER));
  const curPage = Math.min(page, pageCount - 1); // clamp so a shrunk list never lands on an empty page
  const view = useMemo(() => sortedAll.slice(curPage * PER, curPage * PER + PER), [sortedAll, curPage]);

  function sortBy(k: SortKey) {
    if (sortKey === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setDir("desc"); }
  }

  const Sort = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="sortable" onClick={() => sortBy(k)} style={{ cursor: "pointer" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        {sortKey === k && <Icon name="chevd" size={12} />}
      </span>
    </th>
  );

  const relDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
      day: "2-digit", month: "short",
    });

  function exportCsv() {
    const head = personal
      ? ["Code", "Contact", "Stage", "Area", "Agent", "Priority", "Created", "Updated"]
      : ["Code", "Customer", "Stage", "Area", "Agent", "Priority", "Total", "Created", "Updated"];
    const lines = sortedAll.map((o) => {
      const base = [o.code, o.contact?.name ?? "", o.stage?.name ?? "", o.area?.name ?? "", (o.assignee_id && agentMap.get(o.assignee_id)?.name) || "", o.priority];
      const tail = [o.created_at ?? "", o.updated_at];
      return [...base, ...(personal ? [] : [o.total]), ...tail].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "pedidos.csv"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>{objectName}</h1>
        <Pill color="slate" large>{sortedAll.length} {objectName.toLowerCase()}</Pill>
        <span className="grow" />
        <div className="seg seg-sm">
          <button className={!dense ? "on" : ""} onClick={() => setDense(false)} title={lang === "es" ? "Cómodo" : "Comfortable"}><Icon name="layers" size={14} /></button>
          <button className={dense ? "on" : ""} onClick={() => setDense(true)} title={lang === "es" ? "Compacto" : "Compact"}><Icon name="sliders" size={14} /></button>
        </div>
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 220 }}>
          <Icon name="search" />
          <input placeholder={t("search_ph")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select select-sm" value={stageF} onChange={(e) => setStageF(e.target.value)}>
          <option value="">{lang === "es" ? "Todo estado" : "All status"}</option>
          {stages.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select className="select select-sm" value={areaF} onChange={(e) => setAreaF(e.target.value)}>
          <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
          {areas.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <select className="select select-sm" value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)}>
          <option value="">{lang === "es" ? "Todo agente" : "All agents"}</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select select-sm" value={prioF} onChange={(e) => setPrioF(e.target.value)}>
          <option value="">{lang === "es" ? "Toda prioridad" : "All priority"}</option>
          {(["urgent", "high", "normal", "low"] as const).map((p) => <option key={p} value={p}>{PRIO_LABEL[p][lang]}</option>)}
        </select>
        <span className="grow" />
        <button className="btn btn-sm btn-outline" type="button" onClick={exportCsv}><Icon name="file" size={14} /> {lang === "es" ? "Exportar" : "Export"}</button>
        <button className="btn btn-sm btn-primary" type="button" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} /> {t("new_order")}
        </button>
      </div>

      {sel.size > 0 && (
        <div className="row gap-2" style={{ margin: "0 24px 10px", padding: "8px 12px", background: "var(--brand-50)", border: "1px solid var(--brand)", borderRadius: 10, alignItems: "center" }}>
          <strong>{sel.size}</strong><span className="t-sm">{lang === "es" ? "seleccionados" : "selected"}</span>
          <span className="grow" />
          <button className="btn btn-sm btn-outline" onClick={() => setShowXfer(true)}><Icon name="swap" size={14} />{lang === "es" ? "Transferir" : "Transfer"}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>{lang === "es" ? "Limpiar" : "Clear"}</button>
        </div>
      )}

      <div className={"tablewrap scroll" + (dense ? " dense" : "")}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" title={lang === "es" ? "Seleccionar todos los filtrados" : "Select all filtered"} checked={sortedAll.length > 0 && sortedAll.every((o) => sel.has(o.id))} onChange={(e) => setSel(e.target.checked ? new Set(sortedAll.map((o) => o.id)) : new Set())} /></th>
              <Sort k="code">{personal ? (lang === "es" ? "Tarea" : "Task") : t("col_order")}</Sort>
              <th>{personal ? (lang === "es" ? "Contacto" : "Contact") : t("col_customer")}</th>
              <th>{t("col_status")}</th>
              <th>{t("col_area")}</th>
              <th>{lang === "es" ? "Agente" : "Agent"}</th>
              <th>{lang === "es" ? "Prioridad" : "Priority"}</th>
              <th>{personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Artículos" : "Items")}</th>
              {!personal && <Sort k="total">{t("col_total")}</Sort>}
              <Sort k="due_at">{lang === "es" ? "Fecha límite" : "Deadline"}</Sort>
              <Sort k="created_at">{lang === "es" ? "Creado" : "Created"}</Sort>
              <Sort k="updated_at">{t("col_updated")}</Sort>
            </tr>
          </thead>
          <tbody>
            {view.map((o) => {
              const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null;
              const item0 = o.items?.[0]?.name;
              const overdue = isOverdue(o.due_at, o.stage?.name === stages[stages.length - 1]?.name);
              return (
              <tr key={o.id} style={{ cursor: "pointer" }} className={sel.has(o.id) ? "sel-row" : ""} onClick={() => router.push(`/orders?order=${o.id}`, { scroll: false })}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} /></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{o.code}</span></td>
                <td>
                  <div className="cust">
                    <Avatar name={o.contact?.name} initials={deriveInitials(o.contact?.name ?? "?")} size={26} color="#5A6373" />
                    <span className="truncate" style={{ maxWidth: 150 }}>{o.contact?.name ?? "—"}</span>
                  </div>
                </td>
                <td>{o.stage ? <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td>{o.area ? <Pill color={o.area.color as PillColor}>{o.area.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td>{ag ? <div className="cust"><Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} size={22} /><span className="t-sm truncate" style={{ maxWidth: 96 }}>{ag.name}</span></div> : <span className="muted t-sm">—</span>}</td>
                <td><PriorityFlag p={o.priority} lang={lang} /></td>
                <td><span className="t-sm truncate" style={{ display: "inline-block", maxWidth: 170 }}>{item0 ?? "—"}{o.items && o.items.length > 1 ? <span className="muted"> +{o.items.length - 1}</span> : null}</span></td>
                {!personal && <td><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(o.total)}</span></td>}
                <td className="t-sm">{o.due_at ? <span className="row gap-1" style={{ color: overdue ? "var(--red)" : "var(--text-muted)", fontWeight: overdue ? 700 : 400 }}>{overdue && <Icon name="clock" size={12} />}{relDate(o.due_at)}</span> : <span className="muted">—</span>}</td>
                <td className="muted t-sm">{o.created_at ? relDate(o.created_at) : "—"}</td>
                <td className="muted t-sm">{relDate(o.updated_at)}</td>
              </tr>
              );
            })}
            {view.length === 0 && (
              <tr>
                <td colSpan={personal ? 11 : 12} className="muted" style={{ textAlign: "center", padding: 40 }}>
                  {personal ? (lang === "es" ? "No hay tareas todavía." : "No tasks yet.") : t("empty_orders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="row gap-2" style={{ padding: "10px 4px", alignItems: "center" }}>
          <span className="muted t-sm">{lang === "es" ? "Mostrando" : "Showing"} {curPage * PER + 1}–{Math.min((curPage + 1) * PER, sortedAll.length)} {lang === "es" ? "de" : "of"} {sortedAll.length}</span>
          <span className="grow" />
          <button className="btn btn-sm btn-outline" disabled={curPage === 0} onClick={() => setPage(Math.max(0, curPage - 1))}>‹</button>
          <span className="t-sm">{curPage + 1} / {pageCount}</span>
          <button className="btn btn-sm btn-outline" disabled={curPage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, curPage + 1))}>›</button>
        </div>
      )}

      {showNew && (
        <NewOrderModal
          businessId={businessId}
          areas={areas}
          stages={stages}
          defaultContact={defaultContact}
          products={products}
          contacts={contacts}
          onClose={() => setShowNew(false)}
        />
      )}

      {showXfer && (
        <TransferModal
          title={lang === "es" ? `Transferir ${sel.size} pedido(s)` : `Transfer ${sel.size} order(s)`}
          agents={agents}
          areas={areas}
          onClose={() => setShowXfer(false)}
          onConfirm={async (dest, note) => {
            for (const id of sel) {
              if (dest.type === "agent") await assignOrder(id, dest.id);
              else await moveOrderArea(id, dest.id);
              if (note) await addOrderNote(id, note);
            }
            setSel(new Set());
            router.refresh();
          }}
        />
      )}

      {openOrder && (
        <OrderDrawer
          detail={openOrder}
          stages={stages}
          areas={areas}
          agents={agents}
          businessId={businessId}
          convDetail={convDetail}
          connected={connected}
          onClose={() => router.push("/orders", { scroll: false })}
        />
      )}
    </div>
  );
}

export function NewOrderModal({
  businessId, areas, stages, onClose, defaultContact, products, contacts, embedded, onCreated,
}: {
  businessId: string;
  areas: Area[];
  stages: Stage[];
  onClose: () => void;
  defaultContact?: string;
  products: Product[];
  contacts: { id: string; name: string }[];
  embedded?: boolean;       // render over the chat center column (keep the thread readable)
  onCreated?: () => void;   // called after create instead of router.refresh (e.g. soft refresh)
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contactName, setContactName] = useState(defaultContact ?? "");
  type Line = { item: string; qty: string; price: string; basePrice?: number; tiers?: PriceTier[] };
  const [lines, setLines] = useState<Line[]>([{ item: "", qty: "1", price: "" }]);
  const [priority, setPriority] = useState("normal");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [dueAt, setDueAt] = useState("");
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const hasItem = lines.some((l) => l.item.trim());

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    // Re-price from quantity tiers when the qty changes on a catalog line.
    if (patch.qty !== undefined && next.tiers && next.tiers.length && next.basePrice != null) {
      next.price = String(tierPrice(next.basePrice, next.tiers, Number(next.qty) || 1));
    }
    return next;
  }));
  const addLine = (l?: Line) => setLines((ls) => [...ls, l ?? { item: "", qty: "1", price: "" }]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const addFromCatalog = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const line: Line = { item: p.name, qty: "1", price: String(tierPrice(p.price, p.price_tiers, 1)), basePrice: p.price, tiers: p.price_tiers };
    // Fill the first empty row, else append.
    setLines((ls) => {
      const i = ls.findIndex((l) => !l.item.trim());
      if (i >= 0) return ls.map((l, j) => (j === i ? line : l));
      return [...ls, line];
    });
  };

  function submit() {
    if (!contactName.trim() || !hasItem) return;
    start(async () => {
      await createOrder(businessId, {
        contactName,
        items: lines.map((l) => ({ item: l.item, qty: Number(l.qty) || 1, price: Number(l.price) || 0 })),
        areaId: areaId || null, stageId: stageId || null, priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onClose();
      if (onCreated) onCreated(); else router.refresh();
    });
  }

  const inner = (
      <div className="modal" role="dialog" style={embedded ? { position: "relative", width: "100%", maxWidth: "100%", maxHeight: "100%", display: "flex", flexDirection: "column" } : undefined}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="orders" /></span>
          <h3 className="grow">{personal ? (lang === "es" ? "Nueva tarea" : "New task") : (lang === "es" ? "Nuevo pedido" : "New order")}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-2">
          <label className="lbl">{personal ? (lang === "es" ? "Contacto" : "Contact") : (lang === "es" ? "Cliente" : "Customer")}</label>
          <input className="inp-inline" list="contact-list" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={personal ? (lang === "es" ? "Nombre del contacto" : "Contact name") : (lang === "es" ? "Nombre del cliente" : "Customer name")} />
          <datalist id="contact-list">{contacts.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          {products.length > 0 && (
            <>
              <label className="lbl">{personal ? (lang === "es" ? "Agregar tarea repetitiva" : "Add recurring task") : (lang === "es" ? "Agregar del catálogo" : "Add from catalog")}</label>
              <select className="select" value="" onChange={(e) => { addFromCatalog(e.target.value); e.target.value = ""; }}>
                <option value="">{personal ? (lang === "es" ? "— elige una tarea —" : "— pick a task —") : (lang === "es" ? "— elige un producto —" : "— pick a product —")}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{!personal && ` · $${formatMoney(p.price)}`}</option>)}
              </select>
            </>
          )}
          <label className="lbl">{personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Artículos" : "Items")}</label>
          <div className="col gap-2">
            {lines.map((l, i) => {
              const onTier = !personal && !!(l.tiers?.length && l.basePrice != null && Number(l.price) < l.basePrice);
              return (
                <div className="col gap-1" key={i}>
                  <div className="row gap-2" style={{ alignItems: "flex-end" }}>
                    <div className="grow"><input className="inp-inline" style={{ width: "100%" }} value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} placeholder={personal ? (lang === "es" ? "Subtarea" : "Subtask") : (lang === "es" ? "Descripción" : "Description")} /></div>
                    {!personal && <div style={{ width: 56 }}><input className="inp-inline" style={{ width: "100%" }} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} title={lang === "es" ? "Cantidad" : "Qty"} /></div>}
                    {!personal && <div style={{ width: 84 }}><input className="inp-inline" style={{ width: "100%" }} value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} placeholder="$" title={lang === "es" ? "Precio unit." : "Unit price"} /></div>}
                    <button className="iconbtn sm" disabled={lines.length === 1} title={lang === "es" ? "Quitar" : "Remove"} onClick={() => removeLine(i)} style={{ marginBottom: 1 }}><Icon name="x" size={15} /></button>
                  </div>
                  {onTier && <span className="t-xs row gap-1" style={{ color: "var(--green)" }}><Icon name="layers" size={11} />{lang === "es" ? `Precio por volumen (base $${formatMoney(l.basePrice!)})` : `Volume price (base $${formatMoney(l.basePrice!)})`}</span>}
                </div>
              );
            })}
            <button className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => addLine()}><Icon name="plus" size={14} />{personal ? (lang === "es" ? "Agregar subtarea" : "Add subtask") : (lang === "es" ? "Agregar producto" : "Add product")}</button>
          </div>
          <div className="row gap-2">
            <div className="grow"><label className="lbl">{lang === "es" ? "Etapa" : "Stage"}</label>
              <select className="select" style={{ width: "100%" }} value={stageId} onChange={(e) => setStageId(e.target.value)}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <div className="grow"><label className="lbl">{lang === "es" ? "Área" : "Area"}</label>
              <select className="select" style={{ width: "100%" }} value={areaId} onChange={(e) => setAreaId(e.target.value)}>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            </div>
            <div className="grow"><label className="lbl">{lang === "es" ? "Prioridad" : "Priority"}</label>
              <select className="select" style={{ width: "100%" }} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {(["low", "normal", "high", "urgent"] as const).map((p) => <option key={p} value={p}>{PRIO_LABEL[p][lang]}</option>)}
              </select>
            </div>
          </div>
          <div className="grow"><label className="lbl">{lang === "es" ? "Fecha límite (opcional)" : "Deadline (optional)"}</label>
            <input type="datetime-local" className="inp-inline" style={{ width: "100%" }} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          {!personal && (
            <div className="row" style={{ paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", alignItems: "center" }}>
              <span className="grow" style={{ fontWeight: 700 }}>{lang === "es" ? "Subtotal" : "Subtotal"}</span>
              <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(subtotal)}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !contactName.trim() || !hasItem} onClick={submit}><Icon name="plus" size={15} />{personal ? (lang === "es" ? "Crear tarea" : "Create task") : (lang === "es" ? "Crear pedido" : "Create order")}</button>
        </div>
      </div>
  );

  if (embedded) {
    // Overlay only the center column (parent is position:relative) so the chat thread stays readable.
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 8 }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(20,18,10,.32)" }} onClick={onClose} />
        {inner}
      </div>
    );
  }
  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      {inner}
    </div>
  );
}
