"use client";
import React, { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type OrderRow, type PillColor, priorityColor, formatMoney } from "@/lib/types";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import type { OrderDetail } from "@/lib/orders";
import type { ConvDetail } from "@/lib/chat";
import { OrderDrawer } from "@/components/OrderDrawer";
import { TransferModal } from "@/components/TransferModal";
import { createOrder, assignOrder, addOrderNote } from "@/app/(app)/orders/actions";
import { moveOrderArea } from "@/app/(app)/actions";

type SortKey = "code" | "total" | "updated_at" | "created_at";

const PRIO_LABEL: Record<string, { es: string; en: string }> = {
  low: { es: "Baja", en: "Low" }, normal: { es: "Normal", en: "Normal" },
  high: { es: "Alta", en: "High" }, urgent: { es: "Urgente", en: "Urgent" },
};

function PriorityFlag({ p, lang }: { p: string; lang: "es" | "en" }) {
  return <Pill color={priorityColor(p as never)}><Icon name="flag" size={11} />{PRIO_LABEL[p]?.[lang] ?? p}</Pill>;
}

export function OrdersTable({
  rows, objectName, businessId, areas, stages, agents, openOrder, autoOpen, defaultContact, convDetail, connected,
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
}) {
  const { t, lang } = useApp();
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
      else { av = a.code; bv = b.code; }
      const r = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? r : -r;
    });
    return sorted;
  }, [rows, q, sortKey, dir, stageF, areaF, assigneeF, prioF]);

  const pageCount = Math.max(1, Math.ceil(sortedAll.length / PER));
  const view = useMemo(() => sortedAll.slice(page * PER, page * PER + PER), [sortedAll, page]);

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
    const head = ["Code", "Customer", "Stage", "Area", "Agent", "Priority", "Total", "Created", "Updated"];
    const lines = sortedAll.map((o) => [o.code, o.contact?.name ?? "", o.stage?.name ?? "", o.area?.name ?? "", (o.assignee_id && agentMap.get(o.assignee_id)?.name) || "", o.priority, o.total, o.created_at ?? "", o.updated_at].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
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
              <th style={{ width: 32 }}><input type="checkbox" checked={view.length > 0 && view.every((o) => sel.has(o.id))} onChange={(e) => setSel(e.target.checked ? new Set(view.map((o) => o.id)) : new Set())} /></th>
              <Sort k="code">{t("col_order")}</Sort>
              <th>{t("col_customer")}</th>
              <th>{t("col_status")}</th>
              <th>{t("col_area")}</th>
              <th>{lang === "es" ? "Agente" : "Agent"}</th>
              <th>{lang === "es" ? "Prioridad" : "Priority"}</th>
              <th>{lang === "es" ? "Artículos" : "Items"}</th>
              <Sort k="total">{t("col_total")}</Sort>
              <Sort k="created_at">{lang === "es" ? "Creado" : "Created"}</Sort>
              <Sort k="updated_at">{t("col_updated")}</Sort>
            </tr>
          </thead>
          <tbody>
            {view.map((o) => {
              const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null;
              const item0 = o.items?.[0]?.name;
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
                <td><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(o.total)}</span></td>
                <td className="muted t-sm">{o.created_at ? relDate(o.created_at) : "—"}</td>
                <td className="muted t-sm">{relDate(o.updated_at)}</td>
              </tr>
              );
            })}
            {view.length === 0 && (
              <tr>
                <td colSpan={11} className="muted" style={{ textAlign: "center", padding: 40 }}>
                  {t("empty_orders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="row gap-2" style={{ padding: "10px 4px", alignItems: "center" }}>
          <span className="muted t-sm">{lang === "es" ? "Mostrando" : "Showing"} {page * PER + 1}–{Math.min((page + 1) * PER, sortedAll.length)} {lang === "es" ? "de" : "of"} {sortedAll.length}</span>
          <span className="grow" />
          <button className="btn btn-sm btn-outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹</button>
          <span className="t-sm">{page + 1} / {pageCount}</span>
          <button className="btn btn-sm btn-outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>›</button>
        </div>
      )}

      {showNew && (
        <NewOrderModal
          businessId={businessId}
          areas={areas}
          stages={stages}
          defaultContact={defaultContact}
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

function NewOrderModal({
  businessId, areas, stages, onClose, defaultContact,
}: {
  businessId: string;
  areas: Area[];
  stages: Stage[];
  onClose: () => void;
  defaultContact?: string;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [contactName, setContactName] = useState(defaultContact ?? "");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [priority, setPriority] = useState("normal");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const subtotal = (Number(qty) || 0) * (Number(price) || 0);

  function submit() {
    if (!contactName.trim() || !item.trim()) return;
    start(async () => {
      await createOrder(businessId, {
        contactName, item, qty: Number(qty) || 1, price: Number(price) || 0,
        areaId: areaId || null, stageId: stageId || null, priority,
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog">
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="orders" /></span>
          <h3 className="grow">{lang === "es" ? "Nuevo pedido" : "New order"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-2">
          <label className="lbl">{lang === "es" ? "Cliente" : "Customer"}</label>
          <input className="inp-inline" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={lang === "es" ? "Nombre del cliente" : "Customer name"} />
          <label className="lbl">{lang === "es" ? "Artículo" : "Item"}</label>
          <input className="inp-inline" value={item} onChange={(e) => setItem(e.target.value)} placeholder={lang === "es" ? "Descripción" : "Description"} />
          <div className="row gap-2">
            <div className="grow"><label className="lbl">{lang === "es" ? "Cantidad" : "Qty"}</label><input className="inp-inline" style={{ width: "100%" }} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div className="grow"><label className="lbl">{lang === "es" ? "Precio unit." : "Unit price"}</label><input className="inp-inline" style={{ width: "100%" }} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$" /></div>
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
          <div className="row" style={{ paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", alignItems: "center" }}>
            <span className="grow" style={{ fontWeight: 700 }}>{lang === "es" ? "Subtotal" : "Subtotal"}</span>
            <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>${formatMoney(subtotal)}</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !contactName.trim() || !item.trim()} onClick={submit}><Icon name="plus" size={15} />{lang === "es" ? "Crear pedido" : "Create order"}</button>
        </div>
      </div>
    </div>
  );
}
