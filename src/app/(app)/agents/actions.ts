"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredOrigin } from "@/lib/url";

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

/** Rename an agent (admins only) — upserts the profile (creates it if the row is missing)
 *  AND updates auth metadata so the name + avatar refresh everywhere. Returns an error so
 *  the caller can surface why it failed instead of silently no-op'ing. */
export async function setAgentName(businessId: string, userId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertAdmin(businessId))) return { ok: false, error: "forbidden" };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "empty" };
  const admin = createAdminClient();
  // upsert (not update): invited agents may not have a profiles row yet, and a bare update
  // would silently affect 0 rows.
  const { error } = await admin.from("profiles").upsert({ id: userId, full_name: clean }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  // Best-effort: keep auth metadata (used by the top-bar profile) in sync.
  try { await admin.auth.admin.updateUserById(userId, { user_metadata: { full_name: clean } }); } catch { /* not a real auth user — ignore */ }
  revalidatePath("/agents");
  revalidatePath("/chat");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Assign an agent to an area (admins only). */
export async function setAgentArea(businessId: string, userId: string, areaId: string | null): Promise<void> {
  if (!(await assertAdmin(businessId))) return;
  const admin = createAdminClient();
  await admin.from("business_members").update({ area_id: areaId }).eq("business_id", businessId).eq("user_id", userId);
  revalidatePath("/agents");
}

// Invited users have no password yet, so the invite link must land on the set-password page
// (/reset-password) instead of dropping them into the app — otherwise login fails with
// "invalid credentials". Needs NEXT_PUBLIC_SITE_URL set on the host.
function inviteOpts() {
  const site = configuredOrigin();
  return site ? { redirectTo: `${site}/auth/callback?next=/reset-password` } : undefined;
}

/** Resend the invitation email to an agent (admins only). */
export async function resendInvite(businessId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertAdmin(businessId))) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (!email) return { ok: false, error: "no email" };
  const { error } = await admin.auth.admin.inviteUserByEmail(email, inviteOpts());
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Remove an agent from the business (admins only; can't remove yourself or the last admin). */
export async function deactivateAgent(businessId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const adminId = await assertAdmin(businessId);
  if (!adminId) return { ok: false, error: "forbidden" };
  if (userId === adminId) return { ok: false, error: "self" };
  const admin = createAdminClient();
  const { data: admins } = await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("role", "admin");
  const target = await admin.from("business_members").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (target.data?.role === "admin" && (admins ?? []).length <= 1) return { ok: false, error: "last-admin" };
  await admin.from("business_members").delete().eq("business_id", businessId).eq("user_id", userId);
  revalidatePath("/agents");
  return { ok: true };
}

/** Invite an EXISTING account to the team — never creates an account on someone's behalf. The person
 *  accepts via a popup on their next visit. Errors: 'no-account' (tell them to sign up first),
 *  'in-another-team', 'already-member'. */
export async function inviteAgent(
  businessId: string, email: string, role: "admin" | "agent" | "viewer", areaId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const me = await assertAdmin(businessId);
  if (!me) return { ok: false, error: "forbidden" };
  const clean = email.trim().toLowerCase();
  if (!clean) return { ok: false, error: "email" };

  const admin = createAdminClient();
  const { data: uid } = await admin.rpc("user_id_by_email", { p_email: clean });
  if (!uid) return { ok: false, error: "no-account" };

  // One team per account (for now): block if they already belong to a team.
  const { data: existing } = await admin.from("business_members").select("business_id").eq("user_id", uid).limit(1).maybeSingle();
  if (existing) return { ok: false, error: existing.business_id === businessId ? "already-member" : "in-another-team" };

  // Replace any prior pending invite for this email+business, then create a fresh one.
  await admin.from("team_invites").delete().eq("business_id", businessId).eq("email", clean).is("token", null);
  const { error } = await admin.from("team_invites").insert({ business_id: businessId, email: clean, role, area_id: areaId ?? null, created_by: me });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agents");
  return { ok: true };
}
