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
  const { lang, personal } = useApp();
  const money = (n: number) => "$" + new Intl.NumberFormat("es-MX").format(n);
  const active = Math.max(0, data.orderCount - data.completedCount);
  const trend = personal ? data.createdTrend : data.salesTrend;
  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Reportes" : "Reports"}</h1></div>
      <div className="scroll" style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
          {personal ? (
            <>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="orders" size={15} />{lang === "es" ? "Tareas" : "Tasks"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{data.orderCount}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="clock" size={15} />{lang === "es" ? "Activas" : "Active"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{active}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="check" size={15} />{lang === "es" ? "Completadas" : "Completed"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{data.completedCount}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="chat" size={15} />{lang === "es" ? "Chats resueltos" : "Resolved chats"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{data.resolvedConvs}</div>
              </div>
            </>
          ) : (
            <>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="orders" size={15} />{lang === "es" ? "Ventas" : "Sales"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{money(data.totalSales)}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="kanban" size={15} />{lang === "es" ? "Pedidos" : "Orders"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{data.orderCount}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="orders" size={15} />{lang === "es" ? "Ticket prom." : "Avg ticket"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{money(data.avgTicket)}</div>
              </div>
              <div className="ws-block" style={{ padding: 16 }}>
                <div className="row gap-2 muted t-sm"><Icon name="check" size={15} />{lang === "es" ? "Resueltas" : "Resolved"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6 }} className="mono">{data.resolvedConvs}</div>
              </div>
            </>
          )}
        </div>

        <section className="ws-block" style={{ marginBottom: 20 }}>
          <div className="ws-block-head"><Icon name="orders" size={16} /><h4>{personal ? (lang === "es" ? "Tareas creadas (últimos 7 días)" : "Tasks created (last 7 days)") : (lang === "es" ? "Ventas (últimos 7 días)" : "Sales (last 7 days)")}</h4></div>
          <div className="ws-block-body" style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130, paddingTop: 18 }}>
            {(() => { const max = Math.max(1, ...trend.map((t) => t.value)); return trend.map((t, i) => (
              <div key={i} className="col" style={{ flex: 1, alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                <div className="mono t-xs muted">{t.value ? (personal ? t.value : money(t.value)) : ""}</div>
                <div style={{ width: "70%", maxWidth: 40, height: `${(t.value / max) * 100}%`, minHeight: 2, background: "var(--brand)", borderRadius: "6px 6px 0 0" }} />
                <div className="t-xs muted" style={{ textTransform: "capitalize" }}>{t.label}</div>
              </div>
            )); })()}
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, alignItems: "start" }}>
          <BarList title={lang === "es" ? "Por etapa" : "By stage"} rows={data.byStage} />
          <BarList title={lang === "es" ? "Por área" : "By area"} rows={data.byArea} />
          <BarList title={lang === "es" ? "Por agente" : "By agent"} rows={data.byAgent} />
        </div>
      </div>
    </div>
  );
}
