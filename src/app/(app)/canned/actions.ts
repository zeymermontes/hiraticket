"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface CannedInput { title: string; body: string; category?: string; shortcut?: string }

export async function createCanned(businessId: string, input: CannedInput): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").insert({
    business_id: businessId,
    title: input.title.trim() || "Plantilla",
    body: input.body.trim(),
    category: input.category?.trim() || "General",
    shortcut: input.shortcut?.trim() || null,
  });
  revalidatePath("/canned");
}

export async function updateCanned(id: string, patch: Partial<CannedInput>): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").update(patch).eq("id", id);
  revalidatePath("/canned");
}

export async function deleteCanned(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").delete().eq("id", id);
  revalidatePath("/canned");
}
