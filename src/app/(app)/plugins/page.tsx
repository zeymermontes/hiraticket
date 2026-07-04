import { getMyBusiness } from "@/lib/queries";
import { getBusinessCatalog } from "@/lib/plugins";
import { createClient } from "@/lib/supabase/server";
import { PluginsScreen } from "@/components/PluginsScreen";

export const dynamic = "force-dynamic";

export default async function PluginsPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const entries = await getBusinessCatalog(business.id);
  // Role straight from the membership row (no profiles join in the way).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: mem } = user
    ? await supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdmin = mem?.role === "admin";

  return <PluginsScreen businessId={business.id} entries={entries} isAdmin={!!isAdmin} />;
}
