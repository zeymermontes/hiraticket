"use client";
import React from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import type { ReportData } from "@/lib/extras";

function BarList({ title, rows }: { title: string; rows: { name: string; color: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="ws-block">
      <div className="ws-block-head"><Icon name="layers" size={16} /><h4>{title}</h4></div>
      <div className="ws-block-body col gap-2">
        {rows.map((r) => (
          <div key={r.name} className="row gap-2" style={{ alignItems: "center" }}>
            <span className="t-sm truncate" style={{ width: 120 }}>{r.name}</span>
            <div style={{ flex: 1, height: 10, background: "var(--surface-3)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", background: `var(--${r.color})` }} />
            </div>
            <span className="mono t-sm" style={{ width: 28, textAlign: "right" }}>{r.count}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="muted t-sm">—</div>}
      </div>
    </section>
  );
}

export function ReportsScreen({ data }: { data: ReportData }) {
  const { lang } = useApp();
  const money = (n: number) => "$" + new Intl.NumberFormat("es-MX").format(n);
  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Reportes" : "Reports"}</h1></div>
      <div className="scroll" style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20 }}>
          <div className="ws-block" style={{ padding: 16 }}>
            <div className="row gap-2 muted t-sm"><Icon name="orders" size={15} />{lang === "es" ? "Ventas" : "Sales"}</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }} className="mono">{money(data.totalSales)}</div>
          </div>
          <div className="ws-block" style={{ padding: 16 }}>
            <div className="row gap-2 muted t-sm"><Icon name="kanban" size={15} />{lang === "es" ? "Pedidos" : "Orders"}</div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }} className="mono">{data.orderCount}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, alignItems: "start" }}>
          <BarList title={lang === "es" ? "Por etapa" : "By stage"} rows={data.byStage} />
          <BarList title={lang === "es" ? "Por área" : "By area"} rows={data.byArea} />
          <BarList title={lang === "es" ? "Por agente" : "By agent"} rows={data.byAgent} />
        </div>
      </div>
    </div>
  );
}
