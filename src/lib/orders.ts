import { createClient } from "@/lib/supabase/server";

export interface OrderItem { id: string; name: string; qty: number; unit_price: number; subtotal: number; stage_id: string | null; stage: { name: string; color: string } | null; note: string | null }
export interface OrderNote { id: string; body: string; author_id: string | null; created_at: string; item_id: string | null }
export interface OrderEvent { id: string; kind: string; text: string | null; created_at: string; actor_id: string | null }
export interface OrderPayment { id: string; amount: number; method: string | null; note: string | null; created_by: string | null; created_at: string }
export interface PaymentProof { id: string; method: string; account_ref: string | null; image_url: string; image_mime: string | null; amount: number | null; payer_note: string | null; status: string; reviewed_by: string | null; created_at: string }
export interface OrderShipment { id: string; provider: string; carrier: string | null; service: string | null; tracking_number: string | null; label_url: string | null; cost: number | null; status: string; created_at: string }
export interface OrderInvoice { id: string; uuid: string | null; total: number | null; pdf_url: string | null; verification_url: string | null; status: string; created_at: string }

export interface OrderDetail {
  id: string;
  code: string;
  pay_token: string | null;
  total: number;
  requires_invoice: boolean;
  tax_rate: number | null; // IVA % frozen on the order at creation (null = none)
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
  proofs: PaymentProof[];
  shipments: OrderShipment[];
  invoices: OrderInvoice[];
  paid: number;
  product_stages: boolean;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const base = (due: string) => `id, code, total, priority, pay_status, created_at, updated_at, ${due}stage_id, area_id, assignee_id, conversation_id, contact:contacts(id,name,phone,tags), stage:stages(name,color), area:areas(name,color)`;
  // Cascade fallbacks: product_stages join (0019) and due_at (0029) may not be applied yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any, orderErr: unknown;
  // requires_invoice/tax_rate (0050) and pay_token (0048) are optional — cascade the fallbacks.
  ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token, requires_invoice, tax_rate, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(base("due_at, ")).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order } = await supabase.from("orders").select(base("")).eq("id", orderId).maybeSingle());
  if (!order) return null;

  const [itemsRes, notesRes, { data: events }, payRes, proofRes, shipRes, invRes] = await Promise.all([
    supabase.from("order_items").select("id, name, qty, unit_price, subtotal, stage_id, note, stage:stages(name,color)").eq("order_id", orderId),
    supabase.from("notes").select("id, body, author_id, created_at, item_id").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: true }),
    supabase.from("events").select("id, kind, text, created_at, actor_id").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, amount, method, note, created_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payment_proofs").select("id, method, account_ref, image_url, image_mime, amount, payer_note, status, reviewed_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("shipments").select("id, provider, carrier, service, tracking_number, label_url, cost, status, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, uuid, total, pdf_url, verification_url, status, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
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
  // payment_proofs table may not exist yet (0048 not applied).
  const proofs = (proofRes.error ? [] : (proofRes.data ?? [])) as unknown as PaymentProof[];
  // shipments table may not exist yet (0054 not applied).
  const shipments = (shipRes.error ? [] : (shipRes.data ?? [])) as unknown as OrderShipment[];
  // invoices table may not exist yet (0055 not applied).
  const invoices = (invRes.error ? [] : (invRes.data ?? [])) as unknown as OrderInvoice[];

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "notes" | "events" | "payments" | "proofs" | "paid" | "contact" | "stage" | "area">),
    pay_token: ((order as { pay_token?: string | null }).pay_token) ?? null,
    requires_invoice: ((order as { requires_invoice?: boolean }).requires_invoice) ?? false,
    tax_rate: ((order as { tax_rate?: number | null }).tax_rate) ?? null,
    due_at: ((order as { due_at?: string | null }).due_at) ?? null,
    contact: order.contact as unknown as OrderDetail["contact"],
    stage: order.stage as unknown as OrderDetail["stage"],
    area: order.area as unknown as OrderDetail["area"],
    items: (items ?? []) as unknown as OrderItem[],
    notes: (notes ?? []) as OrderNote[],
    events: (events ?? []) as OrderEvent[],
    payments,
    proofs,
    shipments,
    invoices,
    paid,
    product_stages: ((order.business as unknown as { product_stages?: boolean } | null)?.product_stages) ?? false,
  };
}
