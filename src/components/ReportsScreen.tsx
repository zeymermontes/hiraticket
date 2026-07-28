"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import type { ReportData } from "@/lib/extras";
import { PRIORITY_LABEL } from "@/lib/types";
import { downloadXlsx, type CellValue } from "@/lib/xlsx";

function BarList({ title, rows, fmt }: { title: string; rows: { name: string; color: string; count: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.count)));
  // Stage/area colors are palette names (→ CSS var); agent colors are raw hex from the profile.
  const fill = (c: string) => (c.startsWith("#") ? c : `var(--${c})`);
  return (
    <section className="ws-block">
      <div className="ws-block-head"><Icon name="layers" size={16} /><h4>{title}</h4></div>
      <div className="ws-block-body col gap-2">
        {rows.map((r) => (
          <div key={r.name} className="row gap-2" style={{ alignItems: "center" }}>
            <span className="t-sm truncate" style={{ width: 120 }} title={r.name}>{r.name}</span>
            <div style={{ flex: 1, height: 10, background: "var(--surface-3)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${(Math.max(0, r.count) / max) * 100}%`, height: "100%", background: fill(r.color) }} />
            </div>
            <span className="mono t-sm" style={{ minWidth: 28, textAlign: "right", whiteSpace: "nowrap" }}>{fmt ? fmt(r.count) : r.count}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="muted t-sm">—</div>}
      </div>
    </section>
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ReportsScreen({ data, from, to }: { data: ReportData; from: string; to: string }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const locale = lang === "es" ? "es-MX" : "en-US";
  const money = (n: number) => "$" + new Intl.NumberFormat("es-MX").format(n);
  const active = Math.max(0, data.orderCount - data.completedCount);
  const trend = personal ? data.createdTrend : data.salesTrend;

  // Product tops (from the range aggregate; already sorted by qty desc).
  const topQty = data.products.slice(0, 5);
  const bottomQty = [...data.products].sort((a, b) => a.qty - b.qty || a.revenue - b.revenue).slice(0, 5);
  const topProfit = [...data.products].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bottomProfit = [...data.products].sort((a, b) => a.profit - b.profit).slice(0, 5);
  const asBars = (rows: { name: string; qty: number; profit: number }[], key: "qty" | "profit", color: string) =>
    rows.map((r) => ({ name: r.name, color, count: key === "qty" ? r.qty : r.profit }));

  const setRange = (f: string, t: string) => router.push(`/reports?from=${f}&to=${t}`);
  const presetRange = (days: number): [string, string] => {
    const today = new Date();
    return [ymd(new Date(today.getTime() - (days - 1) * 86400000)), ymd(today)];
  };
  const presets: { days: number; label: string }[] = [
    { days: 7, label: lang === "es" ? "7 días" : "7 days" },
    { days: 30, label: lang === "es" ? "30 días" : "30 days" },
    { days: 90, label: lang === "es" ? "90 días" : "90 days" },
  ];

  // Trend bar labels: weekday for the 7-day view, short date otherwise; thin out when crowded.
  const barLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale,
      trend.length <= 7 && data.trendStepDays === 1 ? { weekday: "short" } : { day: "2-digit", month: "short" });
  const labelEvery = Math.ceil(trend.length / 12);
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  function exportXlsx() {
    const es = lang === "es";
    const objs = personal ? (es ? "Tareas" : "Tasks") : (es ? "Pedidos" : "Orders");
    const dateHead = es ? "Fecha" : "Date";
    const summary: CellValue[][] = [
      [es ? "Reporte" : "Report", null],
      [es ? "Desde" : "From", from],
      [es ? "Hasta" : "To", to],
      [null, null],
      ...(personal ? [] : [
        [es ? "Ventas" : "Sales", data.totalSales],
        [es ? "Ganancia estimada" : "Estimated profit", data.totalProfit],
        [es ? "Ticket promedio" : "Avg ticket", data.avgTicket],
        [es ? "Descuentos otorgados" : "Discounts granted", data.discountCount],
        [es ? "Total descuentos" : "Total discounts", data.discountTotal],
      ] as CellValue[][]),
      [objs, data.orderCount],
      [personal ? (es ? "Activas" : "Active") : (es ? "Activos" : "Active"), active],
      [personal ? (es ? "Completadas" : "Completed") : (es ? "Completados" : "Completed"), data.completedCount],
      [es ? "Chats resueltos" : "Resolved chats", data.resolvedConvs],
    ];
    const trendRows: CellValue[][] = [
      personal
        ? [dateHead, es ? "Tareas creadas" : "Tasks created"]
        : [dateHead, es ? "Ventas" : "Sales", es ? "Ganancia" : "Profit", es ? "Pedidos creados" : "Orders created"],
      ...data.createdTrend.map((c, i) => personal
        ? [c.date, c.value]
        : [c.date, data.salesTrend[i]?.value ?? 0, Math.round((data.profitTrend[i]?.value ?? 0) * 100) / 100, c.value]),
    ];
    // Per-product aggregate over the range (incl. zero-sale catalog products).
    const topSheet: CellValue[][] = [
      [
        personal ? (es ? "Subtarea" : "Subtask") : (es ? "Producto" : "Product"),
        es ? "Cantidad" : "Qty",
        ...(personal ? [] : [es ? "Ventas" : "Sales", es ? "Ganancia" : "Profit"]),
      ],
      ...data.products.map((p) => [
        p.name, p.qty,
        ...(personal ? [] : [p.revenue, p.profit]),
      ] as CellValue[]),
    ];
    const byRows = (rows: { name: string; count: number }[], head: string): CellValue[][] =>
      [[head, objs], ...rows.map((r) => [r.name, r.count] as CellValue[])];
    const fmtTs = (iso: string | null) => {
      if (!iso) return "";
      const d = new Date(iso);
      return `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const payLabel = (s: string) =>
      s === "paid" ? (es ? "Pagado" : "Paid") : s === "partial" ? (es ? "Parcial" : "Partial") : (es ? "Pendiente" : "Pending");
    const prioLabel = (p: string) => PRIORITY_LABEL[p]?.[lang] ?? p;
    const itemLabel = personal ? (es ? "Subtareas" : "Subtasks") : (es ? "Productos" : "Products");
    const detail: CellValue[][] = [
      [
        es ? "Código" : "Code",
        personal ? (es ? "Contacto" : "Contact") : (es ? "Cliente" : "Customer"),
        es ? "Teléfono" : "Phone",
        es ? "Etapa" : "Stage", es ? "Área" : "Area", es ? "Agente" : "Agent",
        es ? "Prioridad" : "Priority",
        ...(personal ? [] : [es ? "Pago" : "Payment"]),
        itemLabel,
        ...(personal ? [] : [es ? "Descuento" : "Discount", es ? "Motivo desc." : "Disc. reason", "Total", es ? "Pagado" : "Paid", es ? "Saldo" : "Balance"]),
        es ? "Creado" : "Created",
        es ? "Fecha límite" : "Deadline",
        es ? "Actualizado" : "Updated",
      ],
      ...data.orders.map((o) => [
        o.code, o.contact, o.phone, o.stage, o.area, o.agent,
        prioLabel(o.priority),
        ...(personal ? [] : [payLabel(o.pay_status)]),
        o.items.map((it) => `${it.qty}× ${it.name}`).join(" · "),
        ...(personal ? [] : [o.discount || "", o.discount_note ?? "", o.total, o.paid, o.total - o.paid]),
        fmtTs(o.created_at),
        o.due_at ? fmtTs(o.due_at) : "",
        fmtTs(o.updated_at),
      ] as CellValue[]),
    ];
    // One row per line item, linked back to its order by code.
    const itemsSheet: CellValue[][] = [
      [
        personal ? (es ? "Tarea" : "Task") : (es ? "Pedido" : "Order"),
        personal ? (es ? "Contacto" : "Contact") : (es ? "Cliente" : "Customer"),
        personal ? (es ? "Subtarea" : "Subtask") : (es ? "Producto" : "Product"),
        es ? "Cantidad" : "Qty",
        ...(personal ? [] : [es ? "Precio unitario" : "Unit price", "Subtotal"]),
      ],
      ...data.orders.flatMap((o) => o.items.map((it) => [
        o.code, o.contact, it.name, it.qty,
        ...(personal ? [] : [it.unit_price, it.subtotal]),
      ] as CellValue[])),
    ];
    downloadXlsx(`${es ? "reporte" : "report"}-${from}-a-${to}.xlsx`, [
      { name: es ? "Resumen" : "Summary", rows: summary },
      { name: personal ? (es ? "Tareas por día" : "Tasks per day") : (es ? "Ventas por día" : "Sales per day"), rows: trendRows },
      { name: es ? "Por etapa" : "By stage", rows: byRows(data.byStage, es ? "Etapa" : "Stage") },
      { name: es ? "Por área" : "By area", rows: byRows(data.byArea, es ? "Área" : "Area") },
      { name: es ? "Por agente" : "By agent", rows: byRows(data.byAgent, es ? "Agente" : "Agent") },
      { name: personal ? (es ? "Top subtareas" : "Top subtasks") : (es ? "Top productos" : "Top products"), rows: topSheet },
      ...(personal ? [] : [{
        name: es ? "Descuentos" : "Discounts",
        rows: [
          [es ? "Agente" : "Agent", es ? "Descuentos" : "Discounts", es ? "Monto" : "Amount"],
          ...data.byAgentDiscounts.map((a) => [a.name, a.count, a.amount] as CellValue[]),
          [es ? "Total" : "Total", data.discountCount, data.discountTotal],
        ] as CellValue[][],
      }]),
      { name: objs, rows: detail },
      { name: itemLabel, rows: itemsSheet },
    ]);
  }

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Reportes" : "Reports"}</h1></div>

      <div className="toolbar">
        <div className="seg seg-sm">
          {presets.map((p) => {
            const [f, t] = presetRange(p.days);
            return (
              <button key={p.days} className={from === f && to === t ? "on" : ""} onClick={() => setRange(f, t)}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="row gap-1" style={{ alignItems: "center" }}>
          <input type="date" className="select select-sm" value={from} max={to} onChange={(e) => { if (e.target.value) setRange(e.target.value, to); }} />
          <span className="muted t-sm">–</span>
          <input type="date" className="select select-sm" value={to} min={from} max={ymd(new Date())} onChange={(e) => { if (e.target.value) setRange(from, e.target.value); }} />
        </div>
        <span className="grow" />
        <span className="t-sm muted">{fmtDay(from)} – {fmtDay(to)}</span>
        <button className="btn btn-sm btn-outline" type="button" onClick={exportXlsx}>
          <Icon name="file" size={14} /> {lang === "es" ? "Exportar Excel" : "Export Excel"}
        </button>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 24px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${personal ? 4 : 5},1fr)`, gap: 14, marginBottom: 20 }}>
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
                <div className="row gap-2 muted t-sm"><Icon name="sparkles" size={15} />{lang === "es" ? "Ganancia est." : "Est. profit"}</div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: "var(--green)" }} className="mono">{money(Math.round(data.totalProfit))}</div>
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
          <div className="ws-block-head">
            <Icon name="orders" size={16} />
            <h4>{personal ? (lang === "es" ? "Tareas creadas" : "Tasks created") : (lang === "es" ? "Ventas" : "Sales")}</h4>
            {data.trendStepDays > 1 && (
              <span className="t-xs muted" style={{ fontWeight: 400 }}>
                {lang === "es" ? `· cada barra = ${data.trendStepDays} días` : `· each bar = ${data.trendStepDays} days`}
              </span>
            )}
            {!personal && (
              <span className="row gap-2 t-xs muted" style={{ marginLeft: "auto", alignItems: "center", fontWeight: 400 }}>
                <span className="row gap-1" style={{ alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--brand)", opacity: 0.35 }} />{lang === "es" ? "Venta" : "Sale"}</span>
                <span className="row gap-1" style={{ alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--green)" }} />{lang === "es" ? "Ganancia" : "Profit"}</span>
              </span>
            )}
          </div>
          <div className="ws-block-body" style={{ display: "flex", alignItems: "flex-end", gap: trend.length > 14 ? 4 : 10, height: 130, paddingTop: 18 }}>
            {(() => { const max = Math.max(1, ...trend.map((t) => t.value)); return trend.map((t, i) => {
              const prof = personal ? 0 : data.profitTrend[i]?.value ?? 0;
              const pfrac = t.value > 0 ? Math.min(1, Math.max(0, prof / t.value)) : 0;
              const tip = personal
                ? `${fmtDay(t.date)}: ${t.value}`
                : `${fmtDay(t.date)}: ${lang === "es" ? "Venta" : "Sale"} ${money(t.value)} · ${lang === "es" ? "Ganancia" : "Profit"} ${money(Math.round(prof))}`;
              return (
              <div key={t.date} className="col" style={{ flex: 1, alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end", minWidth: 0 }} title={tip}>
                {trend.length <= 14 && <div className="mono t-xs muted">{t.value ? (personal ? t.value : money(t.value)) : ""}</div>}
                {personal ? (
                  <div style={{ width: "70%", maxWidth: 40, height: `${(t.value / max) * 100}%`, minHeight: 2, background: "var(--brand)", borderRadius: "6px 6px 0 0" }} />
                ) : (
                  <div style={{ width: "70%", maxWidth: 40, height: `${(t.value / max) * 100}%`, minHeight: 2, borderRadius: "6px 6px 0 0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ flex: 1 - pfrac, background: "var(--brand)", opacity: 0.35 }} />
                    <div style={{ flex: pfrac, background: "var(--green)" }} />
                  </div>
                )}
                <div className="t-xs muted truncate" style={{ textTransform: "capitalize", maxWidth: "100%" }}>{i % labelEvery === 0 ? barLabel(t.date) : " "}</div>
              </div>
            ); }); })()}
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16, alignItems: "start", marginBottom: 20 }}>
          <BarList title={personal ? (lang === "es" ? "Subtareas más frecuentes" : "Most frequent subtasks") : (lang === "es" ? "Productos más vendidos" : "Best sellers")} rows={asBars(topQty, "qty", "brand")} />
          <BarList title={personal ? (lang === "es" ? "Subtareas menos frecuentes" : "Least frequent subtasks") : (lang === "es" ? "Productos menos vendidos" : "Worst sellers")} rows={asBars(bottomQty, "qty", "slate")} />
          {!personal && <BarList title={lang === "es" ? "Mayor ganancia" : "Top profit"} rows={asBars(topProfit, "profit", "green")} fmt={(n) => money(Math.round(n))} />}
          {!personal && <BarList title={lang === "es" ? "Menor ganancia" : "Lowest profit"} rows={asBars(bottomProfit, "profit", "amber")} fmt={(n) => money(Math.round(n))} />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, alignItems: "start" }}>
          <BarList title={lang === "es" ? "Por etapa" : "By stage"} rows={data.byStage} />
          <BarList title={lang === "es" ? "Por área" : "By area"} rows={data.byArea} />
          <BarList title={lang === "es" ? "Por agente" : "By agent"} rows={data.byAgent} />
          {/* Los cancelados ya salieron de ventas y utilidad. Se muestran aquí para que no
              "desaparezcan" sin explicación cuando alguien cuadre las cifras del periodo. */}
          {data.cancelledCount > 0 && (
            <section className="ws-block">
              <div className="ws-block-head">
                <Icon name="clock" size={16} />
                <h4>{personal ? (lang === "es" ? "Tareas canceladas" : "Cancelled tasks") : (lang === "es" ? "Pedidos cancelados" : "Cancelled orders")}</h4>
                <span className="t-xs muted" style={{ fontWeight: 400, marginLeft: "auto" }}>
                  {lang === "es" ? "no cuentan como venta" : "not counted as sales"}
                </span>
              </div>
              <div className="ws-block-body row gap-4" style={{ flexWrap: "wrap" }}>
                <div>
                  <div className="t-xs muted">{lang === "es" ? "Cancelados" : "Cancelled"}</div>
                  <div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{data.cancelledCount}</div>
                </div>
                {!personal && (
                  <div>
                    <div className="t-xs muted">{lang === "es" ? "Valor cancelado" : "Cancelled value"}</div>
                    <div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{money(Math.round(data.cancelledTotal))}</div>
                  </div>
                )}
                {!personal && data.refundedTotal > 0 && (
                  <div>
                    <div className="t-xs muted">{lang === "es" ? "Reembolsado" : "Refunded"}</div>
                    <div className="mono" style={{ fontWeight: 800, fontSize: 20, color: "var(--red)" }}>{money(Math.round(data.refundedTotal))}</div>
                  </div>
                )}
              </div>
            </section>
          )}
          {!personal && (
            <section className="ws-block">
              <div className="ws-block-head">
                <Icon name="tag" size={16} /><h4>{lang === "es" ? "Descuentos por agente" : "Discounts by agent"}</h4>
                <span className="t-xs muted" style={{ fontWeight: 400, marginLeft: "auto" }}>
                  {data.discountCount} · {money(Math.round(data.discountTotal))}
                </span>
              </div>
              <div className="ws-block-body col gap-2">
                {(() => { const max = Math.max(1, ...data.byAgentDiscounts.map((a) => a.amount)); return data.byAgentDiscounts.map((a) => (
                  <div key={a.id} className="row gap-2" style={{ alignItems: "center" }}>
                    <span className="t-sm truncate" style={{ width: 120 }} title={a.name}>{a.name}</span>
                    <div style={{ flex: 1, height: 10, background: "var(--surface-3)", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ width: `${(a.amount / max) * 100}%`, height: "100%", background: a.color.startsWith("#") ? a.color : `var(--${a.color})` }} />
                    </div>
                    <span className="mono t-sm" style={{ whiteSpace: "nowrap" }}>{a.count} · {money(Math.round(a.amount))}</span>
                  </div>
                )); })()}
                {data.byAgentDiscounts.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin descuentos en el periodo." : "No discounts in this period."}</div>}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
