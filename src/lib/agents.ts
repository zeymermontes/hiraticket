import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DetailedAgent {
  id: string;
  name: string;
  color: string;
  role: "admin" | "agent" | "viewer";
  email: string | null;
  area: { name: string; color: string } | null;
  openChats: number;
  openOrders: number;
}

/** Agents with email, area, and open chat/order counts for the Agents admin table. */
export async function getAgentsDetailed(businessId: string): Promise<DetailedAgent[]> {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("business_members")
    .select("user_id, role, area_id")
    .eq("business_id", businessId);
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id as string);
  const [{ data: profs }, { data: areas }, { data: convs }, { data: orders }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, avatar_color").in("id", ids),
    supabase.from("areas").select("id, name, color").eq("business_id", businessId),
    supabase.from("conversations").select("assignee_id").eq("business_id", businessId).neq("status", "resolved"),
    supabase.from("orders").select("assignee_id").eq("business_id", businessId),
  ]);

  const pmap = new Map((profs ?? []).map((p) => [p.id as string, p]));
  const amap = new Map((areas ?? []).map((a) => [a.id as string, a]));
  const chatCount = new Map<string, number>();
  (convs ?? []).forEach((c) => { if (c.assignee_id) chatCount.set(c.assignee_id as string, (chatCount.get(c.assignee_id as string) ?? 0) + 1); });
  const orderCount = new Map<string, number>();
  (orders ?? []).forEach((o) => { if (o.assignee_id) orderCount.set(o.assignee_id as string, (orderCount.get(o.assignee_id as string) ?? 0) + 1); });

  // Emails come from auth.users (service-role only); best-effort.
  const emailMap = new Map<string, string>();
  try {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    (data?.users ?? []).forEach((u) => { if (u.email) emailMap.set(u.id, u.email); });
  } catch { /* admin not configured — skip emails */ }

  return members.map((m) => {
    const uid = m.user_id as string;
    const p = pmap.get(uid);
    const ar = m.area_id ? amap.get(m.area_id as string) : null;
    return {
      id: uid,
      name: (p?.full_name as string) || "Agente",
      color: (p?.avatar_color as string) || "#5A6373",
      role: m.role as DetailedAgent["role"],
      email: emailMap.get(uid) ?? null,
      area: ar ? { name: ar.name as string, color: ar.color as string } : null,
      openChats: chatCount.get(uid) ?? 0,
      openOrders: orderCount.get(uid) ?? 0,
    };
  });
}
