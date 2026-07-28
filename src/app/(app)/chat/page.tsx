import { getMyBusiness } from "@/lib/queries";
import { getConversationListPage, getConversationDetail, getAgents } from "@/lib/chat";
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
  const { data: { user } } = await supabase.auth.getUser();
  // Seed the list with the window the UI opens on (tab "Míos", chip "Activos") — ChatScreen owns
  // it from there and refetches as filters change, so this is one page, not every conversation.
  const [firstPage, agents, areas, stages, sessions, products, integrations, urlDetail] = await Promise.all([
    getConversationListPage(business.id, { tab: "mine", meId: user!.id, status: "active", limit: 40 }),
    getAgents(business.id),
    getAreas(business.id),
    getStages(business.id),
    getSessions(business.id),
    getProducts(business.id),
    getActiveIntegrations(business.id),
    sp.c ? getConversationDetail(sp.c) : Promise.resolve(null),
  ]);
  const list = firstPage.rows;

  // No explicit ?c → reopen the last chat the agent viewed (cookie), else the most recent one.
  // Both are resolved directly instead of scanning the list, which is only a window now.
  let detail = urlDetail;
  if (!detail && !sp.c) {
    const lastChat = (await cookies()).get("ht_lastChat")?.value;
    detail = lastChat ? await getConversationDetail(lastChat) : null;
    if (!detail) {
      const { rows: newest } = await getConversationListPage(business.id, { scope: "all", limit: 1 });
      detail = newest[0] ? await getConversationDetail(newest[0].id) : null;
    }
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
