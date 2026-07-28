"use server";
import { createClient } from "@/lib/supabase/server";
import { decryptBody } from "@/lib/msgcrypto";

export interface SearchResults {
  chats: { id: string; contactName: string; phone: string; preview: string; status: "open" | "pending" | "resolved" }[];
  orders: { id: string; code: string; customerName: string; itemSummary: string; status: string; color: string }[];
  customers: { id: string; name: string; phone: string; tags: string[]; conversationId: string | null }[];
}

const EMPTY: SearchResults = { chats: [], orders: [], customers: [] };

/** Global search across conversations, orders and customers (tenant-scoped, case-insensitive). */
export async function globalSearch(businessId: string, qRaw: string): Promise<SearchResults> {
  const q = qRaw.trim().replace(/[(),]/g, " ").trim();
  if (q.length < 1) return EMPTY;
  const supabase = await createClient();
  const like = `%${q}%`;

  // Contacts matching name / phone / exact tag.
  const { data: contactHits } = await supabase
    .from("contacts").select("id, name, phone, tags")
    .eq("business_id", businessId)
    .or(`name.ilike.${like},phone.ilike.${like},tags.cs.{${q}}`)
    .limit(20);
  const contactIds = (contactHits ?? []).map((c) => c.id as string);

  // NOTE: message-TEXT search moved to the local device cache (GlobalSearch searches IndexedDB):
  // bodies are encrypted at rest (encm:v1:), so a server-side ILIKE can't see new messages.

  // Order items matching by name → their order ids.
  const { data: itemHits } = await supabase
    .from("order_items").select("order_id, name").ilike("name", like).limit(30);
  const orderIdsFromItems = [...new Set((itemHits ?? []).map((i) => i.order_id as string).filter(Boolean))];

  const inList = (ids: string[]) => `(${ids.join(",")})`;

  // --- Conversations (matched by contact; message-text hits come from the local cache) ---
  const convOr: string[] = [];
  if (contactIds.length) convOr.push(`contact_id.in.${inList(contactIds)}`);
  let chats: SearchResults["chats"] = [];
  if (convOr.length) {
    // last_body (0060) is the denormalized preview; the old embed pulled every message of each
    // matched conversation on every keystroke. Fall back to it only if 0060 isn't applied.
    const sel = (cols: string) =>
      supabase.from("conversations").select(cols)
        .eq("business_id", businessId).or(convOr.join(","))
        .order("last_message_at", { ascending: false }).limit(5);
    let { data, error } = await sel("id, status, last_message_at, last_body, contact:contacts(name,phone)");
    if (error) ({ data } = await sel("id, status, last_message_at, contact:contacts(name,phone), messages(body,created_at)"));
    chats = ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
      const msgs = (c.messages as { body: string; created_at: string }[]) ?? [];
      const last = msgs.reduce<{ body: string; created_at: string } | null>((a, m) => (!a || m.created_at > a.created_at ? m : a), null);
      const body = (c.last_body as string | null) ?? last?.body ?? "";
      const ct = c.contact as { name?: string; phone?: string } | null;
      return { id: c.id as string, contactName: ct?.name ?? "—", phone: ct?.phone ?? "", preview: decryptBody(businessId, body), status: (c.status as SearchResults["chats"][number]["status"]) };
    });
  }

  // --- Orders ---
  const orderOr: string[] = [`code.ilike.${like}`];
  if (contactIds.length) orderOr.push(`contact_id.in.${inList(contactIds)}`);
  if (orderIdsFromItems.length) orderOr.push(`id.in.${inList(orderIdsFromItems)}`);
  const { data: orderData } = await supabase
    .from("orders")
    .select("id, code, stage:stages(name,color), contact:contacts(name), items:order_items(name)")
    .eq("business_id", businessId).or(orderOr.join(","))
    .order("updated_at", { ascending: false }).limit(5);
  const orders: SearchResults["orders"] = (orderData ?? []).map((o: Record<string, unknown>) => {
    const st = o.stage as { name?: string; color?: string } | null;
    const ct = o.contact as { name?: string } | null;
    const items = (o.items as { name: string }[]) ?? [];
    return { id: o.id as string, code: o.code as string, customerName: ct?.name ?? "—", itemSummary: items.map((i) => i.name).join(", "), status: st?.name ?? "", color: st?.color ?? "slate" };
  });

  // --- Customers (with their latest conversation, if any) ---
  const top = (contactHits ?? []).slice(0, 5);
  const convByContact = new Map<string, string>();
  if (top.length) {
    const { data: cvs } = await supabase
      .from("conversations").select("id, contact_id, last_message_at")
      .eq("business_id", businessId).in("contact_id", top.map((c) => c.id as string))
      .order("last_message_at", { ascending: false });
    for (const cv of cvs ?? []) if (!convByContact.has(cv.contact_id as string)) convByContact.set(cv.contact_id as string, cv.id as string);
  }
  const customers: SearchResults["customers"] = top.map((c) => ({
    id: c.id as string, name: (c.name as string) ?? "—", phone: (c.phone as string) ?? "", tags: ((c.tags as string[]) ?? []), conversationId: convByContact.get(c.id as string) ?? null,
  }));

  return { chats, orders, customers };
}
