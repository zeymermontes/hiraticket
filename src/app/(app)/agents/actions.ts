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
  businessId: string, email: string, role: "admin" | "agent" | "viewer", areaId?: string | null, allowExtra = false,
): Promise<{ ok: boolean; error?: string; extra?: { included: number; current: number; price: number } }> {
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

  // Seat check: members + pending email invites vs allowed = plan.included + paid extra_seats. Going
  // over is allowed (each extra agent costs 250 MXN/mo) but the caller must confirm first (allowExtra).
  const seat = await seatCounts(admin, businessId);
  if (!allowExtra && seat.included >= 0 && seat.current >= seat.included + seat.extraSeats) {
    return { ok: false, error: "over-limit", extra: { included: seat.included + seat.extraSeats, current: seat.current, price: seat.price } };
  }
  // Confirmed an extra agent → buy a paid seat so the account stays in good standing.
  if (allowExtra && seat.included >= 0 && seat.current >= seat.included + seat.extraSeats) {
    await setExtraSeats(admin, businessId, seat.extraSeats + 1);
  }

  // Replace any prior pending invite for this email+business, then create a fresh one.
  await admin.from("team_invites").delete().eq("business_id", businessId).eq("email", clean).is("token", null);
  const { error } = await admin.from("team_invites").insert({ business_id: businessId, email: clean, role, area_id: areaId ?? null, created_by: me });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agents");
  return { ok: true };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Members + pending invites, plan included agents, paid extra seats, extra-agent price. */
async function seatCounts(admin: any, businessId: string) {
  const [{ count: mCount }, { count: iCount }, subRes] = await Promise.all([
    admin.from("business_members").select("user_id", { count: "exact", head: true }).eq("business_id", businessId),
    admin.from("team_invites").select("id", { count: "exact", head: true }).eq("business_id", businessId).is("token", null),
    admin.from("subscriptions").select("plan_id, status, extra_seats").eq("business_id", businessId).maybeSingle(),
  ]);
  let sub = subRes.data as { plan_id?: string; status?: string; extra_seats?: number } | null;
  if (subRes.error) sub = (await admin.from("subscriptions").select("plan_id, status").eq("business_id", businessId).maybeSingle()).data; // extra_seats (0047) not applied yet
  const { data: plan } = await admin.from("plans").select("limits, price_monthly").eq("id", sub?.plan_id ?? "pro").maybeSingle();
  const lim = (plan?.limits ?? {}) as { agents?: number; extra_agent?: number };
  return {
    current: (mCount ?? 0) + (iCount ?? 0),
    included: lim.agents ?? -1,
    extraSeats: sub?.extra_seats ?? 0,
    price: lim.extra_agent ?? 250,
    status: sub?.status ?? "trialing",
    planPrice: Number(plan?.price_monthly ?? 0),
  };
}
async function setExtraSeats(admin: any, businessId: string, extraSeats: number) {
  const s = await seatCounts(admin, businessId);
  await admin.from("subscriptions").update({ extra_seats: extraSeats, mrr: s.planPrice + extraSeats * s.price }).eq("business_id", businessId);
}

/** Seat status for the current business — drives the "over the agent limit" gate on the Agents page. */
export async function getSeatStatus(businessId: string): Promise<{ included: number; extraSeats: number; allowed: number; current: number; status: string; needsAction: boolean; price: number }> {
  if (!(await assertAdmin(businessId))) return { included: -1, extraSeats: 0, allowed: -1, current: 0, status: "trialing", needsAction: false, price: 250 };
  const admin = createAdminClient();
  const s = await seatCounts(admin, businessId);
  const allowed = s.included < 0 ? -1 : s.included + s.extraSeats;
  const needsAction = allowed >= 0 && s.current > allowed && s.status !== "trialing";
  return { included: s.included, extraSeats: s.extraSeats, allowed, current: s.current, status: s.status, needsAction, price: s.price };
}

/** "Add a seat" — buy one paid extra agent seat (250 MXN/mo). */
export async function addSeat(businessId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertAdmin(businessId))) return { ok: false, error: "forbidden" };
  const admin = createAdminClient();
  const s = await seatCounts(admin, businessId);
  await setExtraSeats(admin, businessId, s.extraSeats + 1);
  revalidatePath("/agents");
  return { ok: true };
}
