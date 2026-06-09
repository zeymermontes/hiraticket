import { createClient } from "@/lib/supabase/server";

export interface OrderItem { id: string; name: string; qty: number; unit_price: number; subtotal: number; stage_id: string | null; stage: { name: string; color: string } | null }
export interface OrderNote { id: string; body: string; author_id: string | null; created_at: string }
export interface OrderEvent { id: string; kind: string; text: string | null; created_at: string }

export interface OrderDetail {
  id: string;
  code: string;
  total: number;
  priority: string;
  pay_status: string;
  created_at: string;
  updated_at: string;
  stage_id: string | null;
  area_id: string | null;
  assignee_id: string | null;
  conversation_id: string | null;
  contact: { id: string; name: string; phone: string | null; tags: string[] | null } | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  items: OrderItem[];
  notes: OrderNote[];
  events: OrderEvent[];
  product_stages: boolean;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const ORDER_BASE = "id, code, total, priority, pay_status, created_at, updated_at, stage_id, area_id, assignee_id, conversation_id, contact:contacts(id,name,phone,tags), stage:stages(name,color), area:areas(name,color)";
  // Try with the businesses(product_stages) join (migration 0019); fall back if not applied.
  let { data: order, error: orderErr } = await supabase
    .from("orders").select(`${ORDER_BASE}, business:businesses(product_stages)`).eq("id", orderId).maybeSingle();
  if (orderErr) {
    const r = await supabase.from("orders").select(ORDER_BASE).eq("id", orderId).maybeSingle();
    order = r.data as typeof order;
  }
  if (!order) return null;

  const [itemsRes, { data: notes }, { data: events }] = await Promise.all([
    supabase.from("order_items").select("id, name, qty, unit_price, subtotal, stage_id, stage:stages(name,color)").eq("order_id", orderId),
    supabase.from("notes").select("id, body, author_id, created_at").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: true }),
    supabase.from("events").select("id, kind, text, created_at").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: false }),
  ]);
  // Fall back to base item columns if stage_id/stage isn't available yet.
  let items = itemsRes.data;
  if (itemsRes.error) {
    const r = await supabase.from("order_items").select("id, name, qty, unit_price, subtotal").eq("order_id", orderId);
    items = ((r.data ?? []) as Record<string, unknown>[]).map((it) => ({ ...it, stage_id: null, stage: null })) as typeof items;
  }

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "notes" | "events" | "contact" | "stage" | "area">),
    contact: order.contact as unknown as OrderDetail["contact"],
    stage: order.stage as unknown as OrderDetail["stage"],
    area: order.area as unknown as OrderDetail["area"],
    items: (items ?? []) as unknown as OrderItem[],
    notes: (notes ?? []) as OrderNote[],
    events: (events ?? []) as OrderEvent[],
    product_stages: ((order.business as unknown as { product_stages?: boolean } | null)?.product_stages) ?? false,
  };
}
