import { getMyBusiness } from "@/lib/queries";
import { getKanbanBoard } from "@/lib/kanban";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { getProducts } from "@/lib/extras";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getActiveIntegrations } from "@/lib/plugins";
import { KanbanBoard } from "@/components/KanbanBoard";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [stages, areas, agents, sessions, catalog, integrations] = await Promise.all([
    getStages(business.id),
    getAreas(business.id),
    getAgents(business.id),
    getSessions(business.id),
    getProducts(business.id),
    getActiveIntegrations(business.id),
  ]);

  // Only the first page of each column (the board opens grouped by stage). Everything else is
  // fetched per column as you scroll — the board used to ship every order AND every line item.
  const initial = await getKanbanBoard(business.id, stages.map((s) => s.id), { group: "status" });

  return (
    <KanbanBoard
      doneFromStageId={business.done_from_stage_id ?? null}
      initial={initial}
      stages={stages}
      areas={areas}
      agents={agents}
      catalog={catalog}
      businessId={business.id}
      connected={isConnected(sessions)}
      productStages={business.product_stages ?? false}
      shipping={integrations.shipping}
      invoicing={integrations.invoicing}
    />
  );
}
