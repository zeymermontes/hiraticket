import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getTokenInvite } from "@/app/(app)/invites/actions";
import { InvitePopup, JoinNotice } from "@/components/InvitePopup";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  // Not signed in → sign in / sign up first, then come back here to join.
  if (!user) redirect(`/login?next=/join/${token}`);

  const info = await getTokenInvite(token);
  if (!info.ok) return <JoinNotice reason={info.error} />;

  return <InvitePopup businessName={info.businessName!} inviterName={info.inviterName} role={info.role!} token={token} />;
}
