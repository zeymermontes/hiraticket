import { getMyBusiness } from "@/lib/queries";
import { getAppointments, getDueOrders, getProducts } from "@/lib/extras";
import { getAreas, getStages } from "@/lib/business";
import { getAgents, getConversationDetail } from "@/lib/chat";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getOrderDetail } from "@/lib/orders";
import { getActiveIntegrations } from "@/lib/plugins";
import { AgendaScreen } from "@/components/AgendaScreen";

export const dynamic = "force-dynamic";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  // Etapas y citas no dependen entre sí: en paralelo. Solo los pedidos con fecha límite esperan a
  // las etapas (necesitan saber cuál es la final para excluir lo ya entregado).
  const [stages, appointments] = await Promise.all([getStages(business.id), getAppointments(business.id)]);
  const lastStageId = stages.length ? stages[stages.length - 1].id : null;
  const dueOrders = await getDueOrders(business.id, lastStageId);

  // El detalle a la derecha vive en la URL (?order=), igual que en Pedidos: el mismo patrón, el
  // mismo drawer. Sus datos de apoyo solo se cargan cuando de verdad hay un pedido abierto.
  const openOrder = sp.order ? await getOrderDetail(sp.order) : null;
  const drawer = openOrder
    ? await (async () => {
        const [areas, agents, products, sessions, integrations, convDetail] = await Promise.all([
          getAreas(business.id),
          getAgents(business.id),
          getProducts(business.id),
          getSessions(business.id),
          getActiveIntegrations(business.id),
          openOrder.conversation_id ? getConversationDetail(openOrder.conversation_id) : Promise.resolve(null),
        ]);
        return { areas, agents, products, connected: isConnected(sessions), shipping: integrations.shipping, invoicing: integrations.invoicing, convDetail };
      })()
    : null;

  return (
    <AgendaScreen
      businessId={business.id}
      appointments={appointments}
      dueOrders={dueOrders}
      stages={stages}
      openOrder={openOrder}
      drawer={drawer}
    />
  );
}
