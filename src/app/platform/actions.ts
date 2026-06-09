"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
