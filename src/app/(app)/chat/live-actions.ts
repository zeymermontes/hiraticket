"use server";
// Targeted realtime refetches — used by the client instead of router.refresh() so a new message
// only re-queries what changed, not the whole route (layout badges, agents, other sections…).
import { createClient } from "@/lib/supabase/server";
import {
  getConversationMessages, getConversationList, getConversationDetail,
  type ChatMessage, type ConvListItem, type ConvDetail,
} from "@/lib/chat";
import { getChatBadges, getNotifications, type Notif } from "@/lib/notifications";

/** Signed messages for the open conversation (high-frequency: fired on every new message). */
export async function liveMessages(convId: string): Promise<ChatMessage[]> {
  return getConversationMessages(convId);
}

/** Older messages (one page before `before`), for lazy-loading history as the agent scrolls up. */
export async function loadOlderMessages(convId: string, before: string): Promise<ChatMessage[]> {
  return getConversationMessages(convId, { before });
}

/** The conversation list (preview / unread / order). */
export async function liveList(businessId: string): Promise<ConvListItem[]> {
  return getConversationList(businessId);
}

/** Full detail for the open conversation (rarely needed; kept for completeness). */
export async function liveDetail(convId: string): Promise<ConvDetail | null> {
  return getConversationDetail(convId);
}

/** Just the open conversation's header (status/assignee/unread/area/contact) — 1 query, merged
 *  into the existing detail without re-fetching messages/notes/events/orders. */
export async function liveConvHeader(convId: string): Promise<Partial<ConvDetail> | null> {
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status, assignee_id, unread, hidden, snoozed_until, area:areas(name,color), contact:contacts(id,name,phone,tags,avatar_url,created_at)")
    .eq("id", convId)
    .maybeSingle();
  if (!conv) return null;
  return {
    status: conv.status as ConvDetail["status"],
    assignee_id: conv.assignee_id as string | null,
    unread: (conv.unread as number) ?? 0,
    hidden: conv.hidden as boolean,
    snoozed_until: conv.snoozed_until as string | null,
    area: conv.area as unknown as ConvDetail["area"],
    contact: conv.contact as unknown as ConvDetail["contact"],
  };
}

/** Nav badges + bell notifications, so the Shell can stay live without a full route refresh. */
export async function liveBadges(businessId: string): Promise<{ mine: number; unassigned: number; notifications: Notif[] }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { mine: 0, unassigned: 0, notifications: [] };
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split("@")[0] : "Agente");
  const [badges, notifications] = await Promise.all([
    getChatBadges(businessId, user.id),
    getNotifications(businessId, user.id, myName),
  ]);
  return { mine: badges.mine, unassigned: badges.unassigned, notifications };
}
