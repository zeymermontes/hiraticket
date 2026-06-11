import { createClient } from "@/lib/supabase/server";
import type { Business, OrderRow } from "@/lib/types";

/** The caller's first business (tenant), or null if they haven't created one. */
export async function getMyBusiness(): Promise<Business | null> {
  const supabase = await createClient();
  const BASE = "id, name, vertical, object_singular, onboarded, custom_fields";
  // Try with the optional columns (migrations 0019/0027/0028). Fall back gracefully if not there yet.
  let { data, error } = await supabase
    .from("businesses").select(`${BASE}, product_stages, show_typing, mode, allow_groups`)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) {
    // allow_groups (0032) may not be applied yet — retry without it before the BASE fallback.
    let r = await supabase.from("businesses").select(`${BASE}, product_stages, show_typing, mode`)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (r.error) r = await supabase.from("businesses").select(BASE).order("created_at", { ascending: true }).limit(1).maybeSingle();
    data = r.data as typeof data;
  }
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { ...d, product_stages: (d.product_stages as boolean) ?? false, show_typing: (d.show_typing as boolean) ?? true, mode: ((d.mode as string) === "personal" ? "personal" : "business"), allow_groups: (d.allow_groups as boolean) ?? false } as Business;
}

export async function getOrders(businessId: string): Promise<OrderRow[]> {
  const supabase = await createClient();
  const cols = (due: string) =>
    `id, code, priority, pay_status, total, updated_at, created_at, ${due}assignee_id, stage:stages(name,color), area:areas(name,color), contact:contacts(name), items:order_items(name)`;
  // due_at may not exist yet (migration 0029) — fall back.
  let { data, error } = await supabase
    .from("orders").select(cols("due_at, ")).eq("business_id", businessId).order("updated_at", { ascending: false });
  if (error) {
    ({ data, error } = await supabase.from("orders").select(cols("")).eq("business_id", businessId).order("updated_at", { ascending: false }));
  }
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({ ...o, due_at: (o.due_at as string | null) ?? null })) as unknown as OrderRow[];
}
