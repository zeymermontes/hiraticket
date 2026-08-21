"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredOrigin } from "@/lib/url";

type Role = "admin" | "agent" | "viewer";

async function me() {
  const supabase = await createClient();
  const user = await getSessionUser();
  return user;
}
async function assertAdmin(businessId: string): Promise<string | null> {
  const u = await me();
  if (!u) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("business_members").select("role").eq("business_id", businessId).eq("user_id", u.id).maybeSingle();
  return data?.role === "admin" ? u.id : null;
}

export interface PendingInvite { id: string; businessName: string; inviterName: string | null; role: Role }
export interface InviteRow { id: string; email: string | null; token: string | null; url: string | null; role: Role; expires_at: string | null; max_uses: number | null; used_count: number }

/** Create a shareable join link with optional expiry (days) + one-time use. */
export async function createInviteLink(businessId: string, role: Role, areaId: string | null, opts: { expiresInDays?: number | null; oneTime?: boolean }): Promise<{ ok: boolean; url?: string; error?: string }> {
  const meId = await assertAdmin(businessId);
  if (!meId) return { ok: false, error: "forbidden" };
  const token = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, "").slice(0, 40);
  const expires_at = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400000).toISOString() : null;
  const max_uses = opts.oneTime ? 1 : null;
  const admin = createAdminClient();
  const { error } = await admin.from("team_invites").insert({ business_id: businessId, role, area_id: areaId, token, expires_at, max_uses, created_by: meId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/agents");
  const base = configuredOrigin();
  return { ok: true, url: `${base || ""}/join/${token}` };
}

/** Pending email invites + active share links for a business (admin only). */
export async function listInvites(businessId: string): Promise<InviteRow[]> {
  if (!(await assertAdmin(businessId))) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("team_invites").select("id, email, token, role, expires_at, max_uses, used_count").eq("business_id", businessId).order("created_at", { ascending: false });
  const base = configuredOrigin();
  return ((data ?? []) as Omit<InviteRow, "url">[]).map((r) => ({ ...r, url: r.token ? `${base || ""}/join/${r.token}` : null }));
}

export async function revokeInvite(businessId: string, id: string): Promise<void> {
  if (!(await assertAdmin(businessId))) return;
  const admin = createAdminClient();
  await admin.from("team_invites").delete().eq("id", id).eq("business_id", businessId);
  revalidatePath("/agents");
}

/** A valid direct invite addressed to the current user, for the join popup (or null). */
export async function getMyPendingInvite(): Promise<PendingInvite | null> {
  const u = await me();
  if (!u?.email) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("team_invites").select("id, role, created_by, expires_at, businesses(name)").eq("email", u.email.toLowerCase()).is("token", null).order("created_at", { ascending: false });
  const valid = (data ?? []).find((i: { expires_at: string | null }) => !i.expires_at || new Date(i.expires_at) > new Date()) as { id: string; role: Role; created_by: string | null; businesses: { name?: string } | { name?: string }[] | null } | undefined;
  if (!valid) return null;
  let inviterName: string | null = null;
  if (valid.created_by) { const { data: p } = await admin.from("profiles").select("full_name").eq("id", valid.created_by).maybeSingle(); inviterName = (p?.full_name as string) ?? null; }
  const biz = valid.businesses; const businessName = ((Array.isArray(biz) ? biz[0] : biz)?.name) ?? "un equipo";
  return { id: valid.id, businessName, inviterName, role: valid.role };
}

/** Validate a share-link token and describe the team (for the /join page). */
export async function getTokenInvite(token: string): Promise<{ ok: boolean; businessName?: string; inviterName?: string | null; role?: Role; error?: string }> {
  const admin = createAdminClient();
  const { data: inv } = await admin.from("team_invites").select("role, expires_at, max_uses, used_count, created_by, businesses(name)").eq("token", token).maybeSingle();
  if (!inv) return { ok: false, error: "invalid" };
  if (inv.expires_at && new Date(inv.expires_at as string) < new Date()) return { ok: false, error: "expired" };
  if (inv.max_uses != null && (inv.used_count as number) >= (inv.max_uses as number)) return { ok: false, error: "used" };
  let inviterName: string | null = null;
  if (inv.created_by) { const { data: p } = await admin.from("profiles").select("full_name").eq("id", inv.created_by as string).maybeSingle(); inviterName = (p?.full_name as string) ?? null; }
  const biz = inv.businesses as { name?: string } | { name?: string }[] | null; const businessName = ((Array.isArray(biz) ? biz[0] : biz)?.name) ?? "un equipo";
  return { ok: true, businessName, inviterName, role: inv.role as Role };
}

/**
 * ¿Ya está en ESTA organización?
 *
 * Antes la pregunta era "¿está en alguna?", y bastaba con eso para rechazar la invitación —- era la
 * regla de una cuenta, un equipo. Ahora un correo puede estar en varias, así que lo único que sigue
 * sin tener sentido es entrar dos veces al mismo sitio: la llave primaria de business_members es
 * (business_id, user_id), o sea que el insert fallaría igual, pero con un error de base de datos en
 * vez de un mensaje que se entienda.
 */
async function alreadyInThisTeam(userId: string, businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("business_members").select("business_id")
    .eq("user_id", userId).eq("business_id", businessId).maybeSingle();
  return !!data;
}

/** Accept a direct (email) invite by id. */
export async function acceptInvite(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  const u = await me();
  if (!u) return { ok: false, error: "auth" };
  const admin = createAdminClient();
  const { data: inv } = await admin.from("team_invites").select("business_id, role, area_id, email, expires_at").eq("id", inviteId).is("token", null).maybeSingle();
  if (!inv) return { ok: false, error: "not-found" };
  if (await alreadyInThisTeam(u.id, inv.business_id as string)) return { ok: false, error: "already-in-team" };
  if (inv.email && (inv.email as string).toLowerCase() !== (u.email ?? "").toLowerCase()) return { ok: false, error: "mismatch" };
  if (inv.expires_at && new Date(inv.expires_at as string) < new Date()) return { ok: false, error: "expired" };
  const { error } = await admin.from("business_members").insert({ business_id: inv.business_id, user_id: u.id, role: inv.role, area_id: inv.area_id ?? null });
  if (error) return { ok: false, error: error.message };
  await admin.from("team_invites").delete().eq("id", inviteId);
  // Entrar a la organización a la que te acaban de invitar es lo que espera cualquiera; sin esto
  // aterrizarías en la primera que tengas y parecería que la invitación no hizo nada.
  (await cookies()).set(ORG_COOKIE, inv.business_id as string, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Decline (dismiss) a direct invite addressed to me. */
export async function declineInvite(inviteId: string): Promise<void> {
  const u = await me();
  if (!u?.email) return;
  const admin = createAdminClient();
  const { data: inv } = await admin.from("team_invites").select("email").eq("id", inviteId).maybeSingle();
  if ((inv?.email as string | undefined)?.toLowerCase() === u.email.toLowerCase()) await admin.from("team_invites").delete().eq("id", inviteId);
}

/** Join a team via a share-link token. */
export async function acceptToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const u = await me();
  if (!u) return { ok: false, error: "auth" };
  const admin = createAdminClient();
  const { data: inv } = await admin.from("team_invites").select("id, business_id, role, area_id, expires_at, max_uses, used_count").eq("token", token).maybeSingle();
  if (!inv) return { ok: false, error: "invalid" };
  if (await alreadyInThisTeam(u.id, inv.business_id as string)) return { ok: false, error: "already-in-team" };
  if (inv.expires_at && new Date(inv.expires_at as string) < new Date()) return { ok: false, error: "expired" };
  if (inv.max_uses != null && (inv.used_count as number) >= (inv.max_uses as number)) return { ok: false, error: "used" };
  const { error } = await admin.from("business_members").insert({ business_id: inv.business_id, user_id: u.id, role: inv.role, area_id: inv.area_id ?? null });
  if (error) return { ok: false, error: error.message };
  await admin.from("team_invites").update({ used_count: (inv.used_count as number) + 1 }).eq("id", inv.id as string);
  (await cookies()).set(ORG_COOKIE, inv.business_id as string, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true };
}
