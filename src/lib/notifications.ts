import { createClient } from "@/lib/supabase/server";

/** Count of chats with unread messages — badge on the Chat nav item. */
export async function getMyChatBadge(businessId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gt("unread", 0);
  return count ?? 0;
}

/** Chat nav badges: `mine` = your assigned chats with unread; `unassigned` = new chats nobody
 *  has picked up yet (not resolved). */
export async function getChatBadges(businessId: string, userId: string): Promise<{ mine: number; unassigned: number }> {
  const supabase = await createClient();
  const [mine, unassigned] = await Promise.all([
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).eq("assignee_id", userId).gt("unread", 0).neq("status", "resolved"),
    supabase.from("conversations").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).is("assignee_id", null).neq("status", "resolved"),
  ]);
  return { mine: mine.count ?? 0, unassigned: unassigned.count ?? 0 };
}

export interface Notif {
  id: string;
  name: string;
  unread: number;
  at: string | null;
}

/** Recent relevant events for the bell: conversations with unread messages. */
export async function getNotifications(businessId: string): Promise<Notif[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, unread, last_message_at, contact:contacts(name)")
    .eq("business_id", businessId)
    .gt("unread", 0)
    .order("last_message_at", { ascending: false })
    .limit(12);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: ((c.contact as { name?: string } | null)?.name) ?? "—",
    unread: (c.unread as number) ?? 0,
    at: (c.last_message_at as string) ?? null,
  }));
}
