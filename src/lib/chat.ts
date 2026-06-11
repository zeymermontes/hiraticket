import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MSG_PAGE } from "@/lib/types";

const PUBLIC_MEDIA_MARKER = "/object/public/media/";
/** Stored media_url → storage path (handles raw paths and legacy full public URLs). */
function mediaPath(u: string | null): string | null {
  if (!u) return null;
  const i = u.indexOf(PUBLIC_MEDIA_MARKER);
  if (i >= 0) return decodeURIComponent(u.slice(i + PUBLIC_MEDIA_MARKER.length));
  if (!u.startsWith("http")) return u; // already a bare path
  return null; // external URL — leave untouched
}

/** Replace media_url paths with short-lived signed URLs (private 'media' bucket). */
async function signMedia(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const paths = [...new Set(messages.map((m) => mediaPath(m.media_url)).filter((p): p is string => !!p))];
  if (paths.length === 0) return messages;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    const admin = createAdminClient();
    const { data } = await admin.storage.from("media").createSignedUrls(paths, 60 * 60 * 24 * 7);
    const signed = new Map<string, string>();
    (data ?? []).forEach((s) => { if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl.startsWith("http") ? s.signedUrl : base + s.signedUrl); });
    return messages.map((m) => {
      const p = mediaPath(m.media_url);
      return p && signed.has(p) ? { ...m, media_url: signed.get(p)! } : m;
    });
  } catch {
    return messages; // admin/storage not configured — leave as-is
  }
}

export interface Agent {
  id: string;
  name: string;
  color: string;
  role: "admin" | "agent" | "viewer";
}

export interface ConvListItem {
  id: string;
  status: "open" | "pending" | "resolved";
  unread: number;
  last_message_at: string | null;
  assignee_id: string | null;
  hidden: boolean;
  snoozed_until: string | null;
  area: { name: string; color: string } | null;
  contact: { id: string; name: string; phone: string | null; avatar_url: string | null; tags: string[] | null } | null;
  preview: string;
  lastOut: boolean;       // last message was outbound (show delivery ticks before the preview)
  lastState: string | null;
  lastType: string;       // text / image / sticker / audio / video / document / location / contact
  lastDeleted: boolean;
  typing_until: string | null; // customer is typing while this is in the future
  is_group: boolean; // WhatsApp group chat (chat-only — no orders)
}

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  state: string | null;
  author_id: string | null;
  created_at: string;
  media_url: string | null;
  media_mime: string | null;
  media_name: string | null;
  reply_to: string | null;
  deleted: boolean;
  forwarded: boolean;
  edited: boolean;
  meta: Record<string, unknown> | null;
  reactions: { emoji: string; by: string }[];
  sender_name: string | null; // group only: who sent it (shown color-coded above the bubble)
  sender_jid: string | null;  // group only: stable key the UI hashes for the sender's color
}

export interface ConvNote {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface ConvEvent {
  id: string;
  kind: string;
  text: string | null;
  created_at: string;
}

export interface ChatOrderCard {
  id: string;
  code: string;
  total: number;
  priority: string;
  stage_id: string | null;
  assignee_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  items: { name: string; qty: number; unit_price: number; subtotal: number }[];
}

export interface ConvDetail {
  id: string;
  status: "open" | "pending" | "resolved";
  assignee_id: string | null;
  unread: number;
  hidden: boolean;
  snoozed_until: string | null;
  area: { name: string; color: string } | null;
  contact: { id: string; name: string; phone: string | null; tags: string[]; avatar_url: string | null; created_at: string | null } | null;
  typing_until: string | null;
  is_group: boolean; // WhatsApp group chat (chat-only — no orders)
  messages: ChatMessage[];
  notes: ConvNote[];
  events: ConvEvent[];
  orders: ChatOrderCard[];
}

/** Members of a business with their display name + avatar color. */
export async function getAgents(businessId: string): Promise<Agent[]> {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("business_members")
    .select("user_id, role")
    .eq("business_id", businessId);
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id as string);
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_color")
    .in("id", ids);

  const pmap = new Map((profs ?? []).map((p) => [p.id as string, p]));
  return members.map((m) => {
    const p = pmap.get(m.user_id as string);
    return {
      id: m.user_id as string,
      name: (p?.full_name as string) || "Agente",
      color: (p?.avatar_color as string) || "#5A6373",
      role: m.role as Agent["role"],
    };
  });
}

export interface StickerItem { id: string; url: string; fav: boolean } // id = a message to re-send from

/** The send-sticker tray: favorites (pinned) + recent distinct stickers the business has used.
 *  Each item carries a message id to re-send the stored WebP from + a signed preview URL. */
export async function getStickerTray(businessId: string): Promise<{ favorites: StickerItem[]; recent: StickerItem[] }> {
  const supabase = await createClient();
  const [recentRes, favRes] = await Promise.all([
    supabase.from("messages").select("id, media_url").eq("business_id", businessId).eq("type", "sticker").not("media_url", "is", null).order("created_at", { ascending: false }).limit(120),
    supabase.from("sticker_favorites").select("message_id, media_url").eq("business_id", businessId).order("created_at", { ascending: false }),
  ]);
  const favRows = (favRes.error ? [] : (favRes.data ?? [])) as { message_id: string; media_url: string }[];
  const favPaths = new Set(favRows.map((f) => f.media_url));

  // Dedupe recent by stored path (same sticker resent many times → show once).
  const seen = new Set<string>();
  const uniqRecent = ((recentRes.data ?? []) as { id: string; media_url: string }[]).filter((r) => r.media_url && !seen.has(r.media_url) && (seen.add(r.media_url), true)).slice(0, 48);

  // Sign favorites + recent together (one signing batch), then split back.
  const favStubs = favRows.map((f) => ({ id: f.message_id, media_url: f.media_url }));
  const signed = await signMedia([...favStubs, ...uniqRecent] as unknown as ChatMessage[]);
  const favorites = signed.slice(0, favStubs.length).map((s) => ({ id: s.id, url: s.media_url!, fav: true })).filter((s) => !!s.url);
  const recent = signed.slice(favStubs.length).map((s, i) => ({ id: s.id, url: s.media_url!, fav: favPaths.has(uniqRecent[i].media_url) })).filter((s) => !!s.url);
  return { favorites, recent };
}

export async function getConversationList(businessId: string): Promise<ConvListItem[]> {
  const supabase = await createClient();
  const cols = (opt: string) =>
    `id, status, unread, last_message_at, assignee_id, hidden, snoozed_until, ${opt}area:areas(name,color), contact:contacts(id,name,phone,avatar_url,tags), messages(body,created_at,direction,state,type,deleted)`;
  // typing_until (0027) / is_group (0032) may not exist yet — fall back to the base columns.
  let { data, error } = await supabase
    .from("conversations").select(cols("typing_until, is_group, ")).eq("business_id", businessId).order("last_message_at", { ascending: false });
  if (error) {
    ({ data, error } = await supabase
      .from("conversations").select(cols("")).eq("business_id", businessId).order("last_message_at", { ascending: false }));
  }
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
    type LastMsg = { body: string; created_at: string; direction: string; state: string | null; type: string; deleted: boolean };
    const msgs = (c.messages as LastMsg[]) ?? [];
    const last = msgs.reduce<LastMsg | null>(
      (acc, m) => (!acc || m.created_at > acc.created_at ? m : acc),
      null,
    );
    return {
      id: c.id,
      status: c.status,
      unread: c.unread,
      last_message_at: c.last_message_at,
      assignee_id: c.assignee_id,
      hidden: c.hidden,
      snoozed_until: c.snoozed_until,
      area: c.area,
      contact: c.contact,
      preview: last?.body ?? "",
      lastOut: last?.direction === "out",
      lastState: last?.state ?? null,
      lastType: last?.type ?? "text",
      lastDeleted: last?.deleted ?? false,
      typing_until: (c.typing_until as string | null) ?? null,
      is_group: (c.is_group as boolean) ?? false,
    } as ConvListItem;
  });
}

const MSG_FULL = "id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted, forwarded, edited, meta, reactions";
const MSG_BASE = "id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted";

/** Signed messages for a conversation — the high-frequency realtime read (no notes/events/orders).
 *  Loads the most recent `limit` messages, or (with `before`) the page just older than a cursor,
 *  so long conversations don't load all at once. Always returned oldest→newest. */
export async function getConversationMessages(
  convId: string,
  opts?: { before?: string; limit?: number },
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const limit = opts?.limit ?? MSG_PAGE;
  // Fetch the newest `limit` (descending) so we get the tail, then reverse to chronological.
  const q = (cols: string) => {
    let b = supabase.from("messages").select(cols).eq("conversation_id", convId).order("created_at", { ascending: false }).limit(limit);
    if (opts?.before) b = b.lt("created_at", opts.before);
    return b;
  };
  const res = await q(MSG_FULL + ", sender_name, sender_jid");
  let messages: ChatMessage[];
  if (res.error) {
    // sender_name/sender_jid (0032) absent → retry full without them, then the base columns.
    const full = await q(MSG_FULL);
    if (full.error) {
      const base = await q(MSG_BASE);
      messages = ((base.data ?? []) as unknown as Record<string, unknown>[]).map((m) => ({ ...m, forwarded: false, edited: false, meta: null, reactions: [], sender_name: null, sender_jid: null })) as unknown as ChatMessage[];
    } else {
      messages = ((full.data ?? []) as unknown as ChatMessage[]).map((m) => ({ ...m, reactions: Array.isArray(m.reactions) ? m.reactions : [], sender_name: null, sender_jid: null }));
    }
  } else {
    messages = ((res.data ?? []) as unknown as ChatMessage[]).map((m) => ({ ...m, reactions: Array.isArray(m.reactions) ? m.reactions : [] }));
  }
  messages.reverse(); // chronological (oldest first)
  return signMedia(messages);
}

export async function getConversationDetail(
  convId: string,
): Promise<ConvDetail | null> {
  const supabase = await createClient();

  const convCols = (opt: string) =>
    `id, status, assignee_id, contact_id, unread, hidden, snoozed_until, ${opt}area:areas(name,color), contact:contacts(id,name,phone,tags,avatar_url,created_at)`;
  let convRaw, convErr;
  ({ data: convRaw, error: convErr } = await supabase.from("conversations").select(convCols("typing_until, is_group, ")).eq("id", convId).maybeSingle());
  if (convErr) ({ data: convRaw } = await supabase.from("conversations").select(convCols("")).eq("id", convId).maybeSingle());
  if (!convRaw) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conv = convRaw as any; // dynamic select() string defeats column inference

  const [messages, { data: notes }, { data: events }, { data: orders }] =
    await Promise.all([
      getConversationMessages(convId),
      supabase
        .from("notes")
        .select("id, body, author_id, created_at")
        .eq("parent_type", "conversation")
        .eq("parent_id", convId)
        .order("created_at", { ascending: true }),
      supabase
        .from("events")
        .select("id, kind, text, created_at")
        .eq("parent_type", "conversation")
        .eq("parent_id", convId)
        .order("created_at", { ascending: false }),
      conv.contact_id
        ? supabase
            .from("orders")
            .select("id, code, total, priority, stage_id, assignee_id, created_at, updated_at, stage:stages(name,color), area:areas(name,color), items:order_items(name, qty, unit_price, subtotal)")
            .eq("contact_id", conv.contact_id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  return {
    id: conv.id,
    status: conv.status,
    assignee_id: conv.assignee_id,
    unread: conv.unread ?? 0,
    hidden: conv.hidden,
    snoozed_until: conv.snoozed_until,
    area: conv.area as unknown as ConvDetail["area"],
    contact: conv.contact as unknown as ConvDetail["contact"],
    typing_until: ((conv as { typing_until?: string | null }).typing_until) ?? null,
    is_group: ((conv as { is_group?: boolean }).is_group) ?? false,
    messages: (messages ?? []) as ChatMessage[],
    notes: (notes ?? []) as ConvNote[],
    events: (events ?? []) as ConvEvent[],
    orders: (orders ?? []) as unknown as ChatOrderCard[],
  };
}
