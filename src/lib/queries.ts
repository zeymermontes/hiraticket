import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's first business (tenant), or null if they haven't created one. */
export async function getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("id, name, vertical, object_singular")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Business) ?? null;
}

export async function getOrders(businessId: string): Promise<OrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, code, priority, pay_status, total, updated_at, stage:stages(name,color), area:areas(name,color), contact:contacts(name)",
    )
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OrderRow[];
}
