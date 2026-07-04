"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/platform";

/** Claim platform-admin — only succeeds while no platform admin exists yet. */
export async function bootstrapPlatformAdmin(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_platform_admin");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/platform");
  return { ok: true };
}

/** Edit a plan's pricing / popular flag (platform admins only). */
export async function updatePlan(
  planId: string,
  patch: { price_monthly?: number; price_annual?: number; popular?: boolean },
): Promise<void> {
  if (!(await isPlatformAdmin())) return;
  const supabase = await createClient();
  await supabase.from("plans").update(patch).eq("id", planId);
  revalidatePath("/platform");
}

/** Extend a business's paid period by N months (manual billing) — sets status active. */
export async function extendSubscription(businessId: string, months: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, error: "forbidden" };
  if (!Number.isFinite(months) || months === 0) return { ok: true };
  const admin = createAdminClient();
  const { data: sub } = await admin.from("subscriptions").select("current_period_end").eq("business_id", businessId).maybeSingle();
  const cur = sub?.current_period_end ? new Date(sub.current_period_end as string) : null;
  const base = cur && cur.getTime() > Date.now() ? cur : new Date();
  base.setMonth(base.getMonth() + Math.round(months));
  await admin.from("subscriptions").update({ current_period_end: base.toISOString(), status: "active" }).eq("business_id", businessId);
  revalidatePath("/platform");
  return { ok: true };
}

/** Move a business to another plan; recomputes MRR = plan price + paid extra seats × extra price. */
export async function setBusinessPlan(businessId: string, planId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const { data: plan } = await admin.from("plans").select("price_monthly, limits").eq("id", planId).maybeSingle();
  if (!plan) return { ok: false, error: "no-plan" };
  const { data: sub } = await admin.from("subscriptions").select("extra_seats").eq("business_id", businessId).maybeSingle();
  const extraSeats = (sub?.extra_seats as number) ?? 0;
  const extraPrice = ((plan.limits ?? {}) as { extra_agent?: number }).extra_agent ?? 250;
  const mrr = Number(plan.price_monthly ?? 0) + extraSeats * extraPrice;
  await admin.from("subscriptions").update({ plan_id: planId, mrr }).eq("business_id", businessId);
  revalidatePath("/platform");
  return { ok: true };
}
