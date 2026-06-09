import { getMyBusiness, getOrders } from "@/lib/queries";
import { getAreas, getStages } from "@/lib/business";
import { OrdersTable } from "@/components/OrdersTable";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  const [orders, areas, stages] = await Promise.all([
    getOrders(business.id),
    getAreas(business.id),
    getStages(business.id),
  ]);

  return (
    <OrdersTable
      rows={orders}
      objectName={business.object_singular + "s"}
      businessId={business.id}
      areas={areas}
      stages={stages}
      autoOpen={sp.new === "1"}
    />
  );
}
