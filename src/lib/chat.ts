import { createClient } from "@/lib/supabase/server";

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
  contact: { id: string; name: string; phone: string | null; avatar_url: string | null } | null;
  preview: string;
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

export async function getConversationList(businessId: string): Promise<ConvListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, status, unread, last_message_at, assignee_id, hidden, snoozed_until, area:areas(name,color), contact:contacts(id,name,phone,avatar_url), messages(body,created_at)",
    )
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((c: Record<string, unknown>) => {
    const msgs = (c.messages as { body: string; created_at: string }[]) ?? [];
    const last = msgs.reduce<{ body: string; created_at: string } | null>(
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
    } as ConvListItem;
  });
}

export async function getConversationDetail(
  convId: string,
): Promise<ConvDetail | null> {
  const supabase = await createClient();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, status, assignee_id, contact_id, unread, hidden, snoozed_until, area:areas(name,color), contact:contacts(id,name,phone,tags,avatar_url,created_at)")
    .eq("id", convId)
    .maybeSingle();
  if (!conv) return null;

  const FULL = "id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted, forwarded, edited, meta";
  const BASE = "id, direction, type, body, state, author_id, created_at, media_url, media_mime, media_name, reply_to, deleted";

  const [msgRes, { data: notes }, { data: events }, { data: orders }] =
    await Promise.all([
      supabase.from("messages").select(FULL).eq("conversation_id", convId).order("created_at", { ascending: true }),
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

  // Resilient to a not-yet-applied 0015 migration (forwarded/edited/meta).
  let messages = msgRes.data as ChatMessage[] | null;
  if (msgRes.error) {
    const base = await supabase.from("messages").select(BASE).eq("conversation_id", convId).order("created_at", { ascending: true });
    messages = ((base.data ?? []) as Record<string, unknown>[]).map((m) => ({ ...m, forwarded: false, edited: false, meta: null })) as unknown as ChatMessage[];
  }

  return {
    id: conv.id,
    status: conv.status,
    assignee_id: conv.assignee_id,
    unread: conv.unread ?? 0,
    hidden: conv.hidden,
    snoozed_until: conv.snoozed_until,
    area: conv.area as unknown as ConvDetail["area"],
    contact: conv.contact as unknown as ConvDetail["contact"],
    messages: (messages ?? []) as ChatMessage[],
    notes: (notes ?? []) as ConvNote[],
    events: (events ?? []) as ConvEvent[],
    orders: (orders ?? []) as unknown as ChatOrderCard[],
  };
}
