import { createClient } from "@/lib/supabase/server";

export interface Area {
  id: string;
  name: string;
  color: string;
  route_to: string | null;
  position: number;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
}

export async function getAreas(businessId: string): Promise<Area[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("areas")
    .select("id, name, color, route_to, position")
    .eq("business_id", businessId)
    .order("position", { ascending: true });
  return (data ?? []) as Area[];
}

export async function getStages(businessId: string): Promise<Stage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stages")
    .select("id, name, color, position")
    .eq("business_id", businessId)
    .order("position", { ascending: true });
  return (data ?? []) as Stage[];
}
