import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAgents, type Agent } from "@/lib/chat";
import { MSG_PAGE } from "@/lib/types";
import { decryptBody } from "@/lib/msgcrypto";

/** Replace stored media paths with short-lived signed URLs (private 'media' bucket). */
async function signInternalMedia(msgs: InternalMsg[]): Promise<InternalMsg[]> {
  const paths = [...new Set(msgs.map((m) => m.media_url).filter((p): p is string => !!p && !p.startsWith("http")))];
  if (!paths.length) return msgs;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    const admin = createAdminClient();
    const { data } = await admin.storage.from("media").createSignedUrls(paths, 60 * 60 * 24 * 7);
    const signed = new Map<string, string>();
    (data ?? []).forEach((s) => { if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl.startsWith("http") ? s.signedUrl : base + s.signedUrl); });
    // media_path conserva la ruta: la URL firmada cambia de token en cada llamada, así que no sirve
    // como llave de caché en el navegador (ver `useCachedMedia`).
    return msgs.map((m) => (m.media_url && signed.has(m.media_url) ? { ...m, media_url: signed.get(m.media_url)!, media_path: m.media_url } : m));
  } catch { return msgs; }
}

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
  reply_to: string | null;
  edited: boolean;
  deleted: boolean;
  reactions: { emoji: string; by: string }[];
  type: string;
  media_url: string | null;
  /** Ruta en storage, estable — llave de caché del navegador. Ver `useCachedMedia`. */
  media_path?: string | null;
  media_mime: string | null;
  media_name: string | null;
  forwarded: boolean;
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
    supabase.from("internal_messages").select("id, channel, author_id, body, created_at, type").eq("business_id", businessId).order("created_at", { ascending: false }).limit(500),
  ]);
  const reads = new Map<string, string>(((readsRes.data ?? []) as { channel: string; last_read_at: string }[]).map((r) => [r.channel, r.last_read_at]));
  const mediaPreview = (t?: string) => (t === "image" ? "📷 Foto" : t && t !== "text" ? "📎 Archivo" : "");
  const msgs = ((msgsRes.data ?? []) as { id: string; channel: string; author_id: string | null; body: string; created_at: string; type?: string }[]).map((m) => ({ ...m, body: decryptBody(businessId, m.body) || mediaPreview(m.type) }));

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

/** Total unread internal messages for the user across every channel they can see (RLS-scoped) —
 *  drives the "Equipo" nav badge. Light query: ids + timestamps only, no agent/title work. */
export async function getInternalUnread(businessId: string, userId: string): Promise<number> {
  const supabase = await createClient();
  const [readsRes, msgsRes] = await Promise.all([
    supabase.from("internal_reads").select("channel, last_read_at").eq("business_id", businessId).eq("user_id", userId),
    supabase.from("internal_messages").select("channel, created_at").eq("business_id", businessId).neq("author_id", userId).order("created_at", { ascending: false }).limit(500),
  ]);
  const reads = new Map<string, string>(((readsRes.data ?? []) as { channel: string; last_read_at: string }[]).map((r) => [r.channel, r.last_read_at]));
  let n = 0;
  for (const m of (msgsRes.data ?? []) as { channel: string; created_at: string }[]) {
    const lastRead = reads.get(m.channel);
    if (!lastRead || m.created_at > lastRead) n++;
  }
  return n;
}

/** Messages for one internal channel, oldest→newest, paginated (newest page, or older than `before`). */
export async function getInternalMessages(businessId: string, channel: string, opts?: { before?: string; limit?: number }): Promise<InternalMsg[]> {
  const supabase = await createClient();
  const limit = opts?.limit ?? MSG_PAGE;
  let q = supabase.from("internal_messages").select("id, channel, author_id, body, mentions, created_at, reply_to, edited, deleted, reactions, type, media_url, media_mime, media_name, forwarded").eq("business_id", businessId).eq("channel", channel).order("created_at", { ascending: false }).limit(limit);
  if (opts?.before) q = q.lt("created_at", opts.before);
  const { data } = await q;
  const msgs = ((data ?? []) as unknown as InternalMsg[]).map((m) => ({ ...m, body: m.body ? decryptBody(businessId, m.body) : m.body, mentions: Array.isArray(m.mentions) ? m.mentions : [], reactions: Array.isArray(m.reactions) ? m.reactions : [], type: m.type ?? "text" }));
  msgs.reverse();
  return signInternalMedia(msgs);
}
