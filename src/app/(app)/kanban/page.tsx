import { getMyBusiness } from "@/lib/queries";
import { getKanbanOrders, getKanbanItems } from "@/lib/kanban";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [orders, items, stages, areas, agents, sessions] = await Promise.all([
    getKanbanOrders(business.id),
    business.product_stages ? getKanbanItems(business.id) : Promise.resolve([]),
    getStages(business.id),
    getAreas(business.id),
    getAgents(business.id),
    getSessions(business.id),
  ]);

  return <KanbanBoard orders={orders} items={items} stages={stages} areas={areas} agents={agents} businessId={business.id} connected={isConnected(sessions)} productStages={business.product_stages ?? false} />;
}
