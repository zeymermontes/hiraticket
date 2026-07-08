import { getMyBusiness } from "@/lib/queries";
import { getConversationList, getConversationDetail, getAgents } from "@/lib/chat";
import { getAreas, getStages } from "@/lib/business";
import { getProducts } from "@/lib/extras";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getActiveIntegrations } from "@/lib/plugins";
import { ChatScreen } from "@/components/chat/ChatScreen";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const business = await getMyBusiness();
  if (!business) return null;

  const sp = await searchParams;
  const supabase = await createClient();
  // With an explicit ?c (search, Clientes, notifications) the detail is fetched in parallel with
  // everything else — it doesn't depend on the list, and serializing it made deep links slow.
  const [list, agents, areas, stages, sessions, products, integrations, { data: { user } }, urlDetail] = await Promise.all([
    getConversationList(business.id),
    getAgents(business.id),
    getAreas(business.id),
    getStages(business.id),
    getSessions(business.id),
    getProducts(business.id),
    getActiveIntegrations(business.id),
    supabase.auth.getUser(),
    sp.c ? getConversationDetail(sp.c) : Promise.resolve(null),
  ]);

  // No explicit ?c → reopen the last chat the agent viewed (cookie), else the most recent.
  let detail = urlDetail;
  if (!detail) {
    const lastChat = (await cookies()).get("ht_lastChat")?.value;
    const validLast = lastChat && list.some((c) => c.id === lastChat) ? lastChat : null;
    const wantId = sp.c ? null : validLast ?? list[0]?.id ?? null;
    detail = wantId ? await getConversationDetail(wantId) : null;
  }

  return (
    <ChatScreen
      list={list}
      detail={detail}
      selectedId={detail?.id ?? null}
      agents={agents}
      areas={areas}
      stages={stages}
      products={products}
      meId={user!.id}
      businessId={business.id}
      connected={isConnected(sessions)}
      invoice={{ add: business.invoice_add_tax ?? true, rate: business.invoice_tax_rate ?? 16 }}
      shipping={integrations.shipping}
      invoicing={integrations.invoicing}
    />
  );
}
