import { createClient } from "@/lib/supabase/server";
import { decryptBody } from "@/lib/msgcrypto";

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
  kind: "chat" | "mention" | "internal";
  href: string;
  text?: string;
}

export type NotifFilter = "all" | "internal" | "mentions";

/** Unified, paginated notification feed: @mentions of you in notes, internal chat messages from
 *  others (in your channels), and your unread WhatsApp chats. Sorted newest-first; pass `before`
 *  (the last item's `at`) to load the next page for infinite scroll. */
export async function getNotificationFeed(
  businessId: string, userId: string, myName: string,
  opts?: { before?: string; filter?: NotifFilter; limit?: number; unreadOnly?: boolean },
): Promise<Notif[]> {
  const supabase = await createClient();
  const { before, filter = "all", limit = 20, unreadOnly = false } = opts ?? {};
  const empty = Promise.resolve({ data: [] as Record<string, unknown>[] });

  // Read cursors per internal channel (only needed to filter internal to unread).
  const reads = new Map<string, string>();
  if (unreadOnly && (filter === "all" || filter === "internal")) {
    const { data } = await supabase.from("internal_reads").select("channel, last_read_at").eq("business_id", businessId).eq("user_id", userId);
    ((data ?? []) as { channel: string; last_read_at: string }[]).forEach((r) => reads.set(r.channel, r.last_read_at));
  }

  // mentions (notes) — for the bell, scope to the last week so the badge doesn't grow unbounded.
  let notesP = empty;
  if ((filter === "all" || filter === "mentions") && myName) {
    let q = supabase.from("notes").select("id, parent_type, parent_id, author_id, body, created_at").eq("business_id", businessId).neq("author_id", userId).ilike("body", `%@${myName}%`).order("created_at", { ascending: false }).limit(limit);
    if (before) q = q.lt("created_at", before);
    if (unreadOnly) q = q.gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    notesP = q as unknown as typeof empty;
  }
  // internal chat (RLS already restricts to the user's team + DM channels)
  let intP = empty;
  if (filter === "all" || filter === "internal") {
    let q = supabase.from("internal_messages").select("id, channel, author_id, body, created_at").eq("business_id", businessId).neq("author_id", userId).order("created_at", { ascending: false }).limit(unreadOnly ? 200 : limit);
    if (before) q = q.lt("created_at", before);
    intP = q as unknown as typeof empty;
  }
  // unread WhatsApp chats assigned to you
  let chatP = empty;
  if (filter === "all") {
    let q = supabase.from("conversations").select("id, unread, last_message_at, contact:contacts(name)").eq("business_id", businessId).eq("assignee_id", userId).gt("unread", 0).order("last_message_at", { ascending: false }).limit(limit);
    if (before) q = q.lt("last_message_at", before);
    chatP = q as unknown as typeof empty;
  }

  const [notesRes, intRes, chatsRes] = await Promise.all([notesP, intP, chatP]);

  const authorIds = Array.from(new Set([...(notesRes.data ?? []), ...(intRes.data ?? [])].map((x: Record<string, unknown>) => x.author_id as string).filter(Boolean)));
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
  let internalRows = (intRes.data ?? []) as Record<string, unknown>[];
  if (unreadOnly) internalRows = internalRows.filter((m) => { const lr = reads.get(m.channel as string); return !lr || (m.created_at as string) > lr; }).slice(0, limit);
  const internal: Notif[] = internalRows.map((m: Record<string, unknown>) => {
    const author = nameMap.get(m.author_id as string) ?? "Agente";
    return { id: "int-" + (m.id as string), name: author, unread: 1, at: (m.created_at as string) ?? null, kind: "internal" as const, href: "/internal", text: `${author}: ${decryptBody(businessId, m.body as string)}`.slice(0, 90) };
  });
  const chats: Notif[] = (chatsRes.data ?? []).map((c: Record<string, unknown>) => {
    const cc = c.contact as { name?: string } | { name?: string }[] | null;
    const name = ((Array.isArray(cc) ? cc[0] : cc)?.name) ?? "—";
    return { id: c.id as string, name, unread: (c.unread as number) ?? 0, at: (c.last_message_at as string) ?? null, kind: "chat" as const, href: `/chat?c=${c.id as string}` };
  });

  return [...mentions, ...internal, ...chats].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, limit);
}

/** Recent notifications for the bell + badge (first page of the unified feed). */
export async function getNotifications(businessId: string, userId: string, myName: string): Promise<Notif[]> {
  return getNotificationFeed(businessId, userId, myName, { filter: "all", limit: 16, unreadOnly: true });
}
