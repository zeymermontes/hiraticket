import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, listMyOrgs } from "@/lib/queries";
import { getShellBadges } from "@/lib/shellBadges";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { Shell, type ShellUser } from "@/components/Shell";
import { AppProvider } from "@/components/AppContext";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { InvitePopup } from "@/components/InvitePopup";
import { getMyPendingInvite } from "@/app/(app)/invites/actions";
import { parseNotifPrefs } from "@/lib/notifPrefs";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getSessionUser();

  if (!user) redirect("/login");

  const business = await getMyBusiness();
  // No team yet: if someone invited this account, show the join popup instead of forcing them to
  // create their own workspace. Otherwise first-run onboarding (create a workspace).
  if (!business) {
    const pending = await getMyPendingInvite();
    if (pending) return <InvitePopup businessName={pending.businessName} inviterName={pending.inviterName} role={pending.role} inviteId={pending.id} />;
    return (
      <AppProvider>
        <OnboardingWizard business={null} email={user.email ?? ""} />
      </AppProvider>
    );
  }
  if (!business.onboarded) {
    return (
      <AppProvider>
        <OnboardingWizard business={business} />
      </AppProvider>
    );
  }

  // Display name + avatar from the profile (matches @mention tokens + agent list), with fallbacks.
  let prof: Record<string, unknown> | null = null;
  const pr = await supabase.from("profiles").select("full_name, avatar_color, avatar_url, notif_prefs").eq("id", user.id).maybeSingle();
  prof = pr.error
    ? ((await supabase.from("profiles").select("full_name, avatar_color").eq("id", user.id).maybeSingle()).data as Record<string, unknown> | null)
    : (pr.data as Record<string, unknown> | null);
  const myName = (prof?.full_name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split("@")[0] : "Agente");
  const shellUser: ShellUser = { id: user.id, email: user.email ?? "", name: myName, color: (prof?.avatar_color as string) || "#0E8C82", avatarUrl: (prof?.avatar_url as string | null) ?? null };

  // Las insignias van todas juntas en getShellBadges, que es también lo que refresca `/chat/live`
  // en vivo: si se calcularan aquí a mano, el refresco y la carga inicial dirían cosas distintas.
  const [badges, sessions, orgs, { data: mem }] = await Promise.all([
    getShellBadges(business.id, user.id, myName, business.done_from_stage_id ?? null),
    getSessions(business.id),
    listMyOrgs(),
    supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle(),
  ]);
  const objectName = (business.object_singular ?? "Pedido") + "s";

  return (
    <Shell
      user={shellUser}
      businessId={business.id}
      badges={{ chat: badges.mine, orders: badges.orders, internal: badges.internal }}
      secondaryBadges={{ chat: badges.unassigned }}
      notifications={badges.notifications}
      connected={isConnected(sessions)}
      objectName={objectName}
      personal={business.mode === "personal"}
      isAdmin={mem?.role === "admin"}
      notifPrefs={parseNotifPrefs(prof?.notif_prefs)}
      dueDates={badges.dueDates}
      orgs={orgs}
    >
      {children}
    </Shell>
  );
}
