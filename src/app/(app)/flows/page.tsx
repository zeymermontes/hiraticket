import { getMyBusiness } from "@/lib/queries";
import { getAutomations } from "@/lib/extras";
import { getCanned } from "@/lib/canned";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { FlowsScreen } from "@/components/FlowsScreen";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const [automations, canned, areas, stages, agents] = await Promise.all([
    getAutomations(business.id),
    getCanned(business.id),
    getAreas(business.id),
    getStages(business.id),
    getAgents(business.id),
  ]);
  return (
    <FlowsScreen
      businessId={business.id}
      automations={automations}
      cannedTitles={canned.map((c) => c.title)}
      areas={areas}
      stages={stages}
      agents={agents}
    />
  );
}
