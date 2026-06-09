"use client";
import React, { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type OrderRow, type PillColor, priorityColor, formatMoney } from "@/lib/types";

type SortKey = "code" | "total" | "updated_at";

export function OrdersTable({ rows, objectName }: { rows: OrderRow[]; objectName: string }) {
  const { t, lang } = useApp();
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

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
        <button className="btn btn-sm btn-ghost" type="button">
          <Icon name="filter" size={14} /> {lang === "es" ? "Filtros" : "Filters"}
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
              <th>{lang === "es" ? "Prioridad" : "Priority"}</th>
              <Sort k="total">{t("col_total")}</Sort>
              <Sort k="updated_at">{t("col_updated")}</Sort>
            </tr>
          </thead>
          <tbody>
            {view.map((o) => (
              <tr key={o.id}>
                <td><span className="mono" style={{ fontWeight: 700 }}>{o.code}</span></td>
                <td>
                  <div className="cust">
                    <Avatar name={o.contact?.name} initials={deriveInitials(o.contact?.name ?? "?")} size={26} color="#5A6373" />
                    <span className="truncate" style={{ maxWidth: 150 }}>{o.contact?.name ?? "—"}</span>
                  </div>
                </td>
                <td>{o.stage ? <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td>{o.area ? <Pill color={o.area.color as PillColor}>{o.area.name}</Pill> : <span className="muted t-sm">—</span>}</td>
                <td><Pill color={priorityColor(o.priority)}><Icon name="dot" size={10} />{o.priority}</Pill></td>
                <td><span className="mono" style={{ fontWeight: 700 }}>${formatMoney(o.total)}</span></td>
                <td className="muted t-sm">{relDate(o.updated_at)}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 40 }}>
                  {t("empty_orders")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
