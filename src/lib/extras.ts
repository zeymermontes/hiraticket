import { createClient } from "@/lib/supabase/server";
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
}
export async function getProducts(businessId: string): Promise<Product[]> {
  const supabase = await createClient();
  // Resilient to a not-yet-applied 0024 (price_tiers).
  let { data, error } = await supabase
    .from("products").select("id, name, kind, price, active, price_tiers")
    .eq("business_id", businessId).order("created_at");
  if (error) {
    const r = await supabase.from("products").select("id, name, kind, price, active").eq("business_id", businessId).order("created_at");
    data = (r.data ?? []) as typeof data;
  }
  return (data ?? []).map((p) => {
    const t = (p as { price_tiers?: unknown }).price_tiers;
    return { ...p, price_tiers: Array.isArray(t) ? (t as PriceTier[]) : [] };
  }) as Product[];
}

export interface Appointment {
  id: string; title: string; starts_at: string; status: string;
  contact: { name: string } | null;
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
  orderCount: number;
  resolvedConvs: number;
  avgTicket: number;
  completedCount: number; // orders/tasks in the final stage
  // Buckets cover the requested range; `date` is the bucket-start day (YYYY-MM-DD) so the
  // client can format labels in its own language.
  trendStepDays: number;
  salesTrend: { date: string; value: number }[];
  createdTrend: { date: string; value: number }[];
  byStage: { name: string; color: string; count: number }[];
  byArea: { name: string; color: string; count: number }[];
  byAgent: { name: string; color: string; count: number; id: string }[];
  // Per-order detail for the report export (names already resolved).
  orders: {
    code: string; contact: string; phone: string; stage: string; area: string; agent: string;
    priority: string; pay_status: string;
    items: { name: string; qty: number; unit_price: number; subtotal: number }[];
    total: number; paid: number;
    created_at: string | null; updated_at: string | null; due_at: string | null;
  }[];
}
export async function getReports(businessId: string, range: ReportRange): Promise<ReportData> {
  const supabase = await createClient();
  const fromISO = new Date(`${range.from}T00:00:00`).toISOString();
  const toISO = new Date(`${range.to}T23:59:59.999`).toISOString();
  const fetchOrders = async () => {
    const cols = (due: string) =>
      `code, total, priority, pay_status, stage_id, area_id, assignee_id, created_at, updated_at, ${due}` +
      `contact:contacts(name,phone), items:order_items(name,qty,unit_price,subtotal), payments(amount)`;
    // due_at (0029) may not exist yet — fall back to the base columns (same cascade as kanban).
    let { data, error } = await supabase.from("orders").select(cols("due_at, "))
      .eq("business_id", businessId).gte("created_at", fromISO).lte("created_at", toISO)
      .order("created_at", { ascending: false });
    if (error) ({ data } = await supabase.from("orders").select(cols(""))
      .eq("business_id", businessId).gte("created_at", fromISO).lte("created_at", toISO)
      .order("created_at", { ascending: false }));
    return data ?? [];
  };
  const [orders, { count: resolved }, stages, areas, agents] = await Promise.all([
    fetchOrders(),
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).eq("status", "resolved")
      .gte("last_message_at", fromISO).lte("last_message_at", toISO),
    getStages(businessId),
    getAreas(businessId),
    getAgents(businessId),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (orders ?? []) as any[]; // joined select() string defeats column inference
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
  const created: { date: string; value: number }[] = [];
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (let b = 0; b < nBuckets; b++) {
    const bStart = new Date(start.getTime() + b * step * DAY);
    trend.push({ date: ymd(bStart), value: 0 });
    created.push({ date: ymd(bStart), value: 0 });
  }
  for (const o of rows) {
    if (!o.created_at) continue;
    const b = Math.floor((new Date(o.created_at as string).getTime() - start.getTime()) / (step * DAY));
    if (b < 0 || b >= nBuckets) continue;
    trend[b].value += Number(o.total ?? 0);
    created[b].value += 1;
  }

  const total = rows.reduce((n, o) => n + Number(o.total ?? 0), 0);
  const lastStage = stages.length ? stages[stages.length - 1] : null;
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const areaName = new Map(areas.map((a) => [a.id, a.name]));
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  return {
    totalSales: total,
    orderCount: rows.length,
    resolvedConvs: resolved ?? 0,
    avgTicket: rows.length ? Math.round(total / rows.length) : 0,
    completedCount: lastStage ? rows.filter((o) => o.stage_id === lastStage.id).length : 0,
    trendStepDays: step,
    salesTrend: trend,
    createdTrend: created,
    byStage: countBy(stages, "stage_id"),
    byArea: countBy(areas, "area_id"),
    byAgent: agents.map((a) => ({ id: a.id, name: a.name, color: a.color, count: rows.filter((o) => o.assignee_id === a.id).length })),
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
      created_at: (o.created_at as string) ?? null,
      updated_at: (o.updated_at as string) ?? null,
      due_at: (o.due_at as string) ?? null,
    })),
  };
}
