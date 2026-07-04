import { getMyBusiness } from "@/lib/queries";
import { getBusinessCatalog } from "@/lib/plugins";
import { getAgents } from "@/lib/chat";
import { createClient } from "@/lib/supabase/server";
import { PluginsScreen } from "@/components/PluginsScreen";

export const dynamic = "force-dynamic";

export default async function PluginsPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [entries, agents] = await Promise.all([
    getBusinessCatalog(business.id),
    getAgents(business.id),
  ]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = agents.find((a) => a.id === user?.id)?.role === "admin";

  return <PluginsScreen businessId={business.id} entries={entries} isAdmin={!!isAdmin} />;
}
