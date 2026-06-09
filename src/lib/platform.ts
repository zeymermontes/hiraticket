import { createClient } from "@/lib/supabase/server";

export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
}

export async function platformAdminCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("platform_admins")
    .select("user_id", { count: "exact", head: true });
  return count ?? 0;
}

export interface PlatformPlan {
  id: string;
  name: string;
  price_monthly: number;
  price_annual: number;
  popular: boolean;
}

export interface TenantRow {
  id: string;
  name: string;
  vertical: string;
  created_at: string;
  plan: string;
  status: string;
  mrr: number;
  wa: string; // best whatsapp status
}

export interface PlatformOverview {
  tenants: TenantRow[];
  plans: PlatformPlan[];
  totals: { tenants: number; mrr: number; active: number; connected: number };
}

export interface TenantDetail extends TenantRow {
  seats: number;
  orders: number;
  phones: { label: string; status: string; phone: string | null }[];
}
export interface PlatformPlanFull extends PlatformPlan {
  limits: Record<string, number>;
  features: { es?: string; en?: string }[] | string[];
  subscribers: number;
}
export interface AuditRow {
  id: string;
  business: string;
  kind: string;
  text: string | null;
  created_at: string;
}
export interface PlatformConsoleData {
  tenants: TenantDetail[];
  plans: PlatformPlanFull[];
  audit: AuditRow[];
  totals: { tenants: number; mrr: number; active: number; trials: number; connected: number; pastDue: number };
}

export async function getPlatformConsole(): Promise<PlatformConsoleData> {
  const supabase = await createClient();
  const [{ data: businesses }, { data: subs }, { data: wa }, { data: plans }, { data: members }, { data: orders }, { data: events }] =
    await Promise.all([
      supabase.from("businesses").select("id, name, vertical, created_at"),
      supabase.from("subscriptions").select("business_id, plan_id, status, mrr"),
      supabase.from("whatsapp_sessions").select("business_id, label, status, phone"),
      supabase.from("plans").select("id, name, price_monthly, price_annual, popular, limits, features").order("position"),
      supabase.from("business_members").select("business_id"),
      supabase.from("orders").select("business_id"),
      supabase.from("events").select("id, business_id, kind, text, created_at").order("created_at", { ascending: false }).limit(40),
    ]);

  const subMap = new Map((subs ?? []).map((s) => [s.business_id as string, s]));
  const bizName = new Map((businesses ?? []).map((b) => [b.id as string, b.name as string]));
  const seatCount = new Map<string, number>();
  (members ?? []).forEach((m) => seatCount.set(m.business_id as string, (seatCount.get(m.business_id as string) ?? 0) + 1));
  const orderCount = new Map<string, number>();
  (orders ?? []).forEach((o) => orderCount.set(o.business_id as string, (orderCount.get(o.business_id as string) ?? 0) + 1));
  const phonesByBiz = new Map<string, { label: string; status: string; phone: string | null }[]>();
  (wa ?? []).forEach((w) => {
    const arr = phonesByBiz.get(w.business_id as string) ?? [];
    arr.push({ label: w.label as string, status: w.status as string, phone: (w.phone as string) ?? null });
    phonesByBiz.set(w.business_id as string, arr);
  });
  const bestWa = (bid: string) => { const ps = phonesByBiz.get(bid) ?? []; return ps.find((p) => p.status === "connected")?.status ?? ps[0]?.status ?? "disconnected"; };
  const subByPlan = new Map<string, number>();
  (subs ?? []).forEach((s) => subByPlan.set(s.plan_id as string, (subByPlan.get(s.plan_id as string) ?? 0) + 1));

  const tenants: TenantDetail[] = (businesses ?? []).map((b) => {
    const s = subMap.get(b.id as string);
    return {
      id: b.id as string, name: b.name as string, vertical: b.vertical as string, created_at: b.created_at as string,
      plan: (s?.plan_id as string) ?? "—", status: (s?.status as string) ?? "—", mrr: Number(s?.mrr ?? 0), wa: bestWa(b.id as string),
      seats: seatCount.get(b.id as string) ?? 0, orders: orderCount.get(b.id as string) ?? 0, phones: phonesByBiz.get(b.id as string) ?? [],
    };
  });

  return {
    tenants,
    plans: (plans ?? []).map((p) => ({ ...(p as unknown as PlatformPlanFull), subscribers: subByPlan.get(p.id as string) ?? 0 })),
    audit: (events ?? []).map((e) => ({ id: e.id as string, business: bizName.get(e.business_id as string) ?? "—", kind: e.kind as string, text: e.text as string | null, created_at: e.created_at as string })),
    totals: {
      tenants: tenants.length,
      mrr: tenants.reduce((n, t) => n + (t.status === "active" ? t.mrr : 0), 0),
      active: tenants.filter((t) => t.status === "active").length,
      trials: tenants.filter((t) => t.status === "trialing").length,
      connected: tenants.filter((t) => t.wa === "connected").length,
      pastDue: tenants.filter((t) => t.status === "past_due").length,
    },
  };
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const supabase = await createClient();
  const [{ data: businesses }, { data: subs }, { data: wa }, { data: plans }] =
    await Promise.all([
      supabase.from("businesses").select("id, name, vertical, created_at"),
      supabase.from("subscriptions").select("business_id, plan_id, status, mrr"),
      supabase.from("whatsapp_sessions").select("business_id, status"),
      supabase.from("plans").select("id, name, price_monthly, price_annual, popular").order("position"),
    ]);

  const subMap = new Map((subs ?? []).map((s) => [s.business_id as string, s]));
  const waMap = new Map<string, string>();
  for (const w of wa ?? []) {
    const cur = waMap.get(w.business_id as string);
    // prefer "connected" over anything else
    if (w.status === "connected" || !cur) waMap.set(w.business_id as string, w.status as string);
  }

  const tenants: TenantRow[] = (businesses ?? []).map((b) => {
    const s = subMap.get(b.id as string);
    return {
      id: b.id as string,
      name: b.name as string,
      vertical: b.vertical as string,
      created_at: b.created_at as string,
      plan: (s?.plan_id as string) ?? "—",
      status: (s?.status as string) ?? "—",
      mrr: Number(s?.mrr ?? 0),
      wa: waMap.get(b.id as string) ?? "disconnected",
    };
  });

  return {
    tenants,
    plans: (plans ?? []) as PlatformPlan[],
    totals: {
      tenants: tenants.length,
      mrr: tenants.reduce((n, t) => n + (t.status === "active" ? t.mrr : 0), 0),
      active: tenants.filter((t) => t.status === "active").length,
      connected: tenants.filter((t) => t.wa === "connected").length,
    },
  };
}
