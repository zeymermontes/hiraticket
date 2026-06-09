"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidateAll() {
  revalidatePath("/business");
  revalidatePath("/kanban");
  revalidatePath("/orders");
  revalidatePath("/chat");
}

export async function createArea(businessId: string, name: string, position: number) {
  const supabase = await createClient();
  await supabase.from("areas").insert({ business_id: businessId, name: name.trim() || "Área", color: "slate", position });
  revalidateAll();
}
export async function updateArea(areaId: string, patch: { name?: string; color?: string; route_to?: string | null }) {
  const supabase = await createClient();
  await supabase.from("areas").update(patch).eq("id", areaId);
  revalidateAll();
}
export async function deleteArea(areaId: string) {
  const supabase = await createClient();
  await supabase.from("areas").delete().eq("id", areaId);
  revalidateAll();
}

export async function createStage(businessId: string, name: string, position: number) {
  const supabase = await createClient();
  await supabase.from("stages").insert({ business_id: businessId, name: name.trim() || "Etapa", color: "slate", position });
  revalidateAll();
}
export async function updateStage(stageId: string, patch: { name?: string; color?: string }) {
  const supabase = await createClient();
  await supabase.from("stages").update(patch).eq("id", stageId);
  revalidateAll();
}
export async function deleteStage(stageId: string) {
  const supabase = await createClient();
  await supabase.from("stages").delete().eq("id", stageId);
  revalidateAll();
}
