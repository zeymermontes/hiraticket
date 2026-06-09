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
import { createOrder } from "@/app/(app)/orders/actions";

type SortKey = "code" | "total" | "updated_at";

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

  useEffect(() => { if (autoOpen) setShowNew(true); }, [autoOpen]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((o) =>
      !needle ||
      o.code.toLowerCase().includes(needle) ||
      (o.contact?.name ?? "").toLowerCase().includes(needle),
    );
    const sorted = [...filtered].sort((a, b) => {
      let av: string | number, bv: string | number;
      if (sortKey === "total") { av = a.total; bv = b.total; }
      else if (sortKey === "updated_at") { av = a.updated_at; bv = b.updated_at; }
      else { av = a.code; bv = b.code; }
      const r = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? r : -r;
    });
    return sorted;
  }, [rows, q, sortKey, dir]);

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

  return (
    <div className="page">
      <div className="phead">
        <h1>{objectName}</h1>
        <Pill color="slate" large>{view.length}</Pill>
        <span className="grow" />
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 240 }}>
          <Icon name="search" />
          <input
            placeholder={t("search_ph")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <span className="grow" />
        <button className="btn btn-sm btn-primary" type="button" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} /> {t("new_order")}
        </button>
      </div>

      <div className="tablewrap scroll">
        <table className="tbl">
          <thead>
            <tr>
              <Sort k="code">{t("col_order")}</Sort>
              <th>{t("col_customer")}</th>
              <th>{t("col_status")}</th>
              <th>{t("col_area")}</th>
              <th>{lang === "es" ? "Agente" : "Agent"}</th>
              <th>{lang === "es" ? "Prioridad" : "Priority"}</th>
              <th>{lang === "es" ? "Artículos" : "Items"}</th>
              <Sort k="total">{t("col_total")}</Sort>
              <Sort k="updated_at">{t("col_updated")}</Sort>
            </tr>
          </thead>
          <tbody>
            {view.map((o) => {
              const ag = o.assignee_id ? agentMap.get(o.assignee_id) : null;
              const item0 = o.items?.[0]?.name;
              return (
              <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/orders?order=${o.id}`, { scroll: false })}>
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
                <td><Pill color={priorityColor(o.priority)}><Icon name="dot" size={10} />{o.priority}</Pill></td>
                <td><span className="t-sm truncate" style={{ display: "inline-block", maxWidth: 170 }}>{item0 ?? "—"}{o.items && o.items.length > 1 ? <span className="muted"> +{o.items.length - 1}</span> : null}</span></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(o.total)}</span></td>
                <td className="muted t-sm">{relDate(o.updated_at)}</td>
              </tr>
              );
            })}
            {view.length === 0 && (
              <tr>
                <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 40 }}>
                  {t("empty_orders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showNew && (
        <NewOrderModal
          businessId={businessId}
          areas={areas}
          stages={stages}
          defaultContact={defaultContact}
          onClose={() => setShowNew(false)}
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
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");

  function submit() {
    if (!contactName.trim() || !item.trim()) return;
    start(async () => {
      await createOrder(businessId, {
        contactName, item, qty: Number(qty) || 1, price: Number(price) || 0,
        areaId: areaId || null, stageId: stageId || null,
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
