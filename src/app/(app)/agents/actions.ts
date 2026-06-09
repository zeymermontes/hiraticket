"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function assertAdmin(businessId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("business_members").select("role")
    .eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
  return data?.role === "admin" ? user.id : null;
}

export async function setAgentRole(
  businessId: string, userId: string, role: "admin" | "agent" | "viewer",
): Promise<void> {
  if (!(await assertAdmin(businessId))) return;
  const admin = createAdminClient();
  await admin.from("business_members").update({ role }).eq("business_id", businessId).eq("user_id", userId);
  revalidatePath("/agents");
}

export async function inviteAgent(
  businessId: string, email: string, role: "admin" | "agent" | "viewer",
): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertAdmin(businessId))) return { ok: false, error: "forbidden" };
  const clean = email.trim().toLowerCase();
  if (!clean) return { ok: false, error: "email" };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(clean);
  if (error || !data?.user) return { ok: false, error: error?.message ?? "invite failed" };

  await admin.from("business_members").upsert(
    { business_id: businessId, user_id: data.user.id, role },
    { onConflict: "business_id,user_id" },
  );
  revalidatePath("/agents");
  return { ok: true };
}
