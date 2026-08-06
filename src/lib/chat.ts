import { cache } from "react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MSG_PAGE } from "@/lib/types";
import { decryptBody } from "@/lib/msgcrypto";
import { getSessions } from "@/lib/whatsapp";

const PUBLIC_MEDIA_MARKER = "/object/public/media/";
/** Stored media_url → storage path (handles raw paths and legacy full public URLs). */
function mediaPath(u: string | null): string | null {
  if (!u) return null;
  const i = u.indexOf(PUBLIC_MEDIA_MARKER);
  if (i >= 0) return decodeURIComponent(u.slice(i + PUBLIC_MEDIA_MARKER.length));
  if (!u.startsWith("http")) return u; // already a bare path
  return null; // external URL — leave untouched
}

/**
 * La miniatura viaja SIEMPRE, sin importar el peso de la foto.
 *
 * Antes se quitaba en las fotos livianas para ahorrar payload —- pesa ~10 KB en base64 y con
 * cincuenta fotos eran 500 KB por carga. Eso tenía sentido cuando la burbuja cargaba el original:
 * la miniatura solo ahorraba medio segundo de rectángulo gris.
 *
 * Ya no: el hilo nunca carga el original (ver MediaImage), así que sin miniatura la foto se queda en
 * un "Ver foto" y hay que hacer clic para verla. Los 500 KB de miniaturas reemplazan varios MB de
 * originales, así que el cambio sale ganando de sobra.
 */
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
      // media_path viaja junto con la URL firmada: es la identidad estable del archivo y es lo que
      // el navegador usa como llave de caché, porque el token de la firma cambia en cada llamada.
      return p && signed.has(p) ? { ...m, media_url: signed.get(p)!, media_path: p } : m;
    });
  } catch {
    return messages; // admin/storage not configured — leave as-is
  }
}

export interface Agent {
  id: string;
  name: string;
  color: string;
  avatar_url: string | null;
  role: "admin" | "agent" | "viewer";
}

export interface ConvListItem {
  id: string;
  status: "open" | "pending" | "resolved";
  unread: number;
  last_message_at: string | null;
  assignee_id: string | null;
  locked_to: string | null; // pinned to this agent ("mantener conmigo") — never auto-reassigned
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
  muted: boolean; // "stop listening" — incoming messages are dropped by the worker
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
  /** Ruta en storage, estable. `media_url` es una URL firmada cuyo token cambia en cada llamada,
   *  así que esta es la llave de caché del navegador (ver `useCachedMedia`). */
  media_path?: string | null;
  media_mime: string | null;
  media_name: string | null;
  media_purged_at?: string | null; // 0066 — el archivo se purgó por peso+antigüedad
  media_size?: number | null;        // 0067 — tamaño, para mostrarlo antes de bajar
  media_pending?: boolean;           // 0067 — pesado: hay puntero pero aún no se baja
  media_fetch_error?: string | null; // 0067 — "expired" si WhatsApp ya lo purgó
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
  actor_id: string | null; // which agent performed the action (null = system/automation)
}

export interface ChatOrderCard {
  id: string;
  code: string;
  total: number;
  pay_status: string;
  priority: string;
  stage_id: string | null;
  assignee_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  items: { name: string; qty: number; unit_price: number; subtotal: number }[];
  cancelled_at?: string | null; // 0065
}

export interface ConvDetail {
  id: string;
  status: "open" | "pending" | "resolved";
  assignee_id: string | null;
  locked_to: string | null; // pinned to this agent ("mantener conmigo")
  unread: number;
  hidden: boolean;
  snoozed_until: string | null;
  area: { name: string; color: string } | null;
  contact: { id: string; name: string; phone: string | null; tags: string[]; avatar_url: string | null; created_at: string | null } | null;
  typing_until: string | null;
  is_group: boolean; // WhatsApp group chat (chat-only — no orders)
  muted: boolean; // "stop listening" — incoming messages are dropped by the worker
  messages: ChatMessage[];
  notes: ConvNote[];
  events: ConvEvent[];
  orders: ChatOrderCard[];
}

/** Members of a business with their display name + avatar color. */
async function _getAgents(businessId: string): Promise<Agent[]> {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("business_members")
    .select("user_id, role")
    .eq("business_id", businessId);
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id as string);
  // avatar_url (0045) may not be applied yet — fall back without it.
  let profs = (await supabase.from("profiles").select("id, full_name, avatar_color, avatar_url").in("id", ids)).data as Record<string, unknown>[] | null;
  if (!profs) profs = (await supabase.from("profiles").select("id, full_name, avatar_color").in("id", ids)).data as Record<string, unknown>[] | null;

  const pmap = new Map((profs ?? []).map((p) => [p.id as string, p]));
  return members.map((m) => {
    const p = pmap.get(m.user_id as string);
    return {
      id: m.user_id as string,
      name: (p?.full_name as string) || "Agente",
      color: (p?.avatar_color as string) || "#5A6373",
      avatar_url: (p?.avatar_url as string | null) ?? null,
      role: m.role as Agent["role"],
    };
  });
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getAgents = cache(_getAgents);

/** Recientes que conserva la bandeja. Es memoria de uso, no un archivo: pasado eso, el sticker
 *  que sigues usando reaparece solo y el que no, estorba. Los favoritos no tienen tope. */
const RECENT_STICKERS = 20;

/** `path` = la ruta del archivo en storage. Es la identidad del sticker: la misma da igual si salió
 *  de un chat de WhatsApp o de uno interno, y es lo que se manda para reenviarlo (ver 0070). */
export interface StickerItem { path: string; url: string; fav: boolean; name?: string | null; tags?: string[] }

/** The send-sticker tray: favorites (pinned, with name/tags) + recent distinct stickers used.
 *  Recents come from BOTH surfaces — WhatsApp and internal chats — because a sticker you sent to a
 *  teammate is just as much part of your library as one you sent to a customer. */
export async function getStickerTray(businessId: string): Promise<{ favorites: StickerItem[]; recent: StickerItem[] }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  // Favoritos: los míos, más los antiguos sin dueño (0069), que se siguen viendo para no
  // desaparecerle a nadie lo que ya tenía. SIN límite: son una lista curada, no un historial.
  const favCols = (meta: string) => supabase.from("sticker_favorites").select(`media_url${meta}`)
    .eq("business_id", businessId)
    .or(`created_by.eq.${user?.id ?? "00000000-0000-0000-0000-000000000000"},created_by.is.null`)
    .order("created_at", { ascending: false });
  const recentFrom = (table: string) => supabase.from(table)
    .select("media_url, created_at").eq("business_id", businessId).eq("type", "sticker")
    .not("media_url", "is", null).order("created_at", { ascending: false }).limit(200);
  const [waRes, inRes, favRes0] = await Promise.all([
    recentFrom("messages"),
    recentFrom("internal_messages"),
    favCols(", name, tags"),
  ]);
  // name/tags (0034) may not be applied yet → retry without them.
  const favRes = favRes0.error ? await favCols("") : favRes0;
  const favRows = (favRes.error ? [] : (favRes.data ?? [])) as unknown as { media_url: string; name?: string | null; tags?: string[] }[];
  const favPaths = new Set(favRows.map((f) => f.media_url));

  // Las dos fuentes se mezclan por fecha y se deduplican por ruta: el mismo sticker reenviado mil
  // veces, o mandado en los dos lados, aparece una sola vez y en el lugar que le toca por reciente.
  type Row = { media_url: string; created_at: string };
  const seen = new Set<string>();
  const uniqRecent = [...((waRes.data ?? []) as Row[]), ...((inRes.data ?? []) as Row[])]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .filter((r) => r.media_url && !seen.has(r.media_url) && (seen.add(r.media_url), true))
    .slice(0, RECENT_STICKERS);

  // Sign favorites + recent together (one signing batch), then split back.
  const stubs = [...favRows, ...uniqRecent].map((r) => ({ media_url: r.media_url }));
  const signed = await signMedia(stubs as unknown as ChatMessage[]);
  const favorites = signed.slice(0, favRows.length)
    .map((s, i) => ({ path: favRows[i].media_url, url: s.media_url!, fav: true, name: favRows[i].name ?? null, tags: favRows[i].tags ?? [] }))
    .filter((s) => !!s.url);
  const recent = signed.slice(favRows.length)
    .map((s, i) => ({ path: uniqRecent[i].media_url, url: s.media_url!, fav: favPaths.has(uniqRecent[i].media_url) }))
    .filter((s) => !!s.url);
  return { favorites, recent };
}

export type ConvTab = "all" | "mine" | "unassigned";
export type ConvStatusFilter = "" | "active" | "open" | "pending" | "resolved" | "trash";

/** Everything the chat list filters by. What used to run over the whole in-memory list now runs
 *  in SQL — except the message-text match, which can't (bodies are encrypted at rest), so the
 *  client resolves those to conversation ids from its local cache and passes them as `extraIds`. */
export interface ConvQuery {
  tab?: ConvTab;
  meId?: string;
  areaId?: string;
  status?: ConvStatusFilter;
  unreadOnly?: boolean;
  archived?: boolean;      // show the snoozed/hidden view instead of the active one
  q?: string;              // contact-name search
  extraIds?: string[];     // conversation ids matched locally by message text — ORed with the name match
  limit?: number;          // window measured from the top of the list (see ChatScreen: always offset 0)
  /** "view" (default) applies the list's own filters — archived/stale/status/unread. "all" skips
   *  them and returns conversations regardless of view, for callers that do their own filtering. */
  scope?: "view" | "all";
}

export interface ConvListPage {
  rows: ConvListItem[];
  total: number;
}

/** Chats with no activity in this long fall into the "trash" view. Mirrors STALE_DAYS in ChatScreen. */
const STALE_DAYS = 90;
const CONTACT_MATCH_CAP = 500;

const CONV_BASE = "id, status, unread, last_message_at, assignee_id, area_id, hidden, snoozed_until";
const CONV_JOINS = "area:areas(name,color), contact:contacts(id,name,phone,avatar_url,tags)";
const CONV_OPT = "typing_until, is_group, muted, locked_to"; // 0027 / 0032 / 0035 / 0044
const CONV_LAST = "last_body, last_dir, last_state, last_type, last_deleted"; // 0060
const CONV_EMB = "messages(body,created_at,direction,state,type,deleted)";

type LastMsg = { body: string; created_at: string; direction: string; state: string | null; type: string; deleted: boolean };

function mapConvRow(businessId: string, c: Record<string, unknown>, legacy: boolean): ConvListItem {
  let body: string | null, dir: string | null, state: string | null, type: string, del: boolean;
  if (legacy) {
    const msgs = (c.messages as LastMsg[]) ?? [];
    const last = msgs.reduce<LastMsg | null>((acc, m) => (!acc || m.created_at > acc.created_at ? m : acc), null);
    body = last?.body ?? null;
    dir = last?.direction ?? null;
    state = last?.state ?? null;
    type = last?.type ?? "text";
    del = last?.deleted ?? false;
  } else {
    body = (c.last_body as string | null) ?? null;
    dir = (c.last_dir as string | null) ?? null;
    state = (c.last_state as string | null) ?? null;
    type = (c.last_type as string | null) ?? "text";
    del = (c.last_deleted as boolean) ?? false;
  }
  return {
    id: c.id,
    status: c.status,
    unread: c.unread,
    last_message_at: c.last_message_at,
    assignee_id: c.assignee_id,
    locked_to: (c.locked_to as string) ?? null,
    hidden: c.hidden,
    snoozed_until: c.snoozed_until,
    area: c.area,
    contact: c.contact,
    preview: decryptBody(businessId, body ?? ""),
    lastOut: dir === "out",
    lastState: state,
    lastType: type,
    lastDeleted: del,
    typing_until: (c.typing_until as string | null) ?? null,
    is_group: (c.is_group as boolean) ?? false,
    muted: (c.muted as boolean) ?? false,
  } as ConvListItem;
}

/** The number the business is connected as right now, or null. Threads are scoped to it (0078):
 *  connected → only this number's conversations are listed; disconnected → everything shows.
 *  getSessions is React-cache()d, so this piggybacks on the fetch the layout already does.
 *  Shared by every surface that counts/lists conversations (list, chips, badges, bell, agents). */
export async function connectedNumberPhone(businessId: string): Promise<string | null> {
  const sessions = await getSessions(businessId);
  return sessions.find((s) => s.status === "connected" && s.phone)?.phone ?? null;
}

/** One window of the chat list, filtered and counted in Postgres. */
export async function getConversationListPage(businessId: string, f: ConvQuery = {}): Promise<ConvListPage> {
  const supabase = await createClient();
  const connPhone = await connectedNumberPhone(businessId);
  const nowISO = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const trash = f.status === "trash";

  // Contact-name matches. The message-text half of the search arrives as extraIds from the client's
  // local cache — last_body is ciphertext in Postgres, so no ILIKE can reach it.
  const needle = (f.q ?? "").trim().replace(/[(),]/g, " ").trim();
  let contactIds: string[] = [];
  if (needle) {
    const { data } = await supabase.from("contacts").select("id").eq("business_id", businessId)
      .ilike("name", `%${needle}%`).limit(CONTACT_MATCH_CAP);
    contactIds = (data ?? []).map((c) => c.id as string);
  }
  const extraIds = f.extraIds ?? [];
  // A search with no name hits and no local hits matches nothing — don't fall through to "no filter".
  if (needle && !contactIds.length && !extraIds.length) return { rows: [], total: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = <T extends Record<string, any>>(b: T, withNum: boolean): T => {
    let x = b.eq("business_id", businessId);
    if (withNum && connPhone) x = x.eq("number_phone", connPhone); // threads of the connected number only (0078)
    if (f.tab === "mine" && f.meId) x = x.eq("assignee_id", f.meId);
    if (f.tab === "unassigned") x = x.is("assignee_id", null);
    if (f.areaId) x = x.eq("area_id", f.areaId);
    if (f.scope === "all") {
      // no view filters — the caller wants every conversation regardless of archived/stale/status
    } else if (trash) {
      x = x.lt("last_message_at", staleCutoff); // stale only; NULL never compares true, matching isStale(null)=false
    } else {
      // Not stale. Multiple .or() calls land as separate PostgREST `or=` params, which are ANDed.
      x = x.or(`last_message_at.is.null,last_message_at.gte.${staleCutoff}`);
      if (f.archived) x = x.or(`hidden.is.true,snoozed_until.gt.${nowISO}`);
      else x = x.eq("hidden", false).or(`snoozed_until.is.null,snoozed_until.lte.${nowISO}`);
      if (f.status === "active") x = x.in("status", ["open", "pending"]);
      else if (f.status) x = x.eq("status", f.status);
      if (f.unreadOnly) x = x.gt("unread", 0);
    }
    if (needle) {
      const ors: string[] = [];
      if (contactIds.length) ors.push(`contact_id.in.(${contactIds.join(",")})`);
      if (extraIds.length) ors.push(`id.in.(${extraIds.join(",")})`);
      x = x.or(ors.join(","));
    }
    return x;
  };

  const run = (cols: string, withNum: boolean) =>
    applyFilters(supabase.from("conversations").select(cols, { count: "exact" }), withNum)
      .order("last_message_at", { ascending: false })
      .limit(Math.min(Math.max(f.limit ?? 40, 1), 500));

  const attempt = async (withNum: boolean) => {
    // Preferred: the preview lives on the conversation row (kept in sync by the 0060 trigger).
    let r = await run(`${CONV_BASE}, ${CONV_OPT}, ${CONV_LAST}, ${CONV_JOINS}`, withNum);
    if (r.error) r = await run(`${CONV_BASE}, ${CONV_LAST}, ${CONV_JOINS}`, withNum);
    // 0060 not applied yet → derive the preview from an embed. Correct, but it pulls the matched
    // conversations' whole history; apply 0060 to get off this path.
    let legacy = false;
    if (r.error) {
      legacy = true;
      r = await run(`${CONV_BASE}, ${CONV_OPT}, ${CONV_JOINS}, ${CONV_EMB}`, withNum);
      if (r.error) r = await run(`${CONV_BASE}, ${CONV_JOINS}, ${CONV_EMB}`, withNum);
    }
    return { ...r, legacy };
  };

  let res = await attempt(Boolean(connPhone));
  if (res.error && connPhone) res = await attempt(false); // 0078 not applied yet → unfiltered list
  const { data, error, count, legacy } = res;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => mapConvRow(businessId, c, legacy));
  return { rows, total: count ?? rows.length };
}

export interface ChatListCounts {
  all: number; active: number; open: number; pending: number; resolved: number;
  unread: number; trash: number; archived: number; mine: number; unassigned: number;
}

const EMPTY_COUNTS: ChatListCounts = { all: 0, active: 0, open: 0, pending: 0, resolved: 0, unread: 0, trash: 0, archived: 0, mine: 0, unassigned: 0 };

/** Tab badges + chip counts, in one round trip (0062). */
export async function getChatListCounts(
  businessId: string, meId: string, opts?: { areaId?: string; archived?: boolean; tab?: ConvTab },
): Promise<ChatListCounts> {
  const supabase = await createClient();
  const base = {
    p_business: businessId,
    p_me: meId,
    p_area: opts?.areaId ?? null,
    p_archived: opts?.archived ?? false,
    p_tab: opts?.tab ?? "all",
  };
  const connPhone = await connectedNumberPhone(businessId);
  let { data, error } = await supabase.rpc("chat_list_counts", connPhone ? { ...base, p_phone: connPhone } : base);
  // 0078 not applied yet (old 5-arg RPC) → count without the number scope.
  if (error && connPhone) ({ data, error } = await supabase.rpc("chat_list_counts", base));
  if (error || !data) return EMPTY_COUNTS; // 0062 not applied → the chips just read 0 rather than breaking the list
  return { ...EMPTY_COUNTS, ...(data as Partial<ChatListCounts>) };
}

/** The whole list, unfiltered — kept for callers that want every conversation (e.g. the backfill
 *  sweep, which walks recent chats). Prefer getConversationListPage for anything user-facing. */
export async function getConversationList(businessId: string, limit = 500): Promise<ConvListItem[]> {
  const { rows } = await getConversationListPage(businessId, { limit, scope: "all" });
  return rows;
}

const MSG_FULL = "id, business_id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted, forwarded, edited, meta, reactions";
const MSG_BASE = "id, business_id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted";

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
  // media_purged_at (0066) va en su propio nivel: metiéndolo en MSG_FULL, un despliegue sin la
  // migración caería hasta MSG_BASE y se perderían reacciones, forwarded y edited.
  let res = await q(MSG_FULL + ", media_purged_at, media_size, media_fetch_error, media_ptr, sender_name, sender_jid");
  if (res.error) res = await q(MSG_FULL + ", sender_name, sender_jid");
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
    // media_ptr NO se manda al navegador (lleva la mediaKey del archivo): solo si está pendiente.
    messages = ((res.data ?? []) as unknown as (ChatMessage & { media_ptr?: unknown })[]).map(({ media_ptr, ...m }) => ({ ...m, media_pending: !!media_ptr, reactions: Array.isArray(m.reactions) ? m.reactions : [] })) as ChatMessage[];
  }
  // Decrypt at-rest bodies (legacy plaintext passes through untouched).
  messages = messages.map((m) => ({ ...m, body: m.body ? decryptBody((m as unknown as { business_id?: string }).business_id ?? "", m.body) : m.body }));
  messages.reverse(); // chronological (oldest first)
  return signMedia(messages);
}

/** Pedidos del cliente para el panel de la conversación. La papelera queda fuera: un pedido
 *  borrado seguía apareciendo aquí aunque ya no estuviera ni en la tabla ni en el tablero.
 *  cancelled_at (0065) va con fallback para que el panel no se vacíe si aún no está aplicada. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ordersOfContact(supabase: any, contactId: string) {
  const q = (cancel: string) => supabase.from("orders")
    .select(`id, code, total, pay_status, priority, stage_id, assignee_id, created_at, updated_at, ${cancel}stage:stages!stage_id(name,color), area:areas(name,color), items:order_items(name, qty, unit_price, subtotal)`)
    .eq("contact_id", contactId).is("deleted_at", null)
    .order("created_at", { ascending: false });
  const res = await q("cancelled_at, ");
  return res.error ? await q("") : res;
}

export async function getConversationDetail(
  convId: string,
): Promise<ConvDetail | null> {
  const supabase = await createClient();

  const convCols = (opt: string) =>
    `id, status, assignee_id, contact_id, unread, hidden, snoozed_until, ${opt}area:areas(name,color), contact:contacts(id,name,phone,tags,avatar_url,created_at)`;
  let convRaw, convErr;
  ({ data: convRaw, error: convErr } = await supabase.from("conversations").select(convCols("typing_until, is_group, muted, locked_to, ")).eq("id", convId).maybeSingle());
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
        .select("id, kind, text, created_at, actor_id")
        .eq("parent_type", "conversation")
        .eq("parent_id", convId)
        .order("created_at", { ascending: false }),
      conv.contact_id ? ordersOfContact(supabase, conv.contact_id) : Promise.resolve({ data: [] as unknown[] }),
    ]);

  return {
    id: conv.id,
    status: conv.status,
    assignee_id: conv.assignee_id,
    locked_to: ((conv as { locked_to?: string | null }).locked_to) ?? null,
    unread: conv.unread ?? 0,
    hidden: conv.hidden,
    snoozed_until: conv.snoozed_until,
    area: conv.area as unknown as ConvDetail["area"],
    contact: conv.contact as unknown as ConvDetail["contact"],
    typing_until: ((conv as { typing_until?: string | null }).typing_until) ?? null,
    is_group: ((conv as { is_group?: boolean }).is_group) ?? false,
    muted: ((conv as { muted?: boolean }).muted) ?? false,
    messages: (messages ?? []) as ChatMessage[],
    notes: (notes ?? []) as ConvNote[],
    events: (events ?? []) as ConvEvent[],
    orders: (orders ?? []) as unknown as ChatOrderCard[],
  };
}
