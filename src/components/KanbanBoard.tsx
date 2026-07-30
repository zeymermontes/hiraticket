"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { doneStageNames } from "@/lib/doneStage";
import { Spinner } from "@/components/Spinner";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useFlowToast } from "@/components/Toast";
import { type PillColor, priorityColor, isOverdue, PRIORITY_LABEL as PRIO } from "@/lib/types";
import { KANBAN_PAGE, type KanbanOrder, type KanbanItem, type KanbanFilters, type KanbanBoardData } from "@/lib/kanban";
import { loadKanbanBoard, loadKanbanColumn } from "@/app/(app)/kanban/actions";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import type { Product as CatalogProduct } from "@/lib/extras";
import type { OrderDetail } from "@/lib/orders";
import { OrderDrawer } from "@/components/OrderDrawer";
import { loadOrderDetail, setItemStage } from "@/app/(app)/orders/actions";
import { moveOrderStage, moveOrderArea } from "@/app/(app)/actions";

export function KanbanBoard({
  initial, stages, areas, agents, catalog = [], businessId, connected, productStages = false, shipping, invoicing, doneFromStageId = null,
}: {
  initial: KanbanBoardData; // counts + first page of each column (board opens grouped by stage)
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
  catalog?: CatalogProduct[];
  businessId: string;
  connected: boolean;
  productStages?: boolean;
  shipping?: string | null;
  invoicing?: boolean;
  doneFromStageId?: string | null;
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const flowToast = useFlowToast();
  const [, start] = useTransition();
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const openDrawer = (id: string) => { setLoadingId(id); startLoad(async () => { const d = await loadOrderDetail(id); setOpenOrder(d); setLoadingId(null); }); };
  const [view, setView] = useState<"orders" | "products">("orders");
  const [group, setGroup] = useState<"status" | "area">("status");
  const [sortCode, setSortCode] = useState<"" | "asc" | "desc">(""); // sort by the HIR- number
  const [q, setQ] = useState("");
  const [areaF, setAreaF] = useState("");
  const [assigneeF, setAssigneeF] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const products = productStages && view === "products";
  const effGroup = products ? "status" : group;
  const columns = effGroup === "status"
    ? stages.map((s) => ({ id: s.id, label: s.name, color: s.color }))
    : areas.map((a) => ({ id: a.id, label: a.name, color: a.color }));

  // --- ventana por columna ------------------------------------------------------------------
  // Un tablero no se puede ventanear en conjunto: su contrato es "esta columna tiene N". Así que
  // cada columna pagina sola y el badge lee el total del servidor (RPC kanban_counts, 0063).
  const [cols, setCols] = useState<KanbanBoardData["columns"]>(initial.columns);
  const [counts, setCounts] = useState<Record<string, number>>(initial.counts);
  const [colLoading, setColLoading] = useState<Record<string, boolean>>({});
  const [boardLoading, setBoardLoading] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 250); return () => clearTimeout(t); }, [q]);

  const filters: KanbanFilters = useMemo(() => ({
    q: debouncedQ,
    areaId: areaF || undefined,
    assigneeId: assigneeF || undefined,
    group: effGroup,
    products,
    sortCode,
  }), [debouncedQ, areaF, assigneeF, effGroup, products, sortCode]);

  const colIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const colIdsKey = colIds.join(",");

  // Only the newest response may land — switching view/group refires while a fetch is in flight.
  const seq = useRef(0);
  const refetch = useCallback(async (f: KanbanFilters, ids: string[]) => {
    const mine = ++seq.current;
    setBoardLoading(true);
    try {
      const b = await loadKanbanBoard(ids, f);
      if (mine !== seq.current) return;
      setCols(b.columns);
      setCounts(b.counts);
    } catch { /* keep what's on screen */ }
    finally { if (mine === seq.current) setBoardLoading(false); }
  }, []);

  // `initial` already is this exact board, so skip the duplicate fetch on mount.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    refetch(filters, colIdsKey.split(","));
  }, [refetch, filters, colIdsKey]);

  const colCards = (colId: string) => cols[colId] ?? [];
  const colTotal = (colId: string) => counts[colId] ?? colCards(colId).length;

  /** Next page of ONE column, appended. */
  const loadMore = useCallback(async (colId: string) => {
    if (colLoading[colId]) return;
    const loaded = (cols[colId] ?? []).length;
    if (loaded >= (counts[colId] ?? 0)) return;
    setColLoading((s) => ({ ...s, [colId]: true }));
    try {
      const more = await loadKanbanColumn(colId, filters, loaded);
      setCols((c) => {
        const cur = c[colId] ?? [];
        // De-dupe by id: a card moved by someone else can shift the offset under us.
        const seen = new Set(cur.map((x) => x.id));
        return { ...c, [colId]: [...cur, ...(more as typeof cur).filter((x) => !seen.has(x.id))] };
      });
    } catch { /* silencio: reintenta al seguir scrolleando */ }
    finally { setColLoading((s) => ({ ...s, [colId]: false })); }
  }, [cols, counts, colLoading, filters]);

  const onColScroll = (colId: string) => (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore(colId);
  };

  function onDrop(colId: string) {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (!id) return;

    // Optimista: la tarjeta salta de columna al instante y los dos contadores se ajustan. Con la
    // columna paginada, esperar al refetch dejaba la tarjeta congelada en el origen.
    let from: string | null = null;
    setCols((c) => {
      const next = { ...c };
      for (const [k, list] of Object.entries(next)) {
        const hit = list.find((x) => x.id === id);
        if (!hit) continue;
        from = k;
        next[k] = list.filter((x) => x.id !== id) as typeof list;
        next[colId] = [hit, ...(next[colId] ?? [])] as typeof list;
        break;
      }
      return next;
    });
    if (from && from !== colId) {
      const src = from;
      setCounts((n) => ({ ...n, [src]: Math.max((n[src] ?? 1) - 1, 0), [colId]: (n[colId] ?? 0) + 1 }));
    }

    start(async () => {
      if (products) await setItemStage(id, colId);
      else if (effGroup === "status") { const r = await moveOrderStage(id, colId); flowToast(r.flows, lang); }
      else await moveOrderArea(id, colId);
      refetch(filters, colIds); // reconcilia contra el servidor (flows pueden mover más cosas)
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>Kanban</h1>
        <span className="grow" />
        {productStages && (
          <div className="seg" style={{ marginRight: 8 }}>
            <button className={view === "orders" ? "on" : ""} onClick={() => setView("orders")}><Icon name="orders" size={14} />{personal ? (lang === "es" ? "Tareas" : "Tasks") : (lang === "es" ? "Pedidos" : "Orders")}</button>
            <button className={view === "products" ? "on" : ""} onClick={() => setView("products")}><Icon name="layers" size={14} />{personal ? (lang === "es" ? "Subtareas" : "Subtasks") : (lang === "es" ? "Productos" : "Products")}</button>
          </div>
        )}
        {!products && <>
          <span className="t-sm muted" style={{ fontWeight: 600 }}>{lang === "es" ? "Agrupar por" : "Group by"}</span>
          <div className="seg">
            <button className={group === "status" ? "on" : ""} onClick={() => setGroup("status")}><Icon name="kanban" size={14} />{lang === "es" ? "Etapa" : "Stage"}</button>
            <button className={group === "area" ? "on" : ""} onClick={() => setGroup("area")}><Icon name="layers" size={14} />{lang === "es" ? "Área" : "Area"}</button>
          </div>
          <button className={"chip" + (sortCode ? " on" : "")} onClick={() => setSortCode((s) => (s === "" ? "asc" : s === "asc" ? "desc" : ""))} title={lang === "es" ? "Ordenar por número (HIR-)" : "Sort by number (HIR-)"}><Icon name="orders" size={13} />{lang === "es" ? "Por ID" : "By ID"}{sortCode && <span style={{ marginLeft: 1, fontWeight: 800 }}>{sortCode === "asc" ? "↑" : "↓"}</span>}</button>
        </>}
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
            const cards = colCards(col.id);
            const list = (products ? [] : cards) as KanbanOrder[];
            const itemList = (products ? cards : []) as KanbanItem[];
            const total = colTotal(col.id);
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
                  {/* Total real de la columna, no lo que se alcanzó a cargar. */}
                  <span className="badge badge-soft">{total}</span>
                  <span className="grow" />
                  {colLoading[col.id] && <Spinner size={13} />}
                </div>
                <div className="kcol-list scroll" onScroll={onColScroll(col.id)}>
                  {products && itemList.map((it) => {
                    const ag = it.assignee_id ? agentMap.get(it.assignee_id) : null;
                    return (
                      <div key={it.id} className={"kcard" + (drag === it.id ? " dragging" : "")} draggable
                        onDragStart={() => setDrag(it.id)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                        <div className="row gap-2">
                          <span className="mono t-xs" style={{ fontWeight: 700, color: "var(--text-muted)" }}>{it.order_code}</span>
                          {it.priority && it.priority !== "normal" && <Pill color={priorityColor(it.priority as never)}><Icon name="flag" size={10} />{PRIO[it.priority]?.[lang] ?? it.priority}</Pill>}
                        </div>
                        <div className="truncate" style={{ fontWeight: 600, fontSize: 13, marginTop: 6 }}>{it.name}{it.qty > 1 ? <span className="muted"> ×{it.qty}</span> : null}</div>
                        <div className="row gap-2" style={{ marginTop: 6 }}>
                          <Avatar name={it.contact?.name} initials={deriveInitials(it.contact?.name ?? "?")} size={20} />
                          <span className="t-xs muted truncate">{it.contact?.name ?? "—"}</span>
                        </div>
                        <div className="kcard-foot">
                          {ag ? <span className="row gap-1" style={{ alignItems: "center", minWidth: 0 }}><Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} src={ag.avatar_url ?? undefined} size={20} /><span className="t-xs muted truncate" style={{ maxWidth: 96 }}>{ag.name}</span></span> : null}
                          <span className="grow" />
                          <button className="btn btn-sm btn-outline" style={{ height: 26, padding: "0 8px" }} disabled={loadingId === it.order_id}
                            onClick={(e) => { e.stopPropagation(); openDrawer(it.order_id); }} onPointerDown={(e) => e.stopPropagation()}>
                            {loadingId === it.order_id ? "…" : (lang === "es" ? "Abrir" : "Open")}<Icon name="arrowr" size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!products && list.map((o) => (
                    <div key={o.id} className={"kcard" + (drag === o.id ? " dragging" : "")} draggable
                      onDragStart={() => setDrag(o.id)} onDragEnd={() => { setDrag(null); setOver(null); }}>
                      <div className="row gap-2">
                        <span className="mono t-xs" style={{ fontWeight: 700, color: "var(--text-muted)" }}>{o.code}</span>
                        {/* Cancelado desplaza a la prioridad: es lo que hay que leer primero. */}
                        {o.cancelled_at
                          ? <Pill color="red" dot>{lang === "es" ? "Cancelado" : "Cancelled"}</Pill>
                          : o.priority && o.priority !== "normal" && <Pill color={priorityColor(o.priority as never)}><Icon name="flag" size={10} />{PRIO[o.priority]?.[lang] ?? o.priority}</Pill>}
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
                        {(() => { const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null; return ag ? <span className="row gap-1" style={{ alignItems: "center", minWidth: 0 }}><Avatar name={ag.name} initials={deriveInitials(ag.name)} color={ag.color} src={ag.avatar_url ?? undefined} size={20} /><span className="t-xs muted truncate" style={{ maxWidth: 96 }}>{ag.name}</span></span> : null; })()}
                        <span className="grow" />
                        {o.due_at && (() => { const od = isOverdue(o.due_at, !!o.stage && doneStageNames(stages, doneFromStageId).has(o.stage.name)); return <span className="row gap-1" style={{ color: od ? "var(--red)" : "var(--text-muted)", fontWeight: od ? 700 : 500, fontSize: 11.5 }}><Icon name={od ? "clock" : "calendar"} size={11} />{new Date(o.due_at!).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}</span>; })()}
                        {!personal && o.pending_proof && <Pill color="violet" dot title={lang === "es" ? "Comprobante por revisar" : "Receipt to review"}><Icon name="clock" size={10} /></Pill>}
                        {!personal && <span className="kcard-meta"><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>${o.total.toLocaleString("es-MX")}</span></span>}
                        <button className="btn btn-sm btn-outline" style={{ height: 26, padding: "0 8px" }} disabled={loadingId === o.id}
                          onClick={(e) => { e.stopPropagation(); openDrawer(o.id); }} onPointerDown={(e) => e.stopPropagation()}>
                          {loadingId === o.id ? "…" : (lang === "es" ? "Abrir" : "Open")}<Icon name="arrowr" size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && !boardLoading && <div className="center" style={{ padding: "20px 0", color: "var(--text-faint)", fontSize: 12 }}>{lang === "es" ? "Vacío" : "Empty"}</div>}
                  {cards.length > 0 && cards.length < total && (
                    <button className="btn btn-sm btn-ghost" style={{ width: "100%", margin: "6px 0" }}
                      disabled={!!colLoading[col.id]} onClick={() => loadMore(col.id)}>
                      {colLoading[col.id]
                        ? (lang === "es" ? "Cargando…" : "Loading…")
                        : `${lang === "es" ? "Cargar más" : "Load more"} (${cards.length}/${total})`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {openOrder && (
        <OrderDrawer detail={openOrder} stages={stages} areas={areas} agents={agents} products={catalog} businessId={businessId}
          convDetail={null} connected={connected} shipping={shipping} invoicing={invoicing} doneFromStageId={doneFromStageId}
          onClose={() => { setOpenOrder(null); router.refresh(); }} />
      )}
    </div>
  );
}
