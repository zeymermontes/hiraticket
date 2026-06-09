"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface NewOrder {
  contactName: string;
  item: string;
  qty: number;
  price: number;
  areaId: string | null;
  stageId: string | null;
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

  const { count } = await supabase
    .from("orders").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  const code = "HIR-" + (1044 + (count ?? 0));
  const total = (input.qty || 1) * (input.price || 0);

  const { data: order } = await supabase.from("orders").insert({
    business_id: businessId,
    code,
    contact_id: contact!.id,
    stage_id: input.stageId,
    area_id: input.areaId,
    assignee_id: user?.id ?? null,
    priority: "normal",
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
