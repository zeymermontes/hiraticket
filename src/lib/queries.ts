import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's first business (tenant), or null if they haven't created one. */
export async function getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const BASE = "id, name, vertical, object_singular, onboarded, custom_fields";
  // Try with the optional columns (migrations 0019/0027). Fall back gracefully if not there yet.
  let { data, error } = await supabase
    .from("businesses").select(`${BASE}, product_stages, show_typing`)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) {
    const r = await supabase.from("businesses").select(BASE)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    data = r.data as typeof data;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { ...d, product_stages: (d.product_stages as boolean) ?? false, show_typing: (d.show_typing as boolean) ?? true } as Business;
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
