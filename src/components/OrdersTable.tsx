"use client";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { doneStageNames, defaultDoneStageName } from "@/lib/doneStage";
import { useConfirm } from "@/components/Confirm";
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
import { CatalogPicker } from "@/components/CatalogPicker";
import { createOrder, assignOrder, addOrderNote, setOrderDeleted, loadOrdersPage, loadOrderIds, purgeOrder, bulkMoveOrderStage, markPaid } from "@/app/(app)/orders/actions";
import type { OrderQuery, OrdersPage } from "@/lib/queries";
import { moveOrderArea } from "@/app/(app)/actions";
import { menuStyle } from "@/lib/popover";
import { useFlowToast } from "@/components/Toast";

type SortKey = "code" | "total" | "updated_at" | "created_at" | "due_at";

function PriorityFlag({ p, lang }: { p: string; lang: "es" | "en" }) {
  return <Pill color={priorityColor(p as never)}><Icon name="flag" size={11} />{PRIO_LABEL[p]?.[lang] ?? p}</Pill>;
}

export function OrdersTable({
  initial, objectName, businessId, areas, stages, agents, openOrder, autoOpen, defaultContact, convDetail, connected, products, contacts, invoice, shipping, invoicing, doneFromStageId = null, manualMarginPct = 50,
}: {
  initial: OrdersPage; // first page, rendered on the server; the rest is fetched on demand
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
  invoice?: { add: boolean; rate: number };
  doneFromStageId?: string | null;
  manualMarginPct?: number;
  shipping?: string | null; // active shipping plugin id (gates all shipping UI)
  invoicing?: boolean; // Facturapi active (gates the CFDI block)
}) {
  const { t, lang, personal } = useApp();
  const router = useRouter();
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [showNew, setShowNew] = useState(false);
  const [stageF, setStageF] = useState("");   // stage id ("" = all)
  const [areaF, setAreaF] = useState("");     // area id
  const [assigneeF, setAssigneeF] = useState("");
  const [prioF, setPrioF] = useState("");
  const [dense, setDense] = useState(false);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showXfer, setShowXfer] = useState(false);
  const [stageMenu, setStageMenu] = useState<DOMRect | null>(null); // bulk "change stage" popover
  const [, startBulk] = useTransition();
  const flowToast = useFlowToast();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const [trashView, setTrashView] = useState(false);
  const PER = 25;

  // Server-side window. Search/filters/sort/paging are query params now: the table holds one page,
  // not every order the business ever created.
  const [view, setView] = useState<OrderRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [capped, setCapped] = useState(initial.capped);
  const [loading, setLoading] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState("");

  // Typing hits the server, so debounce it (the old filter was in-memory and could run per keystroke).
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);

  const filters: OrderQuery = useMemo(() => ({
    q: debouncedQ, stageId: stageF || undefined, areaId: areaF || undefined,
    assigneeId: assigneeF || undefined, priority: prioF || undefined,
    sort: sortKey, dir, trash: trashView,
  }), [debouncedQ, stageF, areaF, assigneeF, prioF, sortKey, dir, trashView]);

  // A changed filter invalidates the page number — go back to the first page.
  useEffect(() => { setPage(0); }, [filters]);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // `initial` already IS page 0 with the default filters — don't re-fetch it on mount.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    let stale = false;
    setLoading(true);
    loadOrdersPage({ ...filters, page, per: PER })
      .then((r) => { if (stale) return; setView(r.rows); setTotal(r.total); setCapped(r.capped); })
      .catch(() => {})
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [filters, page, reloadKey]);

  const bulkStage = (stageId: string) => {
    setStageMenu(null);
    const ids = [...sel];
    startBulk(async () => {
      const r = await bulkMoveOrderStage(ids, stageId);
      flowToast(r.flows, lang);
      if (r.confirmPaymentOrderIds.length > 0) {
        const yes = await ask({
          icon: "check",
          title: lang === "es" ? "¿Marcar como pagados?" : "Mark as paid?",
          message: lang === "es"
            ? `${r.confirmPaymentOrderIds.length} pedido(s) llegaron a la etapa de confirmar pago.`
            : `${r.confirmPaymentOrderIds.length} order(s) reached the confirm-payment stage.`,
          confirmLabel: lang === "es" ? "Marcar pagados" : "Mark paid",
          cancelLabel: lang === "es" ? "No" : "No",
        });
        if (yes) await Promise.all(r.confirmPaymentOrderIds.map((id) => markPaid(id)));
      }
      setSel(new Set());
      reload();
    });
  };
  const openTrash = (on: boolean) => { setTrashView(on); setSel(new Set()); setPage(0); };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => { if (autoOpen) setShowNew(true); }, [autoOpen]);

  const pageCount = Math.max(1, Math.ceil(total / PER));
  const curPage = Math.min(page, pageCount - 1); // clamp so a shrunk list never lands on an empty page

  /** "Select all filtered" spans every page, so the ids come from the server. */
  const selectAllFiltered = async (on: boolean) => {
    if (!on) { setSel(new Set()); return; }
    setSel(new Set(await loadOrderIds(filters)));
  };

  function sortBy(k: SortKey) {
    if (sortKey === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setDir("desc"); }
  }

  const Sort = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="sortable" onClick={() => sortBy(k)} style={{ cursor: "pointer" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        {sortKey === k && <span style={{ display: "inline-flex", transform: dir === "asc" ? "rotate(180deg)" : undefined }}><Icon name="chevd" size={12} /></span>}
      </span>
    </th>
  );

  const relDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
      day: "2-digit", month: "short",
    });

  const EXPORT_CAP = 5000;
  async function exportCsv() {
    // The export covers the whole filtered set, not the visible page, so it re-queries with a
    // wide window. Rare and user-initiated, unlike the per-page reads.
    const { rows: all, total: matched } = await loadOrdersPage({ ...filters, page: 0, per: EXPORT_CAP });
    if (matched > all.length) {
      alert(lang === "es"
        ? `Se exportan los primeros ${all.length} de ${matched}. Afina los filtros para exportar el resto.`
        : `Exporting the first ${all.length} of ${matched}. Narrow the filters to export the rest.`);
    }
    const head = personal
      ? ["Code", "Contact", "Stage", "Area", "Agent", "Priority", "Created", "Updated"]
      : ["Code", "Customer", "Stage", "Area", "Agent", "Priority", "Total", "Created", "Updated"];
    const lines = all.map((o) => {
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
        <Pill color="slate" large>{total}{capped ? "+" : ""} {objectName.toLowerCase()}</Pill>
        {loading && <span className="muted t-sm">{lang === "es" ? "Cargando…" : "Loading…"}</span>}
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
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select select-sm" value={areaF} onChange={(e) => setAreaF(e.target.value)}>
          <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
        <button className={"btn btn-sm " + (trashView ? "btn-danger" : "btn-outline")} type="button" onClick={() => openTrash(!trashView)} title={lang === "es" ? "Papelera (eliminados)" : "Trash (deleted)"}><Icon name="trash" size={14} /> {lang === "es" ? "Papelera" : "Trash"}{trashView ? ` (${total})` : ""}</button>
        <button className="btn btn-sm btn-outline" type="button" onClick={exportCsv}><Icon name="file" size={14} /> {lang === "es" ? "Exportar" : "Export"}</button>
        <button className="btn btn-sm btn-primary" type="button" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} /> {t("new_order")}
        </button>
      </div>

      {sel.size > 0 && (
        <div className="row gap-2" style={{ margin: "0 24px 10px", padding: "8px 12px", background: "var(--brand-50)", border: "1px solid var(--brand)", borderRadius: 10, alignItems: "center" }}>
          <strong>{sel.size}</strong><span className="t-sm">{lang === "es" ? "seleccionados" : "selected"}</span>
          <span className="grow" />
          <button className="btn btn-sm btn-outline" onClick={(e) => setStageMenu(e.currentTarget.getBoundingClientRect())}><Icon name="kanban" size={14} />{lang === "es" ? "Cambiar etapa" : "Change stage"}</button>
          <button className="btn btn-sm btn-outline" onClick={() => setShowXfer(true)}><Icon name="swap" size={14} />{lang === "es" ? "Transferir" : "Transfer"}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>{lang === "es" ? "Limpiar" : "Clear"}</button>
        </div>
      )}
      {stageMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setStageMenu(null)} />
          <div className="menu scroll" style={menuStyle(stageMenu, { width: 220, height: 300, align: "right" })}>
            <div className="menu-label">{lang === "es" ? "Mover a etapa" : "Move to stage"}</div>
            {stages.map((s) => (
              <button key={s.id} className="menu-item" onClick={() => bulkStage(s.id)}>
                <Pill color={s.color as PillColor} dot>{s.name}</Pill>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={"tablewrap scroll" + (dense ? " dense" : "")}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" title={lang === "es" ? "Seleccionar todos los filtrados" : "Select all filtered"} checked={view.length > 0 && view.every((o) => sel.has(o.id))} onChange={(e) => selectAllFiltered(e.target.checked)} /></th>
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
              {trashView ? <th>{lang === "es" ? "Acciones" : "Actions"}</th> : <Sort k="updated_at">{t("col_updated")}</Sort>}
            </tr>
          </thead>
          <tbody>
            {view.map((o) => {
              const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null;
              const item0 = o.items?.[0]?.name;
              const overdue = isOverdue(o.due_at, !!o.stage && doneStageNames(stages, doneFromStageId).has(o.stage.name));
              return (
              <tr key={o.id} style={{ cursor: trashView ? "default" : "pointer", opacity: trashView ? 0.85 : 1 }} className={sel.has(o.id) ? "sel-row" : ""} onClick={() => { if (!trashView) router.push(`/orders?order=${o.id}`, { scroll: false }); }}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggleSel(o.id)} /></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>{o.code}</span></td>
                <td>
                  <div className="cust">
                    <Avatar name={o.contact?.name} initials={deriveInitials(o.contact?.name ?? "?")} size={26} color="#5A6373" />
                    <span className="truncate" style={{ maxWidth: 150 }}>{o.contact?.name ?? "—"}</span>
                  </div>
                </td>
                <td>{trashView ? <Pill color="red" dot>{lang === "es" ? "Eliminado" : "Deleted"}</Pill> : o.cancelled_at ? <Pill color="red" dot>{lang === "es" ? "Cancelado" : "Cancelled"}</Pill> : o.stage ? <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td>{o.area ? <Pill color={o.area.color as PillColor}>{o.area.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td>{ag ? <div className="cust"><Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} src={ag.avatar_url ?? undefined} size={22} /><span className="t-sm truncate" style={{ maxWidth: 96 }}>{ag.name}</span></div> : <span className="muted t-sm">—</span>}</td>
                <td><PriorityFlag p={o.priority} lang={lang} /></td>
                <td><span className="t-sm truncate" style={{ display: "inline-block", maxWidth: 170 }}>{item0 ?? "—"}{o.items && o.items.length > 1 ? <span className="muted"> +{o.items.length - 1}</span> : null}</span></td>
                {!personal && <td><div className="row gap-1" style={{ alignItems: "center" }}><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(o.total)}</span>{o.pending_proof && <Pill color="violet" dot title={lang === "es" ? "Comprobante por revisar" : "Receipt to review"}><Icon name="clock" size={10} /></Pill>}</div></td>}
                <td className="t-sm">{o.due_at ? <span className="row gap-1" style={{ color: overdue ? "var(--red)" : "var(--text-muted)", fontWeight: overdue ? 700 : 400 }}>{overdue && <Icon name="clock" size={12} />}{relDate(o.due_at)}</span> : <span className="muted">—</span>}</td>
                <td className="muted t-sm">{o.created_at ? relDate(o.created_at) : "—"}</td>
                {trashView ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row gap-1">
                      <button className="iconbtn sm" title={lang === "es" ? "Restaurar" : "Restore"} onClick={async () => { await setOrderDeleted(o.id, false); reload(); }}><Icon name="refresh" size={15} /></button>
                      <button className="iconbtn sm" style={{ color: "var(--red)" }} title={lang === "es" ? "Eliminar definitivamente" : "Delete permanently"} onClick={async () => { if (!(await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar definitivamente" : "Delete permanently", message: lang === "es" ? "No se puede recuperar." : "This can't be undone.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" }))) return; await purgeOrder(o.id); reload(); }}><Icon name="trash" size={15} /></button>
                    </div>
                  </td>
                ) : <td className="muted t-sm">{relDate(o.updated_at)}</td>}
              </tr>
              );
            })}
            {view.length === 0 && (
              <tr>
                <td colSpan={personal ? 11 : 12} className="muted" style={{ textAlign: "center", padding: 40 }}>
                  {trashView ? (lang === "es" ? "Papelera vacía." : "Trash is empty.") : personal ? (lang === "es" ? "No hay tareas todavía." : "No tasks yet.") : t("empty_orders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="row gap-2" style={{ padding: "10px 4px", alignItems: "center" }}>
          <span className="muted t-sm">{lang === "es" ? "Mostrando" : "Showing"} {curPage * PER + 1}–{Math.min((curPage + 1) * PER, total)} {lang === "es" ? "de" : "of"} {total}</span>
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
          doneFromStageId={doneFromStageId}
          defaultContact={defaultContact}
          products={products}
          contacts={contacts}
          invoice={invoice}
          onClose={() => setShowNew(false)}
          onCreated={reload} // client-fetched window: refresh() wouldn't bring the new order in
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
            reload(); // the table window is client-fetched now, so refresh() alone wouldn't update it
          }}
        />
      )}

      {openOrder && (
        <OrderDrawer
          detail={openOrder}
          stages={stages}
          areas={areas}
          agents={agents}
          products={products}
          businessId={businessId}
          convDetail={convDetail}
          connected={connected}
          shipping={shipping}
          invoicing={invoicing}
          doneFromStageId={doneFromStageId}
          manualMarginPct={manualMarginPct}
          onClose={() => { router.push("/orders", { scroll: false }); reload(); }}
        />
      )}
    </div>
  );
}

export function NewOrderModal({
  businessId, areas, stages, onClose, defaultContact, defaultContactId, products, contacts, embedded, onCreated, invoice, doneFromStageId = null,
}: {
  businessId: string;
  areas: Area[];
  stages: Stage[];
  doneFromStageId?: string | null; // default del negocio (0072) — solo para NOMBRARLO en el dropdown
  onClose: () => void;
  defaultContact?: string;
  defaultContactId?: string | null; // abierto desde un chat: el contacto ya se conoce por id
  products: Product[];
  contacts: { id: string; name: string }[];
  embedded?: boolean;       // render over the chat center column (keep the thread readable)
  onCreated?: () => void;   // called after create instead of router.refresh (e.g. soft refresh)
  invoice?: { add: boolean; rate: number }; // "Requiere factura" config (adds IVA to the total)
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contactName, setContactName] = useState(defaultContact ?? "");
  type Line = { item: string; qty: string; price: string; note?: string; basePrice?: number; tiers?: PriceTier[] };
  const [lines, setLines] = useState<Line[]>([{ item: "", qty: "1", price: "" }]);
  const [priority, setPriority] = useState("normal");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [dueAt, setDueAt] = useState("");
  const [doneFrom, setDoneFrom] = useState(""); // "" = default del negocio
  const [orderNote, setOrderNote] = useState("");
  const [needsInvoice, setNeedsInvoice] = useState(false);
  const [discKind, setDiscKind] = useState<"amount" | "pct">("amount");
  const [discValue, setDiscValue] = useState("");
  const [discNote, setDiscNote] = useState("");
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const discRaw = Number(discValue) || 0;
  const discount = discRaw > 0
    ? Math.min(subtotal, Math.round((discKind === "pct" ? subtotal * (Math.min(100, discRaw) / 100) : discRaw) * 100) / 100)
    : 0;
  const taxRate = needsInvoice && invoice?.add ? (invoice.rate || 0) : 0;
  const tax = Math.round((subtotal - discount) * (taxRate / 100) * 100) / 100;
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
        // Si el nombre escrito coincide exacto con uno de la lista, mandamos su id: entre dos
        // clientes con el mismo nombre, el servidor no puede adivinar cuál es.
        contactId: defaultContactId ?? contacts.find((c) => c.name.trim().toLowerCase() === contactName.trim().toLowerCase())?.id ?? null,
        contactName,
        items: lines.map((l) => ({ item: l.item, qty: Number(l.qty) || 1, price: Number(l.price) || 0, note: l.note })),
        areaId: areaId || null, stageId: stageId || null, priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        doneFromStageId: dueAt && doneFrom ? doneFrom : null,
        note: orderNote,
        requiresInvoice: needsInvoice,
        discount: discRaw > 0 ? { kind: discKind, value: discRaw, note: discNote } : null,
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
              <CatalogPicker products={products} personal={personal} lang={lang} onPick={(p) => addFromCatalog(p.id)} />
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
          {!personal && (
            <label className="row gap-2" style={{ alignItems: "center", cursor: "pointer", paddingTop: 6 }}>
              <input type="checkbox" checked={needsInvoice} onChange={(e) => setNeedsInvoice(e.target.checked)} />
              <span className="t-sm" style={{ fontWeight: 600 }}>{lang === "es" ? "Requiere factura" : "Needs invoice"}</span>
              {needsInvoice && invoice?.add && <Pill color="violet">+{invoice.rate}% IVA</Pill>}
            </label>
          )}
          {!personal && (
            <div className="col gap-1" style={{ paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <span className="grow t-sm" style={{ fontWeight: 600 }}>{lang === "es" ? "Descuento" : "Discount"}</span>
                <div className="seg seg-sm">
                  <button type="button" className={discKind === "amount" ? "on" : ""} onClick={() => setDiscKind("amount")}>$</button>
                  <button type="button" className={discKind === "pct" ? "on" : ""} onClick={() => setDiscKind("pct")}>%</button>
                </div>
                <input className="inp-inline mono" style={{ width: 84, textAlign: "right" }} placeholder={discKind === "pct" ? "0%" : "$0"} value={discValue} onChange={(e) => setDiscValue(e.target.value)} />
              </div>
              {discount > 0 && (
                <input className="inp-inline" style={{ width: "100%" }} placeholder={lang === "es" ? "Motivo del descuento (opcional)" : "Discount reason (optional)"} value={discNote} onChange={(e) => setDiscNote(e.target.value)} />
              )}
              {(taxRate > 0 || discount > 0) && (
                <>
                  <div className="row" style={{ alignItems: "center" }}>
                    <span className="grow t-sm muted">Subtotal</span>
                    <span className="mono t-sm">${formatMoney(subtotal)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="row" style={{ alignItems: "center" }}>
                      <span className="grow t-sm" style={{ color: "var(--green)" }}>{lang === "es" ? "Descuento" : "Discount"}{discKind === "pct" ? ` ${Math.min(100, discRaw)}%` : ""}</span>
                      <span className="mono t-sm" style={{ color: "var(--green)" }}>−${formatMoney(discount)}</span>
                    </div>
                  )}
                  {taxRate > 0 && (
                    <div className="row" style={{ alignItems: "center" }}>
                      <span className="grow t-sm muted">IVA {taxRate}%</span>
                      <span className="mono t-sm">${formatMoney(tax)}</span>
                    </div>
                  )}
                </>
              )}
              <div className="row" style={{ alignItems: "center" }}>
                <span className="grow" style={{ fontWeight: 700 }}>Total</span>
                <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(subtotal - discount + tax)}</span>
              </div>
            </div>
          )}
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
          {/* Igual que en el detalle: solo con fecha límite — sin ella no vive en la agenda y el
              umbral no decide nada. */}
          {dueAt && (
            <div className="grow"><label className="lbl">{lang === "es" ? "Sale de la agenda en" : "Leaves the agenda at"}</label>
              <select className="select" style={{ width: "100%" }} value={doneFrom} onChange={(e) => setDoneFrom(e.target.value)}>
                <option value="">{(() => { const n = defaultDoneStageName(stages, doneFromStageId); return lang === "es" ? `Por defecto del negocio${n ? ` (${n})` : ""}` : `Business default${n ? ` (${n})` : ""}`; })()}</option>
                {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </div>
          )}
          <div className="grow"><label className="lbl">{personal ? (lang === "es" ? "Nota de la tarea (opcional)" : "Task note (optional)") : (lang === "es" ? "Nota del pedido (opcional)" : "Order note (optional)")}</label>
            <textarea className="inp-inline" style={{ width: "100%", minHeight: 54, resize: "vertical", paddingTop: 6 }} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder={lang === "es" ? "Detalles, instrucciones…" : "Details, instructions…"} />
          </div>
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
