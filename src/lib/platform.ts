import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export interface TenantPlugin { id: string; name: string; mrr: number; status: string }
export interface TenantDetail extends TenantRow {
  seats: number;
  orders: number;
  extra_seats: number;
  current_period_end: string | null;
  phones: { label: string; status: string; phone: string | null }[];
  plugins: TenantPlugin[];
}
export interface PluginCatalogRow {
  id: string;
  name: string;
  category: string;
  status: string;
  pricing: Record<string, unknown>;
  installs: number; // active installs across all tenants
  mrr: number; // total add-on MRR from this plugin
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
  pluginCatalog: PluginCatalogRow[];
  audit: AuditRow[];
  totals: { tenants: number; mrr: number; active: number; trials: number; connected: number; pastDue: number };
}

export async function getPlatformConsole(): Promise<PlatformConsoleData> {
  // Only platform admins reach this; use the service-role client so member/order counts are computed
  // across ALL tenants (the user client is RLS-scoped to the admin's own business → other tenants = 0).
  const authed = await createClient();
  const { data: isAdmin } = await authed.rpc("is_platform_admin");
  if (isAdmin !== true) {
    return { tenants: [], plans: [], pluginCatalog: [], audit: [], totals: { tenants: 0, mrr: 0, active: 0, trials: 0, connected: 0, pastDue: 0 } };
  }
  const supabase = createAdminClient();
  const [{ data: businesses }, subsRes, { data: wa }, { data: plans }, { data: members }, { data: orders }, { data: events }, catalogRes, installsRes] =
    await Promise.all([
      supabase.from("businesses").select("id, name, vertical, created_at"),
      supabase.from("subscriptions").select("business_id, plan_id, status, mrr, current_period_end, extra_seats"),
      supabase.from("whatsapp_sessions").select("business_id, label, status, phone"),
      supabase.from("plans").select("id, name, price_monthly, price_annual, popular, limits, features").order("position"),
      supabase.from("business_members").select("business_id"),
      supabase.from("orders").select("business_id"),
      supabase.from("events").select("id, business_id, kind, text, created_at").order("created_at", { ascending: false }).limit(40),
      supabase.from("plugins").select("id, name, category, status, pricing").order("position"),
      supabase.from("business_plugins").select("business_id, plugin_id, status, mrr"),
    ]);
  // extra_seats (0047) may not be applied yet — fall back without it.
  const subs = subsRes.error
    ? (await supabase.from("subscriptions").select("business_id, plan_id, status, mrr, current_period_end")).data
    : subsRes.data;

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
  const bestWa = (bid: string) => { const ps = phonesByBiz.get(bid) ?? []; return ps.find((p) => p.status === "connected")?.status ?? ps.find((p) => p.status !== "disconnected")?.status ?? ps[0]?.status ?? "disconnected"; };
  const subByPlan = new Map<string, number>();
  (subs ?? []).forEach((s) => subByPlan.set(s.plan_id as string, (subByPlan.get(s.plan_id as string) ?? 0) + 1));

  // Plugins (0049) — may not be applied yet; guard both fetches.
  const catalog = catalogRes.error ? [] : (catalogRes.data ?? []);
  const installs = installsRes.error ? [] : (installsRes.data ?? []);
  const pluginName = new Map((catalog).map((p) => [p.id as string, p.name as string]));
  const pluginsByBiz = new Map<string, TenantPlugin[]>();
  const pluginMrrByBiz = new Map<string, number>();
  const installsByPlugin = new Map<string, number>();
  const mrrByPlugin = new Map<string, number>();
  installs.forEach((r) => {
    const bid = r.business_id as string, pid = r.plugin_id as string, active = r.status === "active", mrr = Number(r.mrr) || 0;
    const arr = pluginsByBiz.get(bid) ?? []; arr.push({ id: pid, name: pluginName.get(pid) ?? pid, mrr, status: r.status as string }); pluginsByBiz.set(bid, arr);
    if (active) {
      pluginMrrByBiz.set(bid, (pluginMrrByBiz.get(bid) ?? 0) + mrr);
      installsByPlugin.set(pid, (installsByPlugin.get(pid) ?? 0) + 1);
      mrrByPlugin.set(pid, (mrrByPlugin.get(pid) ?? 0) + mrr);
    }
  });

  const tenants: TenantDetail[] = (businesses ?? []).map((b) => {
    const s = subMap.get(b.id as string);
    const pluginMrr = pluginMrrByBiz.get(b.id as string) ?? 0;
    return {
      id: b.id as string, name: b.name as string, vertical: b.vertical as string, created_at: b.created_at as string,
      plan: (s?.plan_id as string) ?? "—", status: (s?.status as string) ?? "—", mrr: Number(s?.mrr ?? 0) + pluginMrr, wa: bestWa(b.id as string),
      seats: seatCount.get(b.id as string) ?? 0, orders: orderCount.get(b.id as string) ?? 0,
      extra_seats: Number((s as { extra_seats?: number } | undefined)?.extra_seats ?? 0),
      current_period_end: ((s as { current_period_end?: string } | undefined)?.current_period_end) ?? null,
      phones: phonesByBiz.get(b.id as string) ?? [],
      plugins: pluginsByBiz.get(b.id as string) ?? [],
    };
  });

  return {
    tenants,
    plans: (plans ?? []).map((p) => ({ ...(p as unknown as PlatformPlanFull), subscribers: subByPlan.get(p.id as string) ?? 0 })),
    pluginCatalog: (catalog).map((p) => ({
      id: p.id as string, name: p.name as string, category: p.category as string, status: p.status as string,
      pricing: (p.pricing as Record<string, unknown>) ?? {}, installs: installsByPlugin.get(p.id as string) ?? 0, mrr: mrrByPlugin.get(p.id as string) ?? 0,
    })),
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
