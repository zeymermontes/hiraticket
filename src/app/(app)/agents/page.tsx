import { getMyBusiness } from "@/lib/queries";
import { getAgents } from "@/lib/chat";
import { createClient } from "@/lib/supabase/server";
import { Onboarding } from "@/components/Onboarding";
import { AgentsScreen } from "@/components/AgentsScreen";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;

  const agents = await getAgents(business.id);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin = agents.find((a) => a.id === user?.id)?.role === "admin";

  return <AgentsScreen businessId={business.id} agents={agents} isAdmin={!!isAdmin} />;
}
