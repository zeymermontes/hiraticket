"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function actorCtx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

async function orderBusiness(orderId: string): Promise<string | null> {
  const { supabase } = await actorCtx();
  const { data } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  return (data?.business_id as string) ?? null;
}

/** Move an order to a new pipeline stage (Kanban drag / status change). */
export async function moveOrderStage(orderId: string, stageId: string): Promise<void> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return;
  await supabase.from("orders").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "status", text: "Cambio de etapa",
  });
  revalidatePath("/kanban");
  revalidatePath("/orders");
}

/** Move an order to a different area/department. */
export async function moveOrderArea(orderId: string, areaId: string): Promise<void> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return;
  const { data: area } = await supabase.from("areas").select("route_to").eq("id", areaId).maybeSingle();
  await supabase.from("orders")
    .update({ area_id: areaId, assignee_id: (area?.route_to as string) ?? null, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "swap", text: "Movido de área",
  });
  revalidatePath("/kanban");
  revalidatePath("/orders");
}

/** Creates the caller's business and seeds demo sticker-shop data. */
export async function createDemoBusiness(formData: FormData): Promise<void> {
  const name = (formData.get("name") as string)?.trim() || "Mi negocio";
  const vertical = (formData.get("vertical") as string) || "imprenta";

  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("create_business", {
    p_name: name,
    p_vertical: vertical,
  });
  if (error) throw new Error(error.message);

  const { error: seedErr } = await supabase.rpc("seed_demo_data", {
    p_business: businessId,
  });
  if (seedErr) throw new Error(seedErr.message);

  revalidatePath("/orders");
  revalidatePath("/chat");
  revalidatePath("/kanban");
}
