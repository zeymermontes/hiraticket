import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DetailedAgent {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  role: "admin" | "agent" | "viewer";
  email: string | null;
  area: { id: string; name: string; color: string } | null;
  openChats: number;
  openOrders: number;
}

/** Agents with email, area, and open chat/order counts for the Agents admin table. */
export async function getAgentsDetailed(businessId: string): Promise<DetailedAgent[]> {
  const supabase = await createClient();

  // Igual que en getAgents: el color de la membresía manda sobre el del perfil (0085).
  let members = (await supabase.from("business_members").select("user_id, role, area_id, avatar_color").eq("business_id", businessId)).data as Record<string, unknown>[] | null;
  if (!members) members = (await supabase.from("business_members").select("user_id, role, area_id").eq("business_id", businessId)).data as Record<string, unknown>[] | null;
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id as string);
  const [{ data: profsRaw }, { data: areas }, { data: convs }, { data: orders }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, avatar_color, avatar_url").in("id", ids),
    supabase.from("areas").select("id, name, color").eq("business_id", businessId),
    (async () => {
      // Workload counts follow the connected number, like the chat list (0078).
      const { connectedNumberPhone } = await import("@/lib/chat");
      const connPhone = await connectedNumberPhone(businessId);
      let q = supabase.from("conversations").select("assignee_id").eq("business_id", businessId).neq("status", "resolved");
      if (connPhone) q = q.eq("number_phone", connPhone);
      return q;
    })(),
    supabase.from("orders").select("assignee_id").eq("business_id", businessId),
  ]);
  // avatar_url (0045) may not be applied yet — fall back without it.
  const profs = profsRaw ?? (await supabase.from("profiles").select("id, full_name, avatar_color").in("id", ids)).data;

  const pmap = new Map(((profs ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p]));
  const amap = new Map((areas ?? []).map((a) => [a.id as string, a]));
  const chatCount = new Map<string, number>();
  (convs ?? []).forEach((c) => { if (c.assignee_id) chatCount.set(c.assignee_id as string, (chatCount.get(c.assignee_id as string) ?? 0) + 1); });
  const orderCount = new Map<string, number>();
  (orders ?? []).forEach((o) => { if (o.assignee_id) orderCount.set(o.assignee_id as string, (orderCount.get(o.assignee_id as string) ?? 0) + 1); });

  // Emails come from auth.users (service-role only); best-effort, fetched only for
  // this business's members (not the whole platform).
  const emailMap = new Map<string, string>();
  try {
    const admin = createAdminClient();
    const results = await Promise.all(ids.map((id) => admin.auth.admin.getUserById(id)));
    results.forEach((r) => { const u = r.data?.user; if (u?.email) emailMap.set(u.id, u.email); });
  } catch { /* admin not configured — skip emails */ }

  return members.map((m) => {
    const uid = m.user_id as string;
    const p = pmap.get(uid);
    const ar = m.area_id ? amap.get(m.area_id as string) : null;
    return {
      id: uid,
      name: (p?.full_name as string) || "Agente",
      color: (m.avatar_color as string | null) || (p?.avatar_color as string) || "#5A6373",
      avatar_url: (p?.avatar_url as string | null) ?? null,
      role: m.role as DetailedAgent["role"],
      email: emailMap.get(uid) ?? null,
      area: ar ? { id: ar.id as string, name: ar.name as string, color: ar.color as string } : null,
      openChats: chatCount.get(uid) ?? 0,
      openOrders: orderCount.get(uid) ?? 0,
    };
  });
}
