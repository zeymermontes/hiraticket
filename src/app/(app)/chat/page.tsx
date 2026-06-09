import { getMyBusiness } from "@/lib/queries";
import { getConversationList, getConversationDetail, getAgents } from "@/lib/chat";
import { getAreas } from "@/lib/business";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { createClient } from "@/lib/supabase/server";
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
  const [list, agents, areas, sessions] = await Promise.all([
    getConversationList(business.id),
    getAgents(business.id),
    getAreas(business.id),
    getSessions(business.id),
  ]);

  const wantId = sp.c ?? list[0]?.id ?? null;
  const detail = wantId ? await getConversationDetail(wantId) : null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <ChatScreen
      list={list}
      detail={detail}
      selectedId={detail?.id ?? null}
      agents={agents}
      areas={areas}
      meId={user!.id}
      businessId={business.id}
      connected={isConnected(sessions)}
    />
  );
}
