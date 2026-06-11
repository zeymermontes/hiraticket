import { createClient } from "@/lib/supabase/server";

export interface OrderItem { id: string; name: string; qty: number; unit_price: number; subtotal: number; stage_id: string | null; stage: { name: string; color: string } | null; note: string | null }
export interface OrderNote { id: string; body: string; author_id: string | null; created_at: string; item_id: string | null }
export interface OrderEvent { id: string; kind: string; text: string | null; created_at: string }
export interface OrderPayment { id: string; amount: number; method: string | null; note: string | null; created_by: string | null; created_at: string }

export interface OrderDetail {
  id: string;
  code: string;
  total: number;
  priority: string;
  pay_status: string;
  created_at: string;
  updated_at: string;
  due_at: string | null;
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
  payments: OrderPayment[];
  paid: number;
  product_stages: boolean;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const base = (due: string) => `id, code, total, priority, pay_status, created_at, updated_at, ${due}stage_id, area_id, assignee_id, conversation_id, contact:contacts(id,name,phone,tags), stage:stages(name,color), area:areas(name,color)`;
  // Cascade fallbacks: product_stages join (0019) and due_at (0029) may not be applied yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any, orderErr: unknown;
  ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(base("due_at, ")).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order } = await supabase.from("orders").select(base("")).eq("id", orderId).maybeSingle());
  if (!order) return null;

  const [itemsRes, notesRes, { data: events }, payRes] = await Promise.all([
    supabase.from("order_items").select("id, name, qty, unit_price, subtotal, stage_id, note, stage:stages(name,color)").eq("order_id", orderId),
    supabase.from("notes").select("id, body, author_id, created_at, item_id").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: true }),
    supabase.from("events").select("id, kind, text, created_at").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, amount, method, note, created_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
  ]);
  // Fall back to base item columns if stage_id/stage isn't available yet.
  let items = itemsRes.data;
  if (itemsRes.error) {
    const r = await supabase.from("order_items").select("id, name, qty, unit_price, subtotal").eq("order_id", orderId);
    items = ((r.data ?? []) as Record<string, unknown>[]).map((it) => ({ ...it, stage_id: null, stage: null, note: null })) as unknown as typeof items;
  }
  // notes.item_id may not exist yet (0031 not applied) → re-select without it, default null.
  let notes = notesRes.data;
  if (notesRes.error) {
    const r = await supabase.from("notes").select("id, body, author_id, created_at").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: true });
    notes = ((r.data ?? []) as Record<string, unknown>[]).map((n) => ({ ...n, item_id: null })) as unknown as typeof notes;
  }
  // payments table may not exist yet (0025 not applied).
  const payments = (payRes.error ? [] : (payRes.data ?? [])) as unknown as OrderPayment[];
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "notes" | "events" | "payments" | "paid" | "contact" | "stage" | "area">),
    due_at: ((order as { due_at?: string | null }).due_at) ?? null,
    contact: order.contact as unknown as OrderDetail["contact"],
    stage: order.stage as unknown as OrderDetail["stage"],
    area: order.area as unknown as OrderDetail["area"],
    items: (items ?? []) as unknown as OrderItem[],
    notes: (notes ?? []) as OrderNote[],
    events: (events ?? []) as OrderEvent[],
    payments,
    paid,
    product_stages: ((order.business as unknown as { product_stages?: boolean } | null)?.product_stages) ?? false,
  };
}
