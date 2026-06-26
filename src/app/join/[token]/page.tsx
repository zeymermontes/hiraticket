import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getTokenInvite } from "@/app/(app)/invites/actions";
import { InvitePopup, JoinNotice } from "@/components/InvitePopup";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Not signed in → sign in / sign up first, then come back here to join.
  if (!user) redirect(`/login?next=/join/${token}`);

  const info = await getTokenInvite(token);
  if (!info.ok) return <JoinNotice reason={info.error} />;

  // One team per account: if they're already in a team, they can't join another.
  const business = await getMyBusiness();
  if (business) return <JoinNotice reason="already-in-team" />;

  return <InvitePopup businessName={info.businessName!} inviterName={info.inviterName} role={info.role!} token={token} />;
}
