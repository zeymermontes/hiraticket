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
