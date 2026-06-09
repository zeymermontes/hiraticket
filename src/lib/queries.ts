import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's first business (tenant), or null if they haven't created one. */
export async function getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const BASE = "id, name, vertical, object_singular, onboarded, custom_fields";
  // Try with product_stages (migration 0019). Fall back gracefully if the column isn't there yet.
  let { data, error } = await supabase
    .from("businesses").select(`${BASE}, product_stages`)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) {
    const r = await supabase.from("businesses").select(BASE)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    data = r.data as typeof data;
  }
  if (!data) return null;
  return { ...(data as Record<string, unknown>), product_stages: (data as { product_stages?: boolean }).product_stages ?? false } as Business;
}

export async function getOrders(businessId: string): Promise<OrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, code, priority, pay_status, total, updated_at, created_at, assignee_id, stage:stages(name,color), area:areas(name,color), contact:contacts(name), items:order_items(name)",
    )
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OrderRow[];
}
