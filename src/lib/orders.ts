import { createClient } from "@/lib/supabase/server";
import type { Charge } from "@/lib/charges";

export interface OrderItem { id: string; name: string; qty: number; unit_price: number; subtotal: number; stage_id: string | null; stage: { name: string; color: string } | null; note: string | null }
export interface OrderNote { id: string; body: string; author_id: string | null; created_at: string; item_id: string | null }
export interface OrderEvent { id: string; kind: string; text: string | null; created_at: string; actor_id: string | null }
export interface OrderPayment { id: string; amount: number; method: string | null; note: string | null; created_by: string | null; created_at: string; charge_id: string | null }
export interface PaymentProof { id: string; method: string; account_ref: string | null; image_url: string; image_mime: string | null; amount: number | null; payer_note: string | null; status: string; reviewed_by: string | null; created_at: string }
export interface OrderShipment { id: string; provider: string; carrier: string | null; service: string | null; tracking_number: string | null; label_url: string | null; cost: number | null; status: string; created_at: string }
export interface OrderInvoice { id: string; uuid: string | null; total: number | null; pdf_url: string | null; verification_url: string | null; status: string; created_at: string }
/** Merma interna (0074): reimpresión, error de producción o cancelación parcial. Nunca visible al
 *  cliente. `product_id` liga con el catálogo (costo tomado de ahí); null = merma genérica con
 *  `cost` a mano. `name` es una fotografía —- se guarda tal cual aunque el producto o la línea
 *  del pedido se borren después. */
export interface OrderWaste { id: string; order_item_id: string | null; product_id: string | null; name: string; qty: number; cost: number; reason: string; created_by: string | null; created_at: string }

export interface OrderDetail {
  id: string;
  code: string;
  pay_token: string | null;
  total: number;
  requires_invoice: boolean;
  tax_rate: number | null; // IVA % frozen on the order at creation (null = none)
  discount: number; // resolved $ amount off the subtotal (0 = none)
  discount_pct: number | null; // set when the agent entered a % (display only)
  discount_note: string | null;
  priority: string;
  pay_status: string;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  /** Umbral de terminado propio de este pedido (0072). null = el default del negocio. */
  done_from_stage_id?: string | null;
  stage_id: string | null;
  area_id: string | null;
  assignee_id: string | null;
  conversation_id: string | null;
  cancelled_at: string | null;      // 0065 — cancelado ≠ borrado: sigue visible, deja de ser venta
  cancelled_reason: string | null;
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
  waste: OrderWaste[];
  /** Órdenes de cobro del pedido (0089), en orden. Vacío = se cobra como siempre, de un solo tirón. */
  charges: Charge[];
  paid: number;
  product_stages: boolean;
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  // `cancel` va aparte de `due` para poder soltarlo en el último fallback: si 0065 no está
  // aplicada, pedirlo en TODOS los niveles dejaría el detalle del pedido sin abrir.
  const CANCEL = "cancelled_at, cancelled_reason, ";
  const base = (due: string, cancel: string = CANCEL) => `id, code, total, priority, pay_status, created_at, updated_at, ${due}${cancel}stage_id, area_id, assignee_id, conversation_id, contact:contacts(id,name,phone,tags), stage:stages!stage_id(name,color), area:areas(name,color)`;
  // Cascade fallbacks: product_stages join (0019) and due_at (0029) may not be applied yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any, orderErr: unknown;
  // discount (0058), requires_invoice/tax_rate (0050) and pay_token (0048) are optional — cascade the fallbacks.
  ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, done_from_stage_id, ")}, pay_token, requires_invoice, tax_rate, discount, discount_pct, discount_note, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  // done_from_stage_id (0072) puede no existir aún — el resto de la cascada sigue sin él.
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token, requires_invoice, tax_rate, discount, discount_pct, discount_note, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token, requires_invoice, tax_rate, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token, business:businesses(product_stages)`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(`${base("due_at, ")}, pay_token`).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(base("due_at, ")).eq("id", orderId).maybeSingle());
  if (orderErr) ({ data: order, error: orderErr } = await supabase.from("orders").select(base("due_at, ", "")).eq("id", orderId).maybeSingle()); // 0065 sin aplicar
  if (orderErr) ({ data: order } = await supabase.from("orders").select(base("", "")).eq("id", orderId).maybeSingle());
  if (!order) return null;

  const [itemsRes, notesRes, { data: events }, payRes, proofRes, shipRes, invRes, wasteRes, chargeRes] = await Promise.all([
    supabase.from("order_items").select("id, name, qty, unit_price, subtotal, stage_id, note, stage:stages!stage_id(name,color)").eq("order_id", orderId),
    supabase.from("notes").select("id, body, author_id, created_at, item_id").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: true }),
    supabase.from("events").select("id, kind, text, created_at, actor_id").eq("parent_type", "order").eq("parent_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, amount, method, note, created_by, created_at, charge_id").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payment_proofs").select("id, method, account_ref, image_url, image_mime, amount, payer_note, status, reviewed_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("shipments").select("id, provider, carrier, service, tracking_number, label_url, cost, status, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("id, uuid, total, pdf_url, verification_url, status, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("order_waste").select("id, order_item_id, product_id, name, qty, cost, reason, created_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("charges").select("id, seq, kind, label, amount, due_at, status, pay_token, sent_at, created_at").eq("order_id", orderId).order("seq", { ascending: true }),
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
  // payments table may not exist yet (0025 not applied); charge_id is 0089 and may not either —
  // sin esa columna la consulta entera falla, así que se reintenta sin ella y los pagos quedan sin
  // cobro asociado, que es exactamente lo que eran antes de 0089.
  let payRows = payRes.data;
  if (payRes.error) {
    const r = await supabase.from("payments").select("id, amount, method, note, created_by, created_at").eq("order_id", orderId).order("created_at", { ascending: false });
    payRows = r.error ? [] : ((r.data ?? []) as Record<string, unknown>[]).map((p) => ({ ...p, charge_id: null })) as unknown as typeof payRows;
  }
  const payments = (payRows ?? []) as unknown as OrderPayment[];
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // charges table may not exist yet (0089 not applied) → sin cobros, el pedido se comporta igual
  // que antes. Lo pagado de cada cobro se suma aquí y no en la base: es una lectura más y ya
  // tenemos los pagos en la mano.
  const charges: Charge[] = (chargeRes.error ? [] : (chargeRes.data ?? [])).map((c) => {
    const row = c as Record<string, unknown>;
    return {
      id: row.id as string,
      seq: Number(row.seq) || 1,
      kind: (row.kind as string) ?? "parcialidad",
      label: (row.label as string | null) ?? null,
      amount: Number(row.amount) || 0,
      due_at: (row.due_at as string | null) ?? null,
      status: (row.status as string) ?? "draft",
      pay_token: (row.pay_token as string | null) ?? null,
      sent_at: (row.sent_at as string | null) ?? null,
      created_at: row.created_at as string,
      paid: payments.filter((p) => p.charge_id === row.id).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    };
  });
  // payment_proofs table may not exist yet (0048 not applied).
  const proofs = (proofRes.error ? [] : (proofRes.data ?? [])) as unknown as PaymentProof[];
  // shipments table may not exist yet (0054 not applied).
  const shipments = (shipRes.error ? [] : (shipRes.data ?? [])) as unknown as OrderShipment[];
  // invoices table may not exist yet (0055 not applied).
  const invoices = (invRes.error ? [] : (invRes.data ?? [])) as unknown as OrderInvoice[];
  // order_waste table may not exist yet (0074 not applied).
  const waste = (wasteRes.error ? [] : (wasteRes.data ?? [])) as unknown as OrderWaste[];

  return {
    ...(order as unknown as Omit<OrderDetail, "items" | "notes" | "events" | "payments" | "proofs" | "paid" | "contact" | "stage" | "area">),
    pay_token: ((order as { pay_token?: string | null }).pay_token) ?? null,
    requires_invoice: ((order as { requires_invoice?: boolean }).requires_invoice) ?? false,
    tax_rate: ((order as { tax_rate?: number | null }).tax_rate) ?? null,
    due_at: ((order as { due_at?: string | null }).due_at) ?? null,
    done_from_stage_id: ((order as { done_from_stage_id?: string | null }).done_from_stage_id) ?? null,
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
    waste,
    charges,
    paid,
    product_stages: ((order.business as unknown as { product_stages?: boolean } | null)?.product_stages) ?? false,
  };
}
