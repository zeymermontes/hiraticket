import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { doneStageIds } from "@/lib/doneStage";
import { getAgents } from "@/lib/chat";
import { getStages, getAreas } from "@/lib/business";
import type { PriceTier } from "@/lib/types";

export interface Automation {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  trigger_config: Record<string, unknown>;
  enabled: boolean;
  runs: number;
}
export async function getAutomations(businessId: string): Promise<Automation[]> {
  const supabase = await createClient();
  // trigger_config (0043) may not be applied yet — fall back without it.
  let { data, error } = await supabase
    .from("automations")
    .select("id, name, trigger_type, trigger_value, action_type, action_payload, trigger_config, enabled, runs")
    .eq("business_id", businessId)
    .order("name");
  if (error) {
    const r = await supabase.from("automations")
      .select("id, name, trigger_type, trigger_value, action_type, action_payload, enabled, runs")
      .eq("business_id", businessId).order("name");
    data = r.data as typeof data;
  }
  return (data ?? []).map((w) => ({ ...(w as Automation), trigger_config: ((w as { trigger_config?: Record<string, unknown> }).trigger_config) ?? {} })) as Automation[];
}

export interface Product {
  id: string; name: string; kind: "product" | "service"; price: number; active: boolean; price_tiers: PriceTier[];
  cost: number | null; // what it costs the business (null = unknown → default margin applies in reports)
}
async function _getProducts(businessId: string): Promise<Product[]> {
  const supabase = await createClient();
  // Resilient to a not-yet-applied 0057 (cost) / 0024 (price_tiers).
  let { data, error } = await supabase
    .from("products").select("id, name, kind, price, active, price_tiers, cost")
    .eq("business_id", businessId).order("created_at");
  if (error) {
    const r1 = await supabase.from("products").select("id, name, kind, price, active, price_tiers").eq("business_id", businessId).order("created_at");
    data = (r1.data ?? []) as typeof data;
    if (r1.error) {
      const r = await supabase.from("products").select("id, name, kind, price, active").eq("business_id", businessId).order("created_at");
      data = (r.data ?? []) as typeof data;
    }
  }
  return (data ?? []).map((p) => {
    const t = (p as { price_tiers?: unknown }).price_tiers;
    const c = (p as { cost?: unknown }).cost;
    return { ...p, price_tiers: Array.isArray(t) ? (t as PriceTier[]) : [], cost: c == null ? null : Number(c) };
  }) as Product[];
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getProducts = cache(_getProducts);

export interface Appointment {
  id: string; title: string; starts_at: string; status: string;
  contact: { name: string } | null;
}
/** Un pedido (o tarea, en modo personal) con fecha límite, para la agenda y las banderitas. */
export interface DueOrder {
  id: string; code: string; due_at: string; total: number; priority: string | null;
  contact: { name: string } | null;
}

/**
 * Pedidos abiertos con fecha límite: vencidos (hasta 60 días atrás) y por vencer (próximos 7 días).
 *
 * "Terminado" ya no es solo la etapa final: el negocio elige su umbral en Ajustes y cada pedido
 * puede sobreescribirlo (0072) —- por eso el filtro corre AQUÍ y no en SQL: el umbral efectivo
 * varía por pedido. La ventana trae ≤200 filas, así que filtrar en memoria es gratis.
 */
export async function getDueOrders(
  businessId: string,
  stages: { id: string }[],
  businessDoneFrom: string | null,
): Promise<DueOrder[]> {
  const supabase = await createClient();
  const from = new Date(Date.now() - 60 * 86400000).toISOString();
  const to = new Date(Date.now() + 7 * 86400000).toISOString();
  const build = (cols: string, cancelled: boolean) => {
    let q = supabase.from("orders").select(cols)
      .eq("business_id", businessId).not("due_at", "is", null)
      .gte("due_at", from).lte("due_at", to)
      .is("deleted_at", null);
    if (cancelled) q = q.is("cancelled_at", null);
    return q.order("due_at", { ascending: true }).limit(200);
  };
  const COLS = "id, code, due_at, total, priority, stage_id, contact:contacts(name)";
  // done_from_stage_id (0072) / cancelled_at (0065) pueden no existir aún — cascada.
  let { data, error } = await build(COLS + ", done_from_stage_id", true);
  if (error) ({ data, error } = await build(COLS, true));
  if (error) ({ data } = await build(COLS, false));
  type Row = DueOrder & { stage_id: string | null; done_from_stage_id?: string | null };
  const rows = (data ?? []) as unknown as Row[];
  // El set de "terminado" depende del umbral; se memoiza por umbral para no rearmarlo por fila.
  const setsByThreshold = new Map<string, Set<string>>();
  const doneSet = (threshold: string | null) => {
    const key = threshold ?? "";
    let hit = setsByThreshold.get(key);
    if (!hit) { hit = doneStageIds(stages, threshold); setsByThreshold.set(key, hit); }
    return hit;
  };
  return rows.filter((r) => !r.stage_id || !doneSet(r.done_from_stage_id ?? businessDoneFrom).has(r.stage_id));
}

export async function getAppointments(businessId: string): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments").select("id, title, starts_at, status, contact:contacts(name)")
    .eq("business_id", businessId).order("starts_at", { ascending: true });
  return (data ?? []) as unknown as Appointment[];
}

export interface Campaign {
  id: string; name: string; template: string | null; audience: string | null;
  recipients: number; delivered: number; read: number; sent_at: string | null;
}
export async function getCampaigns(businessId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns").select("id, name, template, audience, recipients, delivered, read, sent_at")
    .eq("business_id", businessId).order("created_at", { ascending: false });
  return (data ?? []) as Campaign[];
}

export interface ReportRange {
  from: string; // YYYY-MM-DD (inclusive)
  to: string;   // YYYY-MM-DD (inclusive)
}
export interface ReportData {
  totalSales: number;
  totalProfit: number; // estimated: catalog cost when the item name matches, else the manual margin %
  orderCount: number;
  resolvedConvs: number;
  avgTicket: number;
  completedCount: number; // orders/tasks in the final stage
  // Buckets cover the requested range; `date` is the bucket-start day (YYYY-MM-DD) so the
  // client can format labels in its own language.
  trendStepDays: number;
  salesTrend: { date: string; value: number }[];
  profitTrend: { date: string; value: number }[];
  createdTrend: { date: string; value: number }[];
  // Per-product aggregate over the range (sold items grouped by name + zero-sale catalog
  // products), for the most/least-sold and profit tops. Sorted by qty desc.
  products: { name: string; qty: number; revenue: number; profit: number }[];
  byStage: { name: string; color: string; count: number }[];
  byArea: { name: string; color: string; count: number }[];
  byAgent: { name: string; color: string; count: number; id: string }[];
  // Discounts granted in the range (count + $), attributed to the order's assignee.
  discountCount: number;
  discountTotal: number;
  // Cancelados (0065): fuera de ventas/utilidad, contados aparte para que no "desaparezcan".
  cancelledCount: number;
  cancelledTotal: number;   // suma de sus totales — lo que se dejó de vender
  refundedTotal: number;    // dinero devuelto (pagos negativos), en positivo
  byAgentDiscounts: { id: string; name: string; color: string; count: number; amount: number }[];
  // Cobros (0074+): "ventas" de arriba es devengado (por fecha del pedido); esto es caja (por
  // fecha del PAGO), que es lo que de verdad hay que ver cuando cobran días o meses después, o
  // nunca vienen a recoger. collectedTotal = collectedFromPeriodOrders + collectedFromOtherOrders.
  collectedTotal: number;            // cobrado en el periodo, sin importar de qué pedido
  collectedFromPeriodOrders: number; // ...de pedidos también creados en este periodo
  collectedFromOtherOrders: number;  // ...de pedidos de otros periodos (cobros tardíos)
  pendingFromPeriodOrders: number;   // de las ventas del periodo, lo que sigue sin cobrarse a la fecha
  // Mermas (0074): reimpresiones, errores de producción, cancelaciones parciales. Costo real,
  // no venta perdida — se resta de la utilidad estimada.
  wasteCount: number;
  wasteTotal: number;
  // Per-order detail for the report export (names already resolved).
  orders: {
    code: string; contact: string; phone: string; stage: string; area: string; agent: string;
    priority: string; pay_status: string;
    items: { name: string; qty: number; unit_price: number; subtotal: number }[];
    total: number; paid: number; discount: number; discount_note: string | null;
    created_at: string | null; updated_at: string | null; due_at: string | null;
  }[];
}
export async function getReports(businessId: string, range: ReportRange, manualMarginPct = 50, doneFromStageId: string | null = null): Promise<ReportData> {
  const supabase = await createClient();
  const fromISO = new Date(`${range.from}T00:00:00`).toISOString();
  const toISO = new Date(`${range.to}T23:59:59.999`).toISOString();
  const fetchOrders = async () => {
    const cols = (opt: string) =>
      `code, total, priority, pay_status, stage_id, area_id, assignee_id, created_at, updated_at, ${opt}` +
      `contact:contacts(name,phone), items:order_items(name,qty,unit_price,subtotal), payments(amount)`;
    const get = (opt: string) => supabase.from("orders").select(cols(opt))
      .eq("business_id", businessId).is("deleted_at", null).gte("created_at", fromISO).lte("created_at", toISO)
      .order("created_at", { ascending: false });
    // discount (0058) / due_at (0029) / cancelled_at (0065) may not exist yet — cascade.
    let { data, error } = await get("due_at, cancelled_at, discount, discount_pct, discount_note, ");
    if (error) ({ data, error } = await get("due_at, discount, discount_pct, discount_note, "));
    if (error) ({ data, error } = await get("due_at, "));
    if (error) ({ data } = await get(""));
    return data ?? [];
  };
  // Cobrado por su propia fecha de pago (no la del pedido) — un pedido puede pagarse días o
  // meses después de creado, o nunca cobrarse del todo. `orders!inner` solo para poder filtrar
  // por `orders.deleted_at`; payments.order_id es la única FK entre las dos tablas, así que no
  // hay ambigüedad de embedding aquí (a diferencia de orders→stages tras la 0072).
  const fetchPayments = async () => {
    const { data, error } = await supabase.from("payments")
      .select("amount, created_at, order_id, orders!inner(created_at, deleted_at)")
      .eq("business_id", businessId).is("orders.deleted_at", null)
      .gte("created_at", fromISO).lte("created_at", toISO);
    return error ? [] : (data ?? []);
  };
  // Mermas (0074): puede no existir la tabla aún si la migración no se ha corrido.
  const fetchWaste = async () => {
    const { data, error } = await supabase.from("order_waste")
      .select("cost").eq("business_id", businessId).gte("created_at", fromISO).lte("created_at", toISO);
    return error ? [] : (data ?? []);
  };
  const [orders, { count: resolved }, stages, areas, agents, catalog, payRows, wasteRows] = await Promise.all([
    fetchOrders(),
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).eq("status", "resolved")
      .gte("last_message_at", fromISO).lte("last_message_at", toISO),
    getStages(businessId),
    getAreas(businessId),
    getAgents(businessId),
    getProducts(businessId),
    fetchPayments(),
    fetchWaste(),
  ]);

  // Profit per sold item: items whose name matches a catalog product with a cost use
  // subtotal - cost*qty; anything else (manual items, products without a cost) counts
  // the business's default margin % of the sale.
  const norm = (s: string) => s.trim().toLowerCase();
  const costByName = new Map<string, number>();
  for (const p of catalog) if (p.cost != null) costByName.set(norm(p.name), p.cost);
  const itemProfit = (it: { name?: string; qty?: unknown; subtotal?: unknown }) => {
    const subtotal = Number(it.subtotal ?? 0);
    const cost = costByName.get(norm(it.name ?? ""));
    return cost != null ? subtotal - cost * Number(it.qty ?? 0) : subtotal * (manualMarginPct / 100);
  };
  // Order-level profit is net of its discount (the discount comes out of the margin).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderProfit = (o: any) => ((o.items ?? []) as any[]).reduce((s, it) => s + itemProfit(it), 0) - Number(o.discount ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows = (orders ?? []) as any[]; // joined select() string defeats column inference
  // Un pedido cancelado no es una venta. Se aparta ANTES de cualquier cálculo: todo lo de abajo
  // (ventas, utilidad, ticket promedio, tendencias, tops de producto, conteos por etapa/área/agente)
  // trabaja sobre `rows`, así que sacarlos aquí los excluye de todo de una sola vez.
  const cancelledRows = allRows.filter((o) => o.cancelled_at);
  const rows = allRows.filter((o) => !o.cancelled_at);
  const cancelledCount = cancelledRows.length;
  const cancelledTotal = cancelledRows.reduce((s, o) => s + Number(o.total ?? 0), 0);
  // Reembolsos = pagos negativos (los inserta cancelOrder). Se reportan en positivo.
  const refundedTotal = Math.abs(
    allRows.reduce((s, o) => s + ((o.payments ?? []) as { amount: number }[])
      .reduce((t, p) => t + Math.min(0, Number(p.amount) || 0), 0), 0),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paidOf = (o: any) => ((o.payments ?? []) as { amount: number }[]).reduce((s, p) => s + Number(p.amount ?? 0), 0);
  // Cobrado por fecha del PAGO (caja), separado de si el pedido que se pagó es de este periodo o
  // de uno anterior — así "cobrado" no se pierde cuando el dinero entra después de la venta.
  let collectedFromPeriodOrders = 0, collectedFromOtherOrders = 0;
  for (const p of payRows) {
    const amt = Number((p as { amount: unknown }).amount ?? 0);
    if (amt <= 0) continue; // reembolsos ya van en refundedTotal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ord = (p as any).orders;
    const orderCreatedAt = (Array.isArray(ord) ? ord[0] : ord)?.created_at as string | undefined;
    if (orderCreatedAt && orderCreatedAt >= fromISO && orderCreatedAt <= toISO) collectedFromPeriodOrders += amt;
    else collectedFromOtherOrders += amt;
  }
  const collectedTotal = collectedFromPeriodOrders + collectedFromOtherOrders;
  // De las ventas de este periodo (no canceladas), cuánto sigue sin cobrarse a la fecha —
  // incluye los que nunca vinieron a recoger o pagar.
  const pendingFromPeriodOrders = Math.max(0, rows.reduce((s, o) => s + Number(o.total ?? 0) - paidOf(o), 0));
  const wasteCount = wasteRows.length;
  const wasteTotal = wasteRows.reduce((s, w) => s + Number((w as { cost: unknown }).cost ?? 0), 0);
  const countBy = <T extends { id: string; name: string; color: string }>(
    items: T[], key: "stage_id" | "area_id",
  ) => items.map((it) => ({ name: it.name, color: it.color, count: rows.filter((o) => o[key] === it.id).length }));

  // Trend over the range — sales (sum of total) and created count per bucket. Daily buckets up
  // to ~a month; beyond that the bucket widens so the chart stays at ≤31 bars.
  const DAY = 86400000;
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T23:59:59.999`);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY));
  const step = Math.max(1, Math.ceil(days / 31));
  const nBuckets = Math.ceil(days / step);
  const trend: { date: string; value: number }[] = [];
  const profit: { date: string; value: number }[] = [];
  const created: { date: string; value: number }[] = [];
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (let b = 0; b < nBuckets; b++) {
    const bStart = new Date(start.getTime() + b * step * DAY);
    trend.push({ date: ymd(bStart), value: 0 });
    profit.push({ date: ymd(bStart), value: 0 });
    created.push({ date: ymd(bStart), value: 0 });
  }
  for (const o of rows) {
    if (!o.created_at) continue;
    const b = Math.floor((new Date(o.created_at as string).getTime() - start.getTime()) / (step * DAY));
    if (b < 0 || b >= nBuckets) continue;
    trend[b].value += Number(o.total ?? 0);
    profit[b].value += orderProfit(o);
    created[b].value += 1;
  }

  // Per-product aggregate: sold items grouped by (normalized) name, plus catalog products
  // that didn't sell at all in the range — those matter for the "least sold" list.
  const prodAgg = new Map<string, { name: string; qty: number; revenue: number; profit: number }>();
  for (const o of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of ((o.items ?? []) as any[])) {
      const key = norm((it.name as string) ?? "");
      if (!key) continue;
      const cur = prodAgg.get(key) ?? { name: (it.name as string).trim(), qty: 0, revenue: 0, profit: 0 };
      cur.qty += Number(it.qty ?? 0);
      cur.revenue += Number(it.subtotal ?? 0);
      cur.profit += itemProfit(it);
      prodAgg.set(key, cur);
    }
  }
  for (const p of catalog) {
    if (!p.active || prodAgg.has(norm(p.name))) continue;
    prodAgg.set(norm(p.name), { name: p.name, qty: 0, revenue: 0, profit: 0 });
  }
  const products = [...prodAgg.values()]
    .map((p) => ({ ...p, profit: Math.round(p.profit * 100) / 100 }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);

  const discounted = rows.filter((o) => Number(o.discount ?? 0) > 0);
  const discountTotal = Math.round(discounted.reduce((s, o) => s + Number(o.discount ?? 0), 0) * 100) / 100;
  const byAgentDiscounts = agents.map((a) => {
    const mine = discounted.filter((o) => o.assignee_id === a.id);
    return { id: a.id, name: a.name, color: a.color, count: mine.length, amount: Math.round(mine.reduce((s, o) => s + Number(o.discount ?? 0), 0) * 100) / 100 };
  }).filter((a) => a.count > 0).sort((a, b) => b.amount - a.amount);

  const total = rows.reduce((n, o) => n + Number(o.total ?? 0), 0);
  const doneIds = doneStageIds(stages, doneFromStageId);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  return {
    totalSales: total,
    // Las mermas del periodo son costo real incurrido, aunque no estén ligadas a un pedido
    // vendido en este mismo rango — se restan aparte de orderProfit (que ya neteó descuentos).
    totalProfit: Math.round((rows.reduce((s, o) => s + orderProfit(o), 0) - wasteTotal) * 100) / 100,
    orderCount: rows.length,
    resolvedConvs: resolved ?? 0,
    avgTicket: rows.length ? Math.round(total / rows.length) : 0,
    completedCount: rows.filter((o) => o.stage_id && doneIds.has(o.stage_id as string)).length,
    trendStepDays: step,
    salesTrend: trend,
    profitTrend: profit,
    createdTrend: created,
    products,
    byStage: countBy(stages, "stage_id"),
    byArea: countBy(areas, "area_id"),
    byAgent: agents.map((a) => ({ id: a.id, name: a.name, color: a.color, count: rows.filter((o) => o.assignee_id === a.id).length })),
    discountCount: discounted.length,
    discountTotal,
    cancelledCount,
    cancelledTotal,
    refundedTotal,
    collectedTotal,
    collectedFromPeriodOrders,
    collectedFromOtherOrders,
    pendingFromPeriodOrders,
    wasteCount,
    wasteTotal: Math.round(wasteTotal * 100) / 100,
    byAgentDiscounts,
    orders: rows.map((o) => ({
      code: (o.code as string) ?? "",
      contact: (o.contact?.name as string) ?? "",
      phone: (o.contact?.phone as string) ?? "",
      stage: stageName.get(o.stage_id as string) ?? "",
      area: areaName.get(o.area_id as string) ?? "",
      agent: agentName.get(o.assignee_id as string) ?? "",
      priority: (o.priority as string) ?? "normal",
      pay_status: (o.pay_status as string) ?? "pending",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: ((o.items ?? []) as any[]).map((it) => ({
        name: (it.name as string) ?? "",
        qty: Number(it.qty ?? 0),
        unit_price: Number(it.unit_price ?? 0),
        subtotal: Number(it.subtotal ?? 0),
      })),
      total: Number(o.total ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      paid: ((o.payments ?? []) as any[]).reduce((s, p) => s + Number(p.amount ?? 0), 0),
      discount: Number(o.discount ?? 0),
      discount_note: (o.discount_note as string) ?? null,
      created_at: (o.created_at as string) ?? null,
      updated_at: (o.updated_at as string) ?? null,
      due_at: (o.due_at as string) ?? null,
    })),
  };
}
