"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOrderDetail, type OrderDetail } from "@/lib/orders";
import { getMyBusiness, getDeletedOrders } from "@/lib/queries";
import type { OrderRow } from "@/lib/types";
import { moveOrderStage, runStageAutomations } from "@/app/(app)/actions";
import { encryptBody } from "@/lib/msgcrypto";

/** Add an internal note to an order. Pass `itemId` to attach it to a specific subtask (line item);
 *  null/undefined makes it an order-level note. Both live in the order's notes timeline. */
export async function addOrderNote(orderId: string, body: string, itemId?: string | null): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  if (!order) return;
  const base = { business_id: order.business_id, parent_type: "order", parent_id: orderId, author_id: user?.id ?? null, body: text };
  const { error } = await supabase.from("notes").insert({ ...base, item_id: itemId ?? null });
  if (error) await supabase.from("notes").insert(base); // notes.item_id not added yet (0031)
  revalidatePath("/orders");
}

/** Load a single order's full detail (for opening the drawer in place, e.g. from the chat). */
export async function loadOrderDetail(orderId: string): Promise<OrderDetail | null> {
  return getOrderDetail(orderId);
}

/** Public base URL for the customer-facing checkout page. */
function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.hiraticket.com").replace(/\/+$/, "");
}

/** Ensure an order has an unguessable pay_token (generating + persisting one if missing). */
async function ensurePayToken(supabase: SB, orderId: string, existing: string | null): Promise<string> {
  if (existing) return existing;
  const token = "p" + globalThis.crypto.randomUUID().replace(/-/g, "");
  await supabase.from("orders").update({ pay_token: token }).eq("id", orderId);
  return token;
}

/** Get (creating if needed) the public checkout link for an order — for copying to the clipboard. */
export async function getPayLink(orderId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("pay_token").eq("id", orderId).maybeSingle();
  if (!order) return null;
  const token = await ensurePayToken(supabase, orderId, (order.pay_token as string | null) ?? null);
  return `${appBaseUrl()}/pay/${token}`;
}

/** Send a payment link (public checkout page) to the order's chat. */
export async function chargeOrder(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id, code, total, contact_id, conversation_id, pay_token").eq("id", orderId).maybeSingle();
  if (!order?.conversation_id) return;
  const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const token = await ensurePayToken(supabase, orderId, (order.pay_token as string | null) ?? null);
  const link = `${appBaseUrl()}/pay/${token}`;
  const body = `Hola ${first} 👋 aquí está tu link de pago para el pedido ${order.code} por $${Number(order.total).toLocaleString("es-MX")} MXN: ${link} 💳`;
  await supabase.from("messages").insert({
    business_id: order.business_id, conversation_id: order.conversation_id,
    direction: "out", type: "text", body: encryptBody(order.business_id as string, body), author_id: user?.id ?? null, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  revalidatePath("/chat");
  revalidatePath("/orders");
}

type SB = Awaited<ReturnType<typeof createClient>>;

/** order.pay_status from the sum of its payments vs total. */
async function recomputePayStatus(supabase: SB, orderId: string, total: number): Promise<void> {
  const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
  await supabase.from("orders").update({ pay_status: status }).eq("id", orderId);
}

/** Record a (partial) payment against an order, then recompute its pay status. */
export async function addPayment(orderId: string, amount: number, method?: string | null, note?: string | null): Promise<void> {
  if (!amount || amount <= 0) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id, total").eq("id", orderId).maybeSingle();
  if (!order) return;
  await supabase.from("payments").insert({ business_id: order.business_id, order_id: orderId, amount, method: method ?? null, note: note ?? null, created_by: user?.id ?? null });
  await recomputePayStatus(supabase, orderId, order.total as number);
  revalidatePath("/orders");
}

/** Delete a payment and recompute the order's pay status. */
export async function deletePayment(paymentId: string): Promise<void> {
  const supabase = await createClient();
  const { data: pay } = await supabase.from("payments").select("order_id").eq("id", paymentId).maybeSingle();
  await supabase.from("payments").delete().eq("id", paymentId);
  if (pay?.order_id) {
    const { data: order } = await supabase.from("orders").select("total").eq("id", pay.order_id).maybeSingle();
    await recomputePayStatus(supabase, pay.order_id as string, (order?.total as number) ?? 0);
  }
  revalidatePath("/orders");
}

/** Mark an order fully paid — records a payment for the outstanding balance, then sets 'paid'. */
export async function markPaid(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id, total").eq("id", orderId).maybeSingle();
  if (!order) return;
  const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
  const remaining = (Number(order.total) || 0) - paid;
  if (remaining > 0) {
    await supabase.from("payments").insert({ business_id: order.business_id, order_id: orderId, amount: remaining, method: "manual", note: "Pago completo", created_by: user?.id ?? null });
  }
  await supabase.from("orders").update({ pay_status: "paid" }).eq("id", orderId);
  revalidatePath("/orders");
}

/** Approve or reject a customer-uploaded transfer receipt. Approving records a real payment
 *  (the proof amount, or the outstanding balance if none was given) and recomputes pay_status. */
export async function reviewPaymentProof(proofId: string, decision: "approved" | "rejected"): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: proof } = await supabase.from("payment_proofs").select("business_id, order_id, amount, status").eq("id", proofId).maybeSingle();
  if (!proof || proof.status !== "pending") return;
  const orderId = proof.order_id as string;
  const businessId = proof.business_id as string;

  if (decision === "approved") {
    const { data: order } = await supabase.from("orders").select("total").eq("id", orderId).maybeSingle();
    const total = Number(order?.total) || 0;
    const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
    const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
    const amount = Number(proof.amount) > 0 ? Number(proof.amount) : Math.max(0, total - paid);
    if (amount > 0) {
      await supabase.from("payments").insert({ business_id: businessId, order_id: orderId, amount, method: "transfer", note: "Comprobante aprobado", created_by: user?.id ?? null });
    }
    await recomputePayStatus(supabase, orderId, total);
  }

  await supabase.from("payment_proofs").update({ status: decision, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() }).eq("id", proofId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: decision === "approved" ? "check" : "x", text: decision === "approved" ? "Comprobante de pago aprobado" : "Comprobante de pago rechazado",
  });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
}

/** Set a single product's (line item's) production stage, then roll the order's stage up to the
 *  least-advanced product so existing order/Kanban/chat views reflect it. */
export async function setItemStage(itemId: string, stageId: string | null): Promise<void> {
  const supabase = await createClient();
  const { data: item } = await supabase.from("order_items").select("order_id").eq("id", itemId).maybeSingle();
  await supabase.from("order_items").update({ stage_id: stageId }).eq("id", itemId);
  if (item?.order_id) await rollupOrderStage(item.order_id as string);
  revalidatePath("/orders");
  revalidatePath("/kanban");
  revalidatePath("/chat");
}

/** Move every line item (subtask/product) of an order to one stage, then move the order to it too
 *  (firing the same events/automations as a manual stage move). Used when advancing an order whose
 *  items track their own stages and the user chooses to sync the items along. */
export async function setAllItemStages(orderId: string, stageId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("order_items").update({ stage_id: stageId }).eq("order_id", orderId);
  await moveOrderStage(orderId, stageId);
}

/** order.stage_id := the least-advanced (lowest-position) stage among products that have one. */
async function rollupOrderStage(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  if (!order) return;
  const [{ data: items }, { data: stages }] = await Promise.all([
    supabase.from("order_items").select("stage_id").eq("order_id", orderId),
    supabase.from("stages").select("id, position").eq("business_id", order.business_id),
  ]);
  const pos = new Map((stages ?? []).map((s) => [s.id as string, s.position as number]));
  const staged = (items ?? []).map((i) => i.stage_id as string | null).filter((x): x is string => !!x);
  if (staged.length === 0) return; // no per-product stages set → leave the order's stage untouched
  let best = staged[0];
  for (const sid of staged) if ((pos.get(sid) ?? 0) < (pos.get(best) ?? 0)) best = sid;
  await supabase.from("orders").update({ stage_id: best }).eq("id", orderId);
}

/** Change an order's priority. */
export async function setOrderPriority(orderId: string, priority: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("orders").update({ priority }).eq("id", orderId);
  revalidatePath("/orders");
  revalidatePath("/kanban");
}

/** Set/clear an order's deadline (ISO string or null). */
export async function setOrderDue(orderId: string, dueAt: string | null): Promise<void> {
  const supabase = await createClient();
  await supabase.from("orders").update({ due_at: dueAt }).eq("id", orderId);
  revalidatePath("/orders");
  revalidatePath("/kanban");
}

/** Add a tag to an order's contact. */
export async function addOrderTag(orderId: string, tag: string): Promise<void> {
  const clean = tag.trim();
  if (!clean) return;
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("contact_id").eq("id", orderId).maybeSingle();
  if (!order?.contact_id) return;
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", order.contact_id).maybeSingle();
  const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), clean]));
  await supabase.from("contacts").update({ tags }).eq("id", order.contact_id);
  revalidatePath("/orders");
}

/** Assign an order to an agent. */
export async function assignOrder(orderId: string, agentId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  await supabase.from("orders").update({ assignee_id: agentId }).eq("id", orderId);
  if (order) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", agentId).maybeSingle();
    await supabase.from("events").insert({
      business_id: order.business_id, parent_type: "order", parent_id: orderId,
      actor_id: user?.id ?? null, kind: "swap", text: `Asignado a ${(p?.full_name as string) || "un agente"}`,
    });
  }
  revalidatePath("/orders");
}

/** Bulk-move several orders to a stage in one round trip (used by the orders table selection bar).
 *  Logs a "Cambio de etapa" event per order and fires the order-stage flows for each; returns the
 *  set of flow names that fired so the caller can toast. */
export async function bulkMoveOrderStage(orderIds: string[], stageId: string): Promise<{ flows: string[] }> {
  if (!orderIds.length) return { flows: [] };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: first } = await supabase.from("orders").select("business_id").eq("id", orderIds[0]).maybeSingle();
  const businessId = (first?.business_id as string) ?? null;
  await supabase.from("orders").update({ stage_id: stageId, updated_at: new Date().toISOString() }).in("id", orderIds);
  const fired = new Set<string>();
  if (businessId) {
    await supabase.from("events").insert(orderIds.map((id) => ({
      business_id: businessId, parent_type: "order", parent_id: id,
      actor_id: user?.id ?? null, kind: "status", text: "Cambio de etapa",
    })));
    // Space out the auto-replies so a bulk change doesn't fire a burst of WhatsApp messages at once.
    const GAP_SEC = 20;
    const now = Date.now();
    for (let i = 0; i < orderIds.length; i++) {
      const sendAfter = i === 0 ? null : new Date(now + i * GAP_SEC * 1000).toISOString();
      for (const name of await runStageAutomations(orderIds[i], businessId, stageId, user?.id ?? null, sendAfter)) fired.add(name);
    }
  }
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); revalidatePath("/flows");
  return { flows: [...fired] };
}

/** order.total := sum of its line-item subtotals (+ the order's IVA when it requires an invoice,
 *  using the rate frozen on the order at creation — editing items must not drop the tax). */
async function recomputeOrderTotal(supabase: SB, orderId: string): Promise<void> {
  const { data: items } = await supabase.from("order_items").select("subtotal").eq("order_id", orderId);
  const base = (items ?? []).reduce((s: number, i: { subtotal: number }) => s + (Number(i.subtotal) || 0), 0);
  let total = base;
  const { data: o } = await supabase.from("orders").select("requires_invoice, tax_rate").eq("id", orderId).maybeSingle();
  if (o?.requires_invoice && Number(o.tax_rate) > 0) total = Math.round(base * (1 + Number(o.tax_rate) / 100) * 100) / 100; // 0050 not applied → o is null-ish, plain sum
  await supabase.from("orders").update({ total }).eq("id", orderId);
}

/** Edit a line item (name / qty / unit price); recomputes its subtotal + the order total. */
export async function updateOrderItem(itemId: string, patch: { name?: string; qty?: number; unit_price?: number }): Promise<void> {
  const supabase = await createClient();
  const { data: item } = await supabase.from("order_items").select("order_id, qty, unit_price").eq("id", itemId).maybeSingle();
  if (!item) return;
  const qty = patch.qty ?? (item.qty as number);
  const price = patch.unit_price ?? (item.unit_price as number);
  const upd: Record<string, unknown> = { subtotal: (Number(qty) || 1) * (Number(price) || 0) };
  if (patch.name !== undefined) upd.name = patch.name.trim() || "Artículo";
  if (patch.qty !== undefined) upd.qty = Number(qty) || 1;
  if (patch.unit_price !== undefined) upd.unit_price = Number(price) || 0;
  await supabase.from("order_items").update(upd).eq("id", itemId);
  await recomputeOrderTotal(supabase, item.order_id as string);
  revalidatePath("/orders"); revalidatePath("/kanban");
}

/** Add a line item to an order; recomputes the order total. */
export async function addOrderItem(orderId: string, input: { name: string; qty?: number; price?: number; stageId?: string | null }): Promise<void> {
  const supabase = await createClient();
  const qty = input.qty || 1, price = input.price || 0;
  await supabase.from("order_items").insert({ order_id: orderId, name: input.name.trim() || "Artículo", qty, unit_price: price, subtotal: qty * price, stage_id: input.stageId ?? null });
  await recomputeOrderTotal(supabase, orderId);
  revalidatePath("/orders"); revalidatePath("/kanban");
}

/** Delete a line item; recomputes the order total. */
export async function deleteOrderItem(itemId: string): Promise<void> {
  const supabase = await createClient();
  const { data: item } = await supabase.from("order_items").select("order_id").eq("id", itemId).maybeSingle();
  await supabase.from("order_items").delete().eq("id", itemId);
  if (item?.order_id) await recomputeOrderTotal(supabase, item.order_id as string);
  revalidatePath("/orders"); revalidatePath("/kanban");
}

/** Soft-delete an order (recoverable). Pass restore=true to undo. */
export async function setOrderDeleted(orderId: string, deleted: boolean): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.from("orders").update({ deleted_at: deleted ? new Date().toISOString() : null }).eq("id", orderId);
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: !error };
}

/** The current business's soft-deleted orders (for the trash view). */
export async function loadDeletedOrders(): Promise<OrderRow[]> {
  const biz = await getMyBusiness();
  if (!biz) return [];
  return getDeletedOrders(biz.id);
}

/** Permanently delete an order: its items + payments (FK cascade) and notes/events, then the order. */
export async function purgeOrder(orderId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("notes").delete().eq("parent_type", "order").eq("parent_id", orderId);
  await supabase.from("events").delete().eq("parent_type", "order").eq("parent_id", orderId);
  await supabase.from("orders").delete().eq("id", orderId);
  revalidatePath("/orders"); revalidatePath("/kanban");
}

interface NewOrderItem { item: string; qty: number; price: number; note?: string }
interface NewOrder {
  contactName: string;
  items: NewOrderItem[];
  areaId: string | null;
  stageId: string | null;
  priority?: string;
  dueAt?: string | null;
  note?: string;
  requiresInvoice?: boolean; // "Requiere factura" — adds the business's IVA to the total (if enabled)
}

/** Create an order (and its contact if new) from the New Order modal. */
export async function createOrder(businessId: string, input: NewOrder): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const name = input.contactName.trim() || "Cliente";
  let { data: contact } = await supabase
    .from("contacts").select("id")
    .eq("business_id", businessId).ilike("name", name).maybeSingle();
  if (!contact) {
    const ins = await supabase.from("contacts")
      .insert({ business_id: businessId, name }).select("id").single();
    contact = ins.data;
  }

  // Link the contact's open conversation, if any, so the order ties to the chat.
  const { data: conv } = await supabase
    .from("conversations").select("id")
    .eq("business_id", businessId).eq("contact_id", contact!.id)
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle();

  const { count } = await supabase
    .from("orders").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  const code = "HIR-" + (1044 + (count ?? 0));

  const lines = (input.items ?? []).filter((l) => (l.item ?? "").trim() || l.qty || l.price);
  if (lines.length === 0) lines.push({ item: "Artículo", qty: 1, price: 0 });
  const base = lines.reduce((s, l) => s + (l.qty || 1) * (l.price || 0), 0);

  // "Requiere factura" → add the business's IVA (rate frozen on the order so later config changes
  // don't rewrite old totals). Columns are 0050 — resilient if not applied yet.
  let taxRate = 0;
  if (input.requiresInvoice) {
    const { data: biz } = await supabase.from("businesses").select("invoice_add_tax, invoice_tax_rate").eq("id", businessId).maybeSingle();
    if ((biz as { invoice_add_tax?: boolean } | null)?.invoice_add_tax ?? false) taxRate = Number((biz as { invoice_tax_rate?: number } | null)?.invoice_tax_rate ?? 16);
  }
  const total = taxRate > 0 ? Math.round(base * (1 + taxRate / 100) * 100) / 100 : base;

  const orderRow = {
    business_id: businessId,
    code,
    contact_id: contact!.id,
    conversation_id: conv?.id ?? null,
    stage_id: input.stageId,
    area_id: input.areaId,
    assignee_id: user?.id ?? null,
    priority: input.priority ?? "normal",
    total,
  };
  let { data: order } = await supabase.from("orders").insert({ ...orderRow, requires_invoice: !!input.requiresInvoice, tax_rate: taxRate > 0 ? taxRate : null }).select("id").single();
  if (!order) ({ data: order } = await supabase.from("orders").insert(orderRow).select("id").single()); // 0050 not applied yet

  if (order) {
    if (input.dueAt) await supabase.from("orders").update({ due_at: input.dueAt }).eq("id", order.id); // best-effort (0029)
    const itemRows = lines.map((l) => ({
      order_id: order.id, name: (l.item ?? "").trim() || "Artículo", qty: l.qty || 1,
      unit_price: l.price || 0, subtotal: (l.qty || 1) * (l.price || 0), stage_id: input.stageId,
      note: (l.note ?? "").trim() || null,
    }));
    const { error: itemErr } = await supabase.from("order_items").insert(itemRows);
    if (itemErr) await supabase.from("order_items").insert(itemRows.map(({ note, ...r }) => r)); // 0030 not applied yet
    // Order-level note (uses the existing notes timeline).
    if ((input.note ?? "").trim()) {
      await supabase.from("notes").insert({ business_id: businessId, parent_type: "order", parent_id: order.id, author_id: user?.id ?? null, body: input.note!.trim() });
    }
    // Event text follows the workspace mode (tasks vs orders); resilient if `mode` isn't there yet.
    const { data: biz } = await supabase.from("businesses").select("mode").eq("id", businessId).maybeSingle();
    const created = (biz as { mode?: string } | null)?.mode === "personal" ? "Tarea creada" : "Pedido creado";
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "order", parent_id: order.id,
      actor_id: user?.id ?? null, kind: "plus", text: created,
    });
  }

  revalidatePath("/orders");
  revalidatePath("/kanban");
  revalidatePath("/chat");
}
