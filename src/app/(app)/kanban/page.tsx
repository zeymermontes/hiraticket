import { getMyBusiness } from "@/lib/queries";
import { getKanbanOrders } from "@/lib/kanban";
import { getAreas, getStages } from "@/lib/business";
import { Onboarding } from "@/components/Onboarding";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;

  const [orders, stages, areas] = await Promise.all([
    getKanbanOrders(business.id),
    getStages(business.id),
    getAreas(business.id),
  ]);

  return <KanbanBoard orders={orders} stages={stages} areas={areas} />;
}
