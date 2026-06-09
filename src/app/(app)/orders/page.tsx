import { getMyBusiness, getOrders } from "@/lib/queries";
import { OrdersTable } from "@/components/OrdersTable";
import { Onboarding } from "@/components/Onboarding";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;

  const orders = await getOrders(business.id);
  return <OrdersTable rows={orders} objectName={business.object_singular + "s"} />;
}
