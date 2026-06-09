import { createClient } from "@/lib/supabase/server";

export interface CannedMessage {
  id: string;
  title: string;
  body: string;
  category: string | null;
  shortcut: string | null;
}

export async function getCanned(businessId: string): Promise<CannedMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canned_messages")
    .select("id, title, body, category, shortcut")
    .eq("business_id", businessId)
    .order("category", { ascending: true });
  return (data ?? []) as CannedMessage[];
}
