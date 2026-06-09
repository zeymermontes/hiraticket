import { getMyBusiness } from "@/lib/queries";
import { getKanbanOrders } from "@/lib/kanban";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [orders, stages, areas, agents, sessions] = await Promise.all([
    getKanbanOrders(business.id),
    getStages(business.id),
    getAreas(business.id),
    getAgents(business.id),
    getSessions(business.id),
  ]);

  return <KanbanBoard orders={orders} stages={stages} areas={areas} agents={agents} businessId={business.id} connected={isConnected(sessions)} />;
}
