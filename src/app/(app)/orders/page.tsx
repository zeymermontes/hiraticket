import { getMyBusiness, getOrders } from "@/lib/queries";
import { getAreas, getStages } from "@/lib/business";
import { getAgents, getConversationDetail } from "@/lib/chat";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getProducts } from "@/lib/extras";
import { getOrderDetail } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { OrdersTable } from "@/components/OrdersTable";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; order?: string; contact?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  const supabase = await createClient();
  const [orders, areas, stages, agents, products, { data: contacts }] = await Promise.all([
    getOrders(business.id),
    getAreas(business.id),
    getStages(business.id),
    getAgents(business.id),
    getProducts(business.id),
    supabase.from("contacts").select("id, name").eq("business_id", business.id).order("name"),
  ]);
  const openOrder = sp.order ? await getOrderDetail(sp.order) : null;
  const convDetail = openOrder?.conversation_id ? await getConversationDetail(openOrder.conversation_id) : null;
  const connected = isConnected(await getSessions(business.id));

  return (
    <OrdersTable
      rows={orders}
      objectName={(business.object_singular ?? "Pedido") + "s"}
      businessId={business.id}
      areas={areas}
      stages={stages}
      agents={agents}
      openOrder={openOrder}
      autoOpen={sp.new === "1"}
      defaultContact={sp.contact}
      convDetail={convDetail}
      connected={connected}
      products={products}
      contacts={(contacts ?? []) as { id: string; name: string }[]}
    />
  );
}
