import { getMyBusiness } from "@/lib/queries";
import { getKanbanOrders } from "@/lib/kanban";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [orders, stages, areas, agents] = await Promise.all([
    getKanbanOrders(business.id),
    getStages(business.id),
    getAreas(business.id),
    getAgents(business.id),
  ]);

  return <KanbanBoard orders={orders} stages={stages} areas={areas} agents={agents} />;
}
