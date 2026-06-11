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
  // Keep at least 1 area.
  const { data: a } = await supabase.from("areas").select("business_id").eq("id", areaId).maybeSingle();
  if (a) {
    const { count } = await supabase.from("areas").select("id", { count: "exact", head: true }).eq("business_id", a.business_id);
    if ((count ?? 0) <= 1) return;
  }
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
/** Persist a new stage order (positions = array index). */
export async function reorderStages(businessId: string, orderedIds: string[]) {
  const supabase = await createClient();
  await Promise.all(orderedIds.map((id, i) => supabase.from("stages").update({ position: i }).eq("id", id).eq("business_id", businessId)));
  revalidateAll();
}

export async function deleteStage(stageId: string) {
  const supabase = await createClient();
  // Keep at least 2 stages.
  const { data: s } = await supabase.from("stages").select("business_id").eq("id", stageId).maybeSingle();
  if (s) {
    const { count } = await supabase.from("stages").select("id", { count: "exact", head: true }).eq("business_id", s.business_id);
    if ((count ?? 0) <= 2) return;
  }
  await supabase.from("stages").delete().eq("id", stageId);
  revalidateAll();
}

/** Update the business vertical + the singular object noun. */
export async function updateBusinessProfile(businessId: string, patch: { vertical?: string; object_singular?: string; product_stages?: boolean; show_typing?: boolean; mode?: string; allow_groups?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("businesses").update(patch).eq("id", businessId).select("id");
  revalidateAll();
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "no-permission" }; // RLS blocked / migration 0020 not applied
  return { ok: true };
}

/** Replace the per-vertical custom field list. */
export async function setCustomFields(businessId: string, fields: string[]) {
  const supabase = await createClient();
  await supabase.from("businesses").update({ custom_fields: fields }).eq("id", businessId);
  revalidateAll();
}
