import { getMyBusiness, getOrdersPage } from "@/lib/queries";
import { getAreas, getStages } from "@/lib/business";
import { getAgents, getConversationDetail } from "@/lib/chat";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getProducts } from "@/lib/extras";
import { getOrderDetail } from "@/lib/orders";
import { createClient } from "@/lib/supabase/server";
import { getActiveIntegrations } from "@/lib/plugins";
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
  // Only the first page — the table asks the server for the rest as you search / filter / paginate.
  const [firstPage, areas, stages, agents, products, { data: contacts }] = await Promise.all([
    getOrdersPage(business.id, { page: 0 }),
    getAreas(business.id),
    getStages(business.id),
    getAgents(business.id),
    getProducts(business.id),
    supabase.from("contacts").select("id, name").eq("business_id", business.id).order("name"),
  ]);
  const openOrder = sp.order ? await getOrderDetail(sp.order) : null;
  const convDetail = openOrder?.conversation_id ? await getConversationDetail(openOrder.conversation_id) : null;
  const connected = isConnected(await getSessions(business.id));
  const integrations = await getActiveIntegrations(business.id);

  return (
    <OrdersTable
      initial={firstPage}
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
      invoice={{ add: business.invoice_add_tax ?? true, rate: business.invoice_tax_rate ?? 16 }}
      shipping={integrations.shipping}
      invoicing={integrations.invoicing}
    />
  );
}
