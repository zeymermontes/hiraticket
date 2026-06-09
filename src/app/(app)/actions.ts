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

/**
 * Creates the caller's business with a working default pipeline (no sample data).
 * Used by the first-run onboarding wizard.
 */
export async function createBusiness(name: string, vertical: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_business", {
    p_name: name.trim() || "Mi negocio",
    p_vertical: vertical || "imprenta",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}

/** Marks the one-time onboarding as done (finished or skipped). */
export async function completeOnboarding(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", { p_business: businessId });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
