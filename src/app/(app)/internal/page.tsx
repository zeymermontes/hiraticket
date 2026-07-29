import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { getInternalThreads } from "@/lib/internal";
import { InternalChat } from "@/components/InternalChat";

export const dynamic = "force-dynamic";

export default async function InternalPage({ searchParams }: { searchParams: Promise<{ ch?: string }> }) {
  const sp = await searchParams;
  const business = await getMyBusiness();
  if (!business) return null;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;
  const { threads, agents } = await getInternalThreads(business.id, user.id);
  return <InternalChat initial={{ threads, agents, meId: user.id }} businessId={business.id} initialChannel={sp.ch ?? null} />;
}
