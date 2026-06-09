import { createClient } from "@/lib/supabase/server";

export interface KanbanOrder {
  id: string;
  code: string;
  total: number;
  priority: string;
  stage_id: string | null;
  area_id: string | null;
  contact: { name: string } | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
}

export async function getKanbanOrders(businessId: string): Promise<KanbanOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, code, total, priority, stage_id, area_id, contact:contacts(name), stage:stages(name,color), area:areas(name,color)")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as KanbanOrder[];
}
