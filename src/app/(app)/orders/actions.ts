"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Add an internal note to an order. */
export async function addOrderNote(orderId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  if (!order) return;
  await supabase.from("notes").insert({
    business_id: order.business_id, parent_type: "order", parent_id: orderId,
    author_id: user?.id ?? null, body: text,
  });
  revalidatePath("/orders");
}

/** Send a payment link to the order's chat. */
export async function chargeOrder(orderId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id, code, total, contact_id, conversation_id").eq("id", orderId).maybeSingle();
  if (!order?.conversation_id) return;
  const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const body = `Hola ${first} 👋 aquí está tu link de pago para el pedido ${order.code} por $${Number(order.total).toLocaleString("es-MX")} MXN: pay.hiraticket.com/${String(order.code).toLowerCase()} 💳`;
  await supabase.from("messages").insert({
    business_id: order.business_id, conversation_id: order.conversation_id,
    direction: "out", type: "text", body, author_id: user?.id ?? null, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  revalidatePath("/chat");
  revalidatePath("/orders");
}

/** Mark an order as paid. */
export async function markPaid(orderId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("orders").update({ pay_status: "paid" }).eq("id", orderId);
  revalidatePath("/orders");
}

/** Assign an order to an agent. */
export async function assignOrder(orderId: string, agentId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: order } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  await supabase.from("orders").update({ assignee_id: agentId }).eq("id", orderId);
  if (order) {
    await supabase.from("events").insert({
      business_id: order.business_id, parent_type: "order", parent_id: orderId,
      actor_id: user?.id ?? null, kind: "swap", text: "Asignado",
    });
  }
  revalidatePath("/orders");
}

interface NewOrder {
  contactName: string;
  item: string;
  qty: number;
  price: number;
  areaId: string | null;
  stageId: string | null;
  priority?: string;
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
  const total = (input.qty || 1) * (input.price || 0);

  const { data: order } = await supabase.from("orders").insert({
    business_id: businessId,
    code,
    contact_id: contact!.id,
    conversation_id: conv?.id ?? null,
    stage_id: input.stageId,
    area_id: input.areaId,
    assignee_id: user?.id ?? null,
    priority: input.priority ?? "normal",
    total,
  }).select("id").single();

  if (order) {
    await supabase.from("order_items").insert({
      order_id: order.id, name: input.item.trim() || "Artículo", qty: input.qty || 1,
      unit_price: input.price || 0, subtotal: total,
    });
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "order", parent_id: order.id,
      actor_id: user?.id ?? null, kind: "plus", text: "Pedido creado",
    });
  }

  revalidatePath("/orders");
  revalidatePath("/kanban");
  revalidatePath("/chat");
}
