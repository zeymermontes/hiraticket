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
  kind: "chat" | "mention";
  href: string;
  text?: string;
}

/** Recent relevant events for the bell: @mentions of you in notes + chats with unread. */
export async function getNotifications(businessId: string, userId: string, myName: string): Promise<Notif[]> {
  const supabase = await createClient();

  const [chatsRes, notesRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, unread, last_message_at, contact:contacts(name)")
      .eq("business_id", businessId)
      .eq("assignee_id", userId) // bell = chats assigned to you (+ mentions below)
      .gt("unread", 0)
      .order("last_message_at", { ascending: false })
      .limit(12),
    myName
      ? supabase
          .from("notes")
          .select("id, parent_type, parent_id, author_id, body, created_at")
          .eq("business_id", businessId)
          .neq("author_id", userId)
          .ilike("body", `%@${myName}%`)
          .order("created_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // Resolve mention authors' names.
  const authorIds = Array.from(new Set((notesRes.data ?? []).map((n: Record<string, unknown>) => n.author_id as string).filter(Boolean)));
  const nameMap = new Map<string, string>();
  if (authorIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
    (profs ?? []).forEach((p) => nameMap.set(p.id as string, (p.full_name as string) || "Agente"));
  }

  const mentions: Notif[] = (notesRes.data ?? []).map((n: Record<string, unknown>) => {
    const author = nameMap.get(n.author_id as string) ?? "Alguien";
    const href = n.parent_type === "order" ? `/orders?order=${n.parent_id}` : `/chat?c=${n.parent_id}`;
    return { id: "note-" + (n.id as string), name: author, unread: 1, at: (n.created_at as string) ?? null, kind: "mention" as const, href, text: `${author} te mencionó` };
  });

  const chats: Notif[] = (chatsRes.data ?? []).map((c: Record<string, unknown>) => {
    const name = ((c.contact as { name?: string } | null)?.name) ?? "—";
    return { id: c.id as string, name, unread: (c.unread as number) ?? 0, at: (c.last_message_at as string) ?? null, kind: "chat" as const, href: `/chat?c=${c.id as string}` };
  });

  return [...mentions, ...chats].slice(0, 16);
}
