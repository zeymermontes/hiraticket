import { getMyBusiness, getOrders } from "@/lib/queries";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { getOrderDetail } from "@/lib/orders";
import { OrdersTable } from "@/components/OrdersTable";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; order?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  const [orders, areas, stages, agents] = await Promise.all([
    getOrders(business.id),
    getAreas(business.id),
    getStages(business.id),
    getAgents(business.id),
  ]);
  const openOrder = sp.order ? await getOrderDetail(sp.order) : null;

  return (
    <OrdersTable
      rows={orders}
      objectName={business.object_singular + "s"}
      businessId={business.id}
      areas={areas}
      stages={stages}
      agents={agents}
      openOrder={openOrder}
      autoOpen={sp.new === "1"}
    />
  );
}
