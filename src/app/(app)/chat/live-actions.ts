"use server";
// Targeted realtime refetches — used by the client instead of router.refresh() so a new message
// only re-queries what changed, not the whole route (layout badges, agents, other sections…).
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import {
  getConversationMessages, getConversationList, getConversationListPage, getChatListCounts,
  getConversationDetail, getStickerTray,
  type ChatMessage, type ConvListItem, type ConvDetail, type StickerItem,
  type ConvQuery, type ConvListPage, type ChatListCounts, type ConvTab,
} from "@/lib/chat";
import { getChatBadges, getNotifications, getNotificationFeed, type Notif, type NotifFilter } from "@/lib/notifications";
import { getInternalUnread } from "@/lib/internal";
import { getMyBusiness } from "@/lib/queries";

/** Paginated notification feed for the bell + /notifications page (infinite scroll). */
export async function loadNotificationFeed(before?: string, filter: NotifFilter = "all", unreadOnly = false): Promise<Notif[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const biz = await getMyBusiness();
  if (!user || !biz) return [];
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.email ? user.email.split("@")[0] : "");
  return getNotificationFeed(biz.id, user.id, myName, { before, filter, unreadOnly });
}

/** Favorites + recent stickers for the send-sticker tray. */
export async function loadStickerTray(businessId: string): Promise<{ favorites: StickerItem[]; recent: StickerItem[] }> {
  return getStickerTray(businessId);
}

/** Signed messages for the open conversation (high-frequency: fired on every new message). */
export async function liveMessages(convId: string): Promise<ChatMessage[]> {
  return getConversationMessages(convId);
}

/** Older messages (one page before `before`), for lazy-loading history as the agent scrolls up. */
export async function loadOlderMessages(convId: string, before: string): Promise<ChatMessage[]> {
  return getConversationMessages(convId, { before });
}

/** One window of the chat list with the active filters applied server-side. */
export async function liveListPage(businessId: string, f: ConvQuery): Promise<ConvListPage> {
  return getConversationListPage(businessId, f);
}

/** Tab badges + chip counts for the chat list (single RPC). */
export async function liveChatCounts(
  businessId: string, opts: { areaId?: string; archived?: boolean; tab?: ConvTab },
): Promise<ChatListCounts> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return { all: 0, active: 0, open: 0, pending: 0, resolved: 0, unread: 0, trash: 0, archived: 0, mine: 0, unassigned: 0 };
  return getChatListCounts(businessId, user.id, opts);
}

/** Full detail for the open conversation (rarely needed; kept for completeness). */
export async function liveDetail(convId: string): Promise<ConvDetail | null> {
  return getConversationDetail(convId);
}

/** Just the open conversation's header (status/assignee/unread/area/contact) — 1 query, merged
 *  into the existing detail without re-fetching messages/notes/events/orders. */
export async function liveConvHeader(convId: string): Promise<Partial<ConvDetail> | null> {
  const supabase = await createClient();
  const cols = (typing: string) =>
    `id, status, assignee_id, unread, hidden, snoozed_until, ${typing}area:areas(name,color), contact:contacts(id,name,phone,tags,avatar_url,created_at)`;
  let convRaw, error;
  ({ data: convRaw, error } = await supabase.from("conversations").select(cols("typing_until, muted, locked_to, ")).eq("id", convId).maybeSingle());
  if (error) ({ data: convRaw } = await supabase.from("conversations").select(cols("")).eq("id", convId).maybeSingle());
  if (!convRaw) return null;
  const conv = convRaw as unknown as Record<string, unknown>;
  return {
    status: conv.status as ConvDetail["status"],
    assignee_id: conv.assignee_id as string | null,
    locked_to: ((conv as { locked_to?: string | null }).locked_to) ?? null,
    unread: (conv.unread as number) ?? 0,
    hidden: conv.hidden as boolean,
    snoozed_until: conv.snoozed_until as string | null,
    area: conv.area as unknown as ConvDetail["area"],
    contact: conv.contact as unknown as ConvDetail["contact"],
    typing_until: ((conv as { typing_until?: string | null }).typing_until) ?? null,
    muted: ((conv as { muted?: boolean }).muted) ?? false,
  };
}

/** Nav badges + bell notifications, so the Shell can stay live without a full route refresh. */
export async function liveBadges(businessId: string): Promise<{ mine: number; unassigned: number; internal: number; notifications: Notif[] }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return { mine: 0, unassigned: 0, internal: 0, notifications: [] };
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split("@")[0] : "Agente");
  const [badges, internal, notifications] = await Promise.all([
    getChatBadges(businessId, user.id),
    getInternalUnread(businessId, user.id),
    getNotifications(businessId, user.id, myName),
  ]);
  return { mine: badges.mine, unassigned: badges.unassigned, internal, notifications };
}
