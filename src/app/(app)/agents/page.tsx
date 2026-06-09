import { getMyBusiness } from "@/lib/queries";
import { getAgentsDetailed } from "@/lib/agents";
import { getAreas } from "@/lib/business";
import { createClient } from "@/lib/supabase/server";
import { AgentsScreen } from "@/components/AgentsScreen";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [agents, areas] = await Promise.all([
    getAgentsDetailed(business.id),
    getAreas(business.id),
  ]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = agents.find((a) => a.id === user?.id)?.role === "admin";

  return <AgentsScreen businessId={business.id} agents={agents} areas={areas} isAdmin={!!isAdmin} />;
}
