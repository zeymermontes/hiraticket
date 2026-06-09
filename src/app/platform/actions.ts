"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Claim platform-admin — only succeeds while no platform admin exists yet. */
export async function bootstrapPlatformAdmin(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_platform_admin");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/platform");
  return { ok: true };
}
