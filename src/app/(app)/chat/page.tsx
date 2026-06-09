import { getMyBusiness } from "@/lib/queries";
import { getConversationList, getConversationDetail, getAgents } from "@/lib/chat";
import { getAreas, getStages } from "@/lib/business";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { cookies } from "next/headers";
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
  const [list, agents, areas, stages, sessions] = await Promise.all([
    getConversationList(business.id),
    getAgents(business.id),
    getAreas(business.id),
    getStages(business.id),
    getSessions(business.id),
  ]);

  // No explicit ?c → reopen the last chat the agent viewed (cookie), else the most recent.
  const lastChat = (await cookies()).get("ht_lastChat")?.value;
  const validLast = lastChat && list.some((c) => c.id === lastChat) ? lastChat : null;
  const wantId = sp.c ?? validLast ?? list[0]?.id ?? null;
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
      stages={stages}
      meId={user!.id}
      businessId={business.id}
      connected={isConnected(sessions)}
    />
  );
}
