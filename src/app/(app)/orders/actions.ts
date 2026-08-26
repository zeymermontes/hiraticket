"use server";
import { revalidatePath } from "next/cache";
import { ensureTag } from "@/lib/tags";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getOrderDetail, type OrderDetail } from "@/lib/orders";
import { getMyBusiness, getOrdersPage, getOrderIds, type OrderQuery, type OrdersPage } from "@/lib/queries";
import { moveOrderStage, runStageAutomations } from "@/app/(app)/actions";
import { encryptBody } from "@/lib/msgcrypto";
import { markOrderPaid, recomputeChargeStatus } from "@/lib/payments";
import { chargeTitle, suggestKind, CHARGE_KINDS } from "@/lib/charges";
import { flushCloudOutbox } from "@/lib/cloud-outbox";
import { resolveConfirmPaymentStageId } from "@/lib/confirmPaymentStage";

/** Add an internal note to an order. Pass `itemId` to attach it to a specific subtask (line item);
 *  null/undefined makes it an order-level note. Both live in the order's notes timeline. */
export async function addOrderNote(orderId: string, body: string, itemId?: string | null): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const supabase = await createClient();
  const user = await getSessionUser();
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
  const user = await getSessionUser();
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
  await flushCloudOutbox(order.business_id as string);
  revalidatePath("/chat");
  revalidatePath("/orders");
}

/**
 * Órdenes de cobro (0089): anticipo, parcialidades y finiquito.
 *
 * La diferencia con "Enviar link de pago" de arriba es quién decide el monto. `chargeOrder` manda
 * el link del PEDIDO, que siempre cobra lo que falte; un cobro lo fija el asesor —- "cóbrale
 * $5,000 de anticipo" —- y viaja con su propio link por ese monto exacto.
 */

/** Token de cobro. Va con prefijo "c" para distinguirlo del de pedido ("p") al leer registros;
 *  nada depende del prefijo (`resolvePayToken` busca en las dos tablas), es solo legibilidad. */
function newChargeToken(): string {
  return "c" + globalThis.crypto.randomUUID().replace(/-/g, "");
}

const money = (n: number) => "$" + Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Manda el cobro al chat del pedido y lo marca enviado. Devuelve false si no hay a dónde mandarlo
 *  —- un pedido sin conversación —- para que quien llame lo diga en vez de fingir que salió. */
async function deliverCharge(supabase: SB, chargeId: string, userId: string | null): Promise<boolean> {
  const { data: c } = await supabase.from("charges")
    .select("id, amount, kind, label, pay_token, order_id, business_id").eq("id", chargeId).maybeSingle();
  if (!c) return false;
  const { data: order } = await supabase.from("orders")
    .select("code, total, contact_id, conversation_id").eq("id", c.order_id).maybeSingle();
  if (!order?.conversation_id) return false;

  const [{ data: contact }, { data: pays }] = await Promise.all([
    supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle(),
    supabase.from("payments").select("amount").eq("order_id", c.order_id),
  ]);
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const paid = (pays ?? []).reduce((sum: number, p: { amount: number }) => sum + (Number(p.amount) || 0), 0);
  // Lo que quedaría DESPUÉS de este cobro. Decirlo evita la pregunta que si no llega por WhatsApp
  // dos minutos después: "¿y esto es todo o falta más?".
  const rest = Math.max(0, Math.round(((Number(order.total) || 0) - paid - (Number(c.amount) || 0)) * 100) / 100);
  const title = chargeTitle({ kind: c.kind as string, label: (c.label as string | null) ?? null });
  const link = `${appBaseUrl()}/pay/${c.pay_token}`;
  const body = `Hola ${first} 👋 aquí está tu ${title.toLowerCase()} del pedido ${order.code} por ${money(c.amount as number)} MXN: ${link} 💳`
    + (rest > 0 ? `\n\nDespués de este pago quedarían ${money(rest)} MXN por cubrir.` : "");

  await supabase.from("messages").insert({
    business_id: c.business_id, conversation_id: order.conversation_id,
    direction: "out", type: "text", body: encryptBody(c.business_id as string, body), author_id: userId, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  await flushCloudOutbox(c.business_id as string);
  await supabase.from("charges").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", chargeId).neq("status", "paid");
  return true;
}

/**
 * Crea una orden de cobro. `send` es el check "Enviar al cliente" del modal.
 *
 * `seq` sale del número de cobros que ya tiene el pedido, ANULADOS INCLUIDOS: renumerar al anular
 * dejaría dos cobros distintos llamándose "Pago 2", y uno de ellos ya estaría en el WhatsApp del
 * cliente con ese nombre.
 */
export async function createCharge(orderId: string, input: {
  amount: number; kind?: string; label?: string | null; dueAt?: string | null; send?: boolean;
}): Promise<{ ok: boolean; link?: string; sent?: boolean; error?: string }> {
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: "bad-amount" };
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order } = await supabase.from("orders").select("business_id, total").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, error: "not-found" };

  const [{ data: existing }, { data: pays }] = await Promise.all([
    supabase.from("charges").select("id").eq("order_id", orderId),
    supabase.from("payments").select("amount").eq("order_id", orderId),
  ]);
  const paid = (pays ?? []).reduce((sum: number, p: { amount: number }) => sum + (Number(p.amount) || 0), 0);
  const balance = Math.max(0, (Number(order.total) || 0) - paid);
  const kind = CHARGE_KINDS.includes((input.kind ?? "") as never)
    ? (input.kind as string)
    : suggestKind({ existing: (existing ?? []).length, amount, balance });

  const token = newChargeToken();
  const { data: row, error } = await supabase.from("charges").insert({
    business_id: order.business_id, order_id: orderId,
    seq: (existing ?? []).length + 1,
    kind, label: (input.label ?? "").trim() || null,
    amount, due_at: input.dueAt || null,
    status: "draft", pay_token: token, created_by: user?.id ?? null,
  }).select("id").single();
  // Sin 0089 aplicada esto falla, y hay que decirlo: un botón que no hace nada y no se queja es
  // peor que uno que no está.
  if (error || !row) return { ok: false, error: error?.message ?? "insert-failed" };

  await supabase.from("events").insert({
    business_id: order.business_id, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: "plus", text: `Cobro creado: ${chargeTitle({ kind, label: input.label ?? null })} por ${money(amount)}`,
  });

  let sent = false;
  if (input.send) sent = await deliverCharge(supabase, row.id as string, user?.id ?? null);
  revalidatePath("/orders"); revalidatePath("/chat");
  return { ok: true, link: `${appBaseUrl()}/pay/${token}`, sent };
}

/** Reenviar un cobro por WhatsApp (o mandarlo por primera vez si se creó sin enviar). */
export async function sendCharge(chargeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const ok = await deliverCharge(supabase, chargeId, user?.id ?? null);
  revalidatePath("/orders"); revalidatePath("/chat");
  return ok ? { ok: true } : { ok: false, error: "no-chat" };
}

/** Anular un cobro: deja de contar y su link deja de pedir dinero. No se borra —- el cliente pudo
 *  haberlo recibido, y el rastro de que existió es justo lo que explica la confusión después. */
export async function voidCharge(chargeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: c } = await supabase.from("charges").select("id, order_id, business_id, kind, label, amount, status").eq("id", chargeId).maybeSingle();
  if (!c) return { ok: false, error: "not-found" };
  // Un cobro ya pagado no se anula: el dinero entró y anularlo solo descuadraría lo comprometido.
  if (c.status === "paid") return { ok: false, error: "already-paid" };
  await supabase.from("charges").update({ status: "void" }).eq("id", chargeId);
  await supabase.from("events").insert({
    business_id: c.business_id, parent_type: "order", parent_id: c.order_id, actor_id: user?.id ?? null,
    kind: "x", text: `Cobro anulado: ${chargeTitle({ kind: c.kind as string, label: (c.label as string | null) ?? null })} por ${money(c.amount as number)}`,
  });
  revalidatePath("/orders");
  return { ok: true };
}

/** El link público de un cobro, para copiarlo al portapapeles. */
export async function getChargeLink(chargeId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("charges").select("pay_token").eq("id", chargeId).maybeSingle();
  const token = (data?.pay_token as string | null) ?? null;
  return token ? `${appBaseUrl()}/pay/${token}` : null;
}

type SB = Awaited<ReturnType<typeof createClient>>;

/** order.pay_status from the sum of its payments vs total. */
async function recomputePayStatus(supabase: SB, orderId: string, total: number): Promise<void> {
  const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
  const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
  const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
  await supabase.from("orders").update({ pay_status: status }).eq("id", orderId);
}

/** Record a (partial) payment against an order, then recompute its pay status.
 *  `chargeId` lo ata a una orden de cobro (0089) —- es lo que deja marcar "el anticipo ya lo pagó
 *  en efectivo" sin que el cobro se quede pendiente para siempre. Sin él es un abono suelto. */
export async function addPayment(orderId: string, amount: number, method?: string | null, note?: string | null, chargeId?: string | null): Promise<void> {
  if (!amount || amount <= 0) return;
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order } = await supabase.from("orders").select("business_id, total").eq("id", orderId).maybeSingle();
  if (!order) return;
  const row = { business_id: order.business_id, order_id: orderId, amount, method: method ?? null, note: note ?? null, created_by: user?.id ?? null };
  // Sin 0089 la columna no existe y el insert entero fallaría: mejor guardar el abono sin atarlo
  // que perder el registro del dinero.
  let { error } = await supabase.from("payments").insert({ ...row, charge_id: chargeId || null });
  if (error) ({ error } = await supabase.from("payments").insert(row));
  if (error) return;
  await recomputePayStatus(supabase, orderId, order.total as number);
  if (chargeId) await recomputeChargeStatus(supabase, chargeId);
  revalidatePath("/orders");
}

/** Delete a payment and recompute the order's pay status. */
export async function deletePayment(paymentId: string): Promise<void> {
  const supabase = await createClient();
  // El cobro al que pertenecía se lee ANTES de borrar: después ya no hay a quién preguntárselo, y
  // sin recalcularlo se quedaría marcado como pagado por un abono que ya no existe.
  let { data: pay } = await supabase.from("payments").select("order_id, charge_id").eq("id", paymentId).maybeSingle();
  if (!pay) ({ data: pay } = await supabase.from("payments").select("order_id").eq("id", paymentId).maybeSingle()); // 0089 sin aplicar
  await supabase.from("payments").delete().eq("id", paymentId);
  if (pay?.order_id) {
    const { data: order } = await supabase.from("orders").select("total").eq("id", pay.order_id).maybeSingle();
    await recomputePayStatus(supabase, pay.order_id as string, (order?.total as number) ?? 0);
  }
  const chargeId = (pay as { charge_id?: string | null } | null)?.charge_id;
  if (chargeId) await recomputeChargeStatus(supabase, chargeId);
  revalidatePath("/orders");
}

/** Mark an order fully paid — records a payment for the outstanding balance, then sets 'paid'. */
export async function markPaid(orderId: string): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser();
  await markOrderPaid(supabase, orderId, user?.id ?? null);
  revalidatePath("/orders");
}

/** Approve or reject a customer-uploaded transfer receipt. Approving records a real payment
 *  (the proof amount, or the outstanding balance if none was given) and recomputes pay_status. */
export async function reviewPaymentProof(proofId: string, decision: "approved" | "rejected"): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser();
  let { data: proof } = await supabase.from("payment_proofs").select("business_id, order_id, amount, status, charge_id").eq("id", proofId).maybeSingle();
  if (!proof) ({ data: proof } = await supabase.from("payment_proofs").select("business_id, order_id, amount, status").eq("id", proofId).maybeSingle()); // 0089 sin aplicar
  if (!proof || proof.status !== "pending") return;
  const proofCharge = ((proof as { charge_id?: string | null }).charge_id) ?? null;
  const orderId = proof.order_id as string;
  const businessId = proof.business_id as string;

  if (decision === "approved") {
    const { data: order } = await supabase.from("orders").select("total").eq("id", orderId).maybeSingle();
    const total = Number(order?.total) || 0;
    const { data: pays } = await supabase.from("payments").select("amount").eq("order_id", orderId);
    const paid = (pays ?? []).reduce((s: number, p: { amount: number }) => s + (Number(p.amount) || 0), 0);
    const amount = Number(proof.amount) > 0 ? Number(proof.amount) : Math.max(0, total - paid);
    if (amount > 0) {
      // El monto NO se recorta al del cobro. Si el cliente transfirió de más, ese dinero entró de
      // verdad: se acredita completo y el sobrante baja el saldo del pedido. Recortarlo sería
      // inventar que llegó menos.
      const row = { business_id: businessId, order_id: orderId, amount, method: "transfer", note: "Comprobante aprobado", created_by: user?.id ?? null };
      let { error } = await supabase.from("payments").insert({ ...row, charge_id: proofCharge });
      if (error) ({ error } = await supabase.from("payments").insert(row));
    }
    await recomputePayStatus(supabase, orderId, total);
    if (proofCharge) await recomputeChargeStatus(supabase, proofCharge);
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
export async function setAllItemStages(orderId: string, stageId: string): Promise<{ flows: string[]; confirmPayment: boolean }> {
  const supabase = await createClient();
  await supabase.from("order_items").update({ stage_id: stageId }).eq("order_id", orderId);
  return moveOrderStage(orderId, stageId);
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
/** Umbral de "terminado" para UN pedido (0072): desde qué etapa sale de la agenda. null = el
 *  default del negocio. Es la sobreescritura del dropdown en el detalle del pedido. */
export async function setOrderDoneFrom(orderId: string, stageId: string | null): Promise<void> {
  const supabase = await createClient();
  await supabase.from("orders").update({ done_from_stage_id: stageId }).eq("id", orderId);
}

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
  const { data: order } = await supabase.from("orders").select("contact_id, business_id").eq("id", orderId).maybeSingle();
  if (!order?.contact_id) return;
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", order.contact_id).maybeSingle();
  const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), clean]));
  await supabase.from("contacts").update({ tags }).eq("id", order.contact_id);
  if (order.business_id) await ensureTag(supabase, order.business_id as string, clean);
  revalidatePath("/orders");
}

/** Assign an order to an agent. */
export async function assignOrder(orderId: string, agentId: string): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser();
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
 *  set of flow names that fired so the caller can toast, plus `confirmPaymentOrderIds`: los ids de
 *  esta tanda que llegaron a la etapa de "confirmar pago" (0075) y ningún flujo ya decidió el pago
 *  por su cuenta — el cliente pregunta UNA vez por todos, no un popup por pedido. */
export async function bulkMoveOrderStage(orderIds: string[], stageId: string): Promise<{ flows: string[]; confirmPaymentOrderIds: string[] }> {
  if (!orderIds.length) return { flows: [], confirmPaymentOrderIds: [] };
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: first } = await supabase.from("orders").select("business_id").eq("id", orderIds[0]).maybeSingle();
  const businessId = (first?.business_id as string) ?? null;
  await supabase.from("orders").update({ stage_id: stageId, updated_at: new Date().toISOString() }).in("id", orderIds);
  const fired = new Set<string>();
  const confirmPaymentOrderIds: string[] = [];
  if (businessId) {
    await supabase.from("events").insert(orderIds.map((id) => ({
      business_id: businessId, parent_type: "order", parent_id: id,
      actor_id: user?.id ?? null, kind: "status", text: "Cambio de etapa",
    })));
    // Resuelto UNA vez para toda la tanda: mismo negocio, misma etapa destino para todos.
    const [{ data: biz }, { data: stages }] = await Promise.all([
      supabase.from("businesses").select("confirm_payment_stage_id, confirm_payment_enabled").eq("id", businessId).maybeSingle(),
      supabase.from("stages").select("id, position").eq("business_id", businessId).order("position", { ascending: true }),
    ]);
    const resolvedConfirmStage = resolveConfirmPaymentStageId((stages ?? []) as { id: string }[], (biz?.confirm_payment_stage_id as string) ?? null);
    const confirmPaymentEnabled = biz?.confirm_payment_enabled !== false;
    // Space out the auto-replies so a bulk change doesn't fire a burst of WhatsApp messages at once.
    const GAP_SEC = 20;
    const now = Date.now();
    for (let i = 0; i < orderIds.length; i++) {
      const sendAfter = i === 0 ? null : new Date(now + i * GAP_SEC * 1000).toISOString();
      const { flows, markPaidPref } = await runStageAutomations(orderIds[i], businessId, stageId, user?.id ?? null, sendAfter);
      for (const name of flows) fired.add(name);
      if (resolvedConfirmStage && resolvedConfirmStage === stageId) {
        const { data: o } = await supabase.from("orders").select("pay_status").eq("id", orderIds[i]).maybeSingle();
        if ((o?.pay_status as string) !== "paid") {
          if (markPaidPref === true) await markOrderPaid(supabase, orderIds[i], user?.id ?? null);
          else if (markPaidPref === null && confirmPaymentEnabled) confirmPaymentOrderIds.push(orderIds[i]);
        }
      }
    }
  }
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); revalidatePath("/flows");
  return { flows: [...fired], confirmPaymentOrderIds };
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

/** Cancel an order, optionally recording a refund. Cancelling is NOT deleting: the order stays
 *  visible and keeps its history, it just stops counting as a sale in reports.
 *
 *  A refund goes in as a NEGATIVE payment rather than editing totals: that way "cobrado" drops on
 *  its own, pay_status is recomputed from the same sum as always, and there's an auditable row
 *  with who refunded, how much and when. Partial refunds work for free. */
export async function cancelOrder(
  orderId: string,
  opts?: { reason?: string | null; refund?: number | null },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order, error: findErr } = await supabase
    .from("orders").select("business_id, total, cancelled_at").eq("id", orderId).maybeSingle();
  if (findErr) return { ok: false, error: findErr.message };
  if (!order) return { ok: false, error: "El pedido no existe." };
  if (order.cancelled_at) return { ok: true }; // ya cancelado — no duplicar el reembolso

  const refund = Math.max(0, Number(opts?.refund ?? 0));
  if (refund > 0) {
    const { error: payErr } = await supabase.from("payments").insert({
      business_id: order.business_id, order_id: orderId,
      amount: -refund, method: "refund",
      note: (opts?.reason ?? "").trim() || "Reembolso por cancelación",
      created_by: user?.id ?? null,
    });
    if (payErr) return { ok: false, error: payErr.message };
    await recomputePayStatus(supabase, orderId, order.total as number);
  }

  const { error } = await supabase.from("orders").update({
    cancelled_at: new Date().toISOString(),
    cancelled_by: user?.id ?? null,
    cancelled_reason: (opts?.reason ?? "").trim() || null,
  }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };

  await supabase.from("events").insert({
    business_id: order.business_id, parent_type: "order", parent_id: orderId,
    actor_id: user?.id ?? null, kind: "cancelled",
    text: refund > 0 ? `Cancelado · reembolso $${refund}` : "Cancelado",
  });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); revalidatePath("/reports");
  return { ok: true };
}

/** Undo a cancellation. El reembolso NO se revierte solo: es un movimiento de dinero real y
 *  borrarlo en automático escondería que ocurrió. Se quita a mano desde el historial de pagos. */
export async function uncancelOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  const { error } = await supabase.from("orders")
    .update({ cancelled_at: null, cancelled_by: null, cancelled_reason: null }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  if (order) {
    await supabase.from("events").insert({
      business_id: order.business_id, parent_type: "order", parent_id: orderId,
      actor_id: user?.id ?? null, kind: "cancelled", text: "Cancelación revertida",
    });
  }
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); revalidatePath("/reports");
  return { ok: true };
}

/** Registra una merma (0074): reimpresión, error de producción o cancelación parcial. Uso
 *  interno — no toca `total`/`subtotal` del pedido, solo se resta de la utilidad en reportes.
 *  `productId` liga con el catálogo (el costo se tomó de ahí); null = merma genérica con costo
 *  capturado a mano. Devuelve {ok,error} (en vez de tragarse el error) para que la migración 0074
 *  sin correr en producción se note en la UI en lugar de fallar en silencio. */
export async function addOrderWaste(orderId: string, input: { orderItemId?: string | null; productId?: string | null; name: string; qty: number; cost: number; reason: string }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, error: "El pedido no existe." };
  const { error } = await supabase.from("order_waste").insert({
    business_id: order.business_id, order_id: orderId, order_item_id: input.orderItemId ?? null, product_id: input.productId ?? null,
    name: input.name.trim() || "Merma", qty: input.qty || 1, cost: input.cost || 0, reason: input.reason.trim() || "Merma", created_by: user?.id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders"); revalidatePath("/reports");
  return { ok: true };
}

/** Edita una merma ya capturada (cantidad, costo, motivo o el nombre a mano). */
export async function updateOrderWaste(wasteId: string, patch: { name?: string; qty?: number; cost?: number; reason?: string }): Promise<void> {
  const supabase = await createClient();
  await supabase.from("order_waste").update(patch).eq("id", wasteId);
  revalidatePath("/orders"); revalidatePath("/reports");
}

/** Quita un registro de merma (p. ej. capturado por error). */
export async function deleteOrderWaste(wasteId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("order_waste").delete().eq("id", wasteId);
  revalidatePath("/orders"); revalidatePath("/reports");
}

/** One page of the orders table (live orders, or the trash with `trash: true`). Search, filters,
 *  sorting and the total count are resolved in SQL — see getOrdersPage. */
export async function loadOrdersPage(f: OrderQuery): Promise<OrdersPage> {
  const biz = await getMyBusiness();
  if (!biz) return { rows: [], total: 0, capped: false };
  return getOrdersPage(biz.id, f);
}

/** Ids of every order matching the filters, across all pages — "select all filtered" + CSV export. */
export async function loadOrderIds(f: OrderQuery): Promise<string[]> {
  const biz = await getMyBusiness();
  if (!biz) return [];
  return getOrderIds(biz.id, f);
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
  /** Contacto ya identificado (abierto desde un chat, o elegido de la lista). Tiene prioridad
   *  sobre contactName: resolver por nombre no distingue entre homónimos. */
  contactId?: string | null;
  contactName: string;
  items: NewOrderItem[];
  areaId: string | null;
  stageId: string | null;
  priority?: string;
  dueAt?: string | null;
  /** Umbral de "terminado" propio del pedido (0072). null/ausente = el default del negocio. */
  doneFromStageId?: string | null;
  note?: string;
  requiresInvoice?: boolean; // "Requiere factura" — adds the business's IVA to the total (if enabled)
  // Optional discount: value is $ or % depending on kind; tax applies AFTER the discount.
  discount?: { kind: "amount" | "pct"; value: number; note?: string } | null;
}

/** Create an order (and its contact if new) from the New Order modal. */
export async function createOrder(businessId: string, input: NewOrder): Promise<void> {
  const supabase = await createClient();
  const user = await getSessionUser();

  // Un contacto conocido (el del chat, o uno elegido de la lista) gana sobre el nombre: es la
  // única forma de garantizar que el pedido cae en el MISMO contacto que tiene la conversación.
  let contactId: string | null = (input.contactId ?? "").trim() || null;
  if (contactId) {
    const { data: owned } = await supabase.from("contacts").select("id")
      .eq("id", contactId).eq("business_id", businessId).maybeSingle();
    if (!owned) contactId = null; // id de otro negocio o borrado — se cae al nombre
  }

  if (!contactId) {
    const name = input.contactName.trim() || "Cliente";
    // Sin maybeSingle(): con dos contactos del mismo nombre PostgREST devuelve error (PGRST116) y
    // data null. El código anterior ignoraba ese error, lo leía como "no existe" y creaba OTRO
    // duplicado — así que a partir del segundo homónimo, cada pedido generaba un contacto huérfano
    // sin conversación, y por eso los pedidos dejaban de aparecer en el chat del cliente.
    const { data: matches, error: findErr } = await supabase
      .from("contacts").select("id, conversations(id)")
      .eq("business_id", businessId).ilike("name", name)
      .order("created_at", { ascending: true });
    if (findErr) throw new Error(`No se pudo buscar el contacto "${name}": ${findErr.message}`);

    const rows = (matches ?? []) as unknown as { id: string; conversations?: { id: string }[] }[];
    // Entre homónimos gana el que tiene conversación: ese es el contacto real de WhatsApp, el que
    // la persona tiene en mente. Si ninguno tiene, el más antiguo.
    contactId = rows.find((c) => (c.conversations ?? []).length > 0)?.id ?? rows[0]?.id ?? null;

    if (!contactId) {
      const ins = await supabase.from("contacts").insert({ business_id: businessId, name }).select("id").single();
      if (ins.error || !ins.data) throw new Error(`No se pudo crear el contacto "${name}": ${ins.error?.message ?? "sin datos"}`);
      contactId = ins.data.id as string;
    }
  }

  // Link the contact's open conversation, if any, so the order ties to the chat.
  const { data: conv } = await supabase
    .from("conversations").select("id")
    .eq("business_id", businessId).eq("contact_id", contactId)
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
  // Discount ($ or %) comes off the subtotal; IVA is computed on the discounted base.
  const dIn = input.discount && input.discount.value > 0 ? input.discount : null;
  const discountPct = dIn?.kind === "pct" ? Math.min(100, dIn.value) : null;
  const discount = dIn
    ? Math.min(base, Math.round((discountPct != null ? base * (discountPct / 100) : dIn.value) * 100) / 100)
    : 0;
  const taxedBase = base - discount;
  const total = taxRate > 0 ? Math.round(taxedBase * (1 + taxRate / 100) * 100) / 100 : taxedBase;

  const orderRow = {
    business_id: businessId,
    code,
    contact_id: contactId,
    conversation_id: conv?.id ?? null,
    stage_id: input.stageId,
    area_id: input.areaId,
    assignee_id: user?.id ?? null,
    priority: input.priority ?? "normal",
    total,
  };
  const extras = {
    requires_invoice: !!input.requiresInvoice,
    tax_rate: taxRate > 0 ? taxRate : null,
    discount,
    discount_pct: discountPct,
    discount_note: (dIn?.note ?? "").trim() || null,
  };
  let { data: order } = await supabase.from("orders").insert({ ...orderRow, ...extras }).select("id").single();
  // discount (0058) / invoice (0050) may not be applied yet — cascade the fallbacks.
  if (!order) ({ data: order } = await supabase.from("orders").insert({ ...orderRow, requires_invoice: !!input.requiresInvoice, tax_rate: taxRate > 0 ? taxRate : null }).select("id").single());
  if (!order) ({ data: order } = await supabase.from("orders").insert(orderRow).select("id").single());

  if (order) {
    if (input.dueAt) await supabase.from("orders").update({ due_at: input.dueAt }).eq("id", order.id); // best-effort (0029)
    if (input.doneFromStageId) await supabase.from("orders").update({ done_from_stage_id: input.doneFromStageId }).eq("id", order.id); // best-effort (0072)
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
    // Audit trail for the discount (business mode only — the modal hides discounts in personal).
    if (discount > 0) {
      await supabase.from("events").insert({
        business_id: businessId, parent_type: "order", parent_id: order.id,
        actor_id: user?.id ?? null, kind: "dot",
        text: `Descuento aplicado: −$${discount}${discountPct != null ? ` (${discountPct}%)` : ""}${extras.discount_note ? ` — ${extras.discount_note}` : ""}`,
      });
    }
  }

  revalidatePath("/orders");
  revalidatePath("/kanban");
  revalidatePath("/chat");
}
