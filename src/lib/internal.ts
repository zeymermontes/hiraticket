import { createClient } from "@/lib/supabase/server";
import { getAgents, type Agent } from "@/lib/chat";
import { MSG_PAGE } from "@/lib/types";

export const TEAM_CHANNEL = "team";
/** Stable channel key for a DM between two members (order-independent). */
export function dmKey(a: string, b: string): string {
  return "dm:" + [a, b].sort().join(":");
}

export interface InternalMsg {
  id: string;
  channel: string;
  author_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
}

export interface InternalThread {
  key: string;                 // channel key
  kind: "team" | "dm";
  title: string;               // "Equipo" or the other agent's name
  otherId: string | null;      // the DM partner's user id
  color: string;               // avatar color
  lastBody: string | null;
  lastAt: string | null;
  lastAuthorId: string | null;
  unread: number;
}

/** Team channel + a DM thread per other agent, with last message + unread for each. */
export async function getInternalThreads(businessId: string, userId: string): Promise<{ threads: InternalThread[]; agents: Agent[] }> {
  const supabase = await createClient();
  const agents = await getAgents(businessId);
  const [readsRes, msgsRes] = await Promise.all([
    supabase.from("internal_reads").select("channel, last_read_at").eq("business_id", businessId).eq("user_id", userId),
    supabase.from("internal_messages").select("id, channel, author_id, body, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(500),
  ]);
  const reads = new Map<string, string>(((readsRes.data ?? []) as { channel: string; last_read_at: string }[]).map((r) => [r.channel, r.last_read_at]));
  const msgs = (msgsRes.data ?? []) as { id: string; channel: string; author_id: string | null; body: string; created_at: string }[];

  // Aggregate last message + unread per channel (msgs are newest-first → first seen is the last message).
  const agg = new Map<string, { last: typeof msgs[number]; unread: number }>();
  for (const m of msgs) {
    const a = agg.get(m.channel);
    const lastRead = reads.get(m.channel);
    const isUnread = m.author_id !== userId && (!lastRead || m.created_at > lastRead);
    if (!a) agg.set(m.channel, { last: m, unread: isUnread ? 1 : 0 });
    else if (isUnread) a.unread += 1;
  }

  const threadFor = (key: string, kind: "team" | "dm", title: string, otherId: string | null, color: string): InternalThread => {
    const a = agg.get(key);
    return { key, kind, title, otherId, color, lastBody: a?.last.body ?? null, lastAt: a?.last.created_at ?? null, lastAuthorId: a?.last.author_id ?? null, unread: a?.unread ?? 0 };
  };

  const team = threadFor(TEAM_CHANNEL, "team", "", null, "#0E8C82");
  const dms = agents.filter((ag) => ag.id !== userId).map((ag) => threadFor(dmKey(userId, ag.id), "dm", ag.name, ag.id, ag.color));
  // Team first, then DMs: ones with messages by recency, then the rest alphabetically.
  dms.sort((x, y) => {
    if (!!x.lastAt !== !!y.lastAt) return x.lastAt ? -1 : 1;
    if (x.lastAt && y.lastAt) return x.lastAt > y.lastAt ? -1 : 1;
    return x.title.localeCompare(y.title);
  });
  return { threads: [team, ...dms], agents };
}

/** Messages for one internal channel, oldest→newest, paginated (newest page, or older than `before`). */
export async function getInternalMessages(businessId: string, channel: string, opts?: { before?: string; limit?: number }): Promise<InternalMsg[]> {
  const supabase = await createClient();
  const limit = opts?.limit ?? MSG_PAGE;
  let q = supabase.from("internal_messages").select("id, channel, author_id, body, mentions, created_at").eq("business_id", businessId).eq("channel", channel).order("created_at", { ascending: false }).limit(limit);
  if (opts?.before) q = q.lt("created_at", opts.before);
  const { data } = await q;
  const msgs = ((data ?? []) as unknown as InternalMsg[]).map((m) => ({ ...m, mentions: Array.isArray(m.mentions) ? m.mentions : [] }));
  msgs.reverse();
  return msgs;
}
