import { createClient } from "@/lib/supabase/server";

export interface KanbanOrder {
  id: string;
  code: string;
  total: number;
  priority: string;
  stage_id: string | null;
  area_id: string | null;
  assignee_id: string | null;
  contact: { name: string } | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  items: { name: string }[];
}

export async function getKanbanOrders(businessId: string): Promise<KanbanOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, code, total, priority, stage_id, area_id, assignee_id, contact:contacts(name), stage:stages(name,color), area:areas(name,color), items:order_items(name)")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as KanbanOrder[];
}

export interface KanbanItem {
  id: string;        // order_items.id
  name: string;
  qty: number;
  stage_id: string | null;
  order_id: string;
  order_code: string;
  priority: string;
  assignee_id: string | null;
  contact: { name: string } | null;
  stage: { name: string; color: string } | null;
}

/** One card per product (line item) for the Kanban "Productos" view. */
export async function getKanbanItems(businessId: string): Promise<KanbanItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("id, name, qty, stage_id, stage:stages(name,color), order:orders!inner(id, code, priority, assignee_id, business_id, contact:contacts(name))")
    .eq("order.business_id", businessId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((it: Record<string, unknown>) => {
    const o = it.order as { id: string; code: string; priority: string; assignee_id: string | null; contact: { name: string } | null } | null;
    return {
      id: it.id as string,
      name: it.name as string,
      qty: it.qty as number,
      stage_id: it.stage_id as string | null,
      order_id: o?.id ?? "",
      order_code: o?.code ?? "",
      priority: o?.priority ?? "normal",
      assignee_id: o?.assignee_id ?? null,
      contact: o?.contact ?? null,
      stage: it.stage as { name: string; color: string } | null,
    };
  });
}
