"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
