import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's first business (tenant), or null if they haven't created one. */
export async function getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const BASE = "id, name, vertical, object_singular, onboarded, custom_fields";
  // Try with the optional columns (migrations 0019/0027/0028). Fall back gracefully if not there yet.
  let { data, error } = await supabase
    .from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups, timezone`)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) {
    // timezone (0043) / allow_groups (0032) may not be applied yet — cascade the fallbacks.
    let r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups`)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode`)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(BASE).order("created_at", { ascending: true }).limit(1).maybeSingle();
    data = r.data as typeof data;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { ...d, product_stages: (d.product_stages as boolean) ?? false, show_typing: (d.show_typing as boolean) ?? true, mode: ((d.mode as string) === "personal" ? "personal" : "business"), allow_groups: (d.allow_groups as boolean) ?? false, timezone: (d.timezone as string) || "America/Mexico_City" } as Business;
}

export async function getOrders(businessId: string): Promise<OrderRow[]> {
  const supabase = await createClient();
  const cols = (due: string) =>
    `id, code, priority, pay_status, total, updated_at, created_at, ${due}assignee_id, stage:stages(name,color), area:areas(name,color), contact:contacts(name), items:order_items(name)`;
  // due_at (0029) / deleted_at (0039) may not exist yet — cascade the fallbacks.
  let { data, error } = await supabase
    .from("orders").select(cols("due_at, deleted_at, ")).eq("business_id", businessId).order("updated_at", { ascending: false });
  if (error) ({ data, error } = await supabase.from("orders").select(cols("due_at, ")).eq("business_id", businessId).order("updated_at", { ascending: false }));
  if (error) ({ data, error } = await supabase.from("orders").select(cols("")).eq("business_id", businessId).order("updated_at", { ascending: false }));
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).filter((o) => !o.deleted_at).map((o) => ({ ...o, due_at: (o.due_at as string | null) ?? null })) as unknown as OrderRow[];
}

/** Soft-deleted orders for the trash view (empty if the 0039 column isn't applied yet). */
export async function getDeletedOrders(businessId: string): Promise<OrderRow[]> {
  const supabase = await createClient();
  const cols = `id, code, priority, pay_status, total, updated_at, created_at, due_at, deleted_at, assignee_id, stage:stages(name,color), area:areas(name,color), contact:contacts(name), items:order_items(name)`;
  const { data, error } = await supabase.from("orders").select(cols).eq("business_id", businessId).not("deleted_at", "is", null).order("updated_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({ ...o, due_at: (o.due_at as string | null) ?? null })) as unknown as OrderRow[];
}

export interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  tags: string[];
  avatar_url: string | null;
  created_at: string;
  conv_id: string | null;      // latest conversation, to open the chat
  last_active: string | null;  // its last_message_at
  muted: boolean;              // latest conversation muted ("stop listening")
  orders_count: number;        // pedidos/tareas linked to this contact
}

/** All contacts for a business + their latest conversation and order/task count (for the Contacts page). */
export async function getContacts(businessId: string): Promise<ContactRow[]> {
  const supabase = await createClient();
  const full = "id, name, phone, tags, avatar_url, created_at, conversations(id, last_message_at, muted), orders(count)";
  const { data: full0, error } = await supabase.from("contacts").select(full).eq("business_id", businessId).order("name");
  let data = full0 as unknown as Record<string, unknown>[] | null;
  if (error) {
    const r = await supabase.from("contacts").select("id, name, phone, tags, avatar_url, created_at").eq("business_id", businessId).order("name");
    data = r.data as unknown as Record<string, unknown>[] | null;
  }
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => {
    const convs = (c.conversations as { id: string; last_message_at: string | null; muted?: boolean }[] | undefined) ?? [];
    const latest = convs.reduce<{ id: string; last_message_at: string | null; muted?: boolean } | null>((a, x) => (!a || (x.last_message_at ?? "") > (a.last_message_at ?? "") ? x : a), null);
    const oc = c.orders as { count?: number }[] | undefined;
    return {
      id: c.id as string,
      name: c.name as string,
      phone: (c.phone as string | null) ?? null,
      tags: (c.tags as string[]) ?? [],
      avatar_url: (c.avatar_url as string | null) ?? null,
      created_at: c.created_at as string,
      conv_id: latest?.id ?? null,
      last_active: latest?.last_message_at ?? null,
      muted: latest?.muted ?? false,
      orders_count: Array.isArray(oc) ? (oc[0]?.count ?? 0) : 0,
    };
  });
}
