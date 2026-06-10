import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getChatBadges, getNotifications } from "@/lib/notifications";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getStages } from "@/lib/business";
import { Shell, type ShellUser } from "@/components/Shell";
import { AppProvider } from "@/components/AppContext";
import { OnboardingWizard } from "@/components/OnboardingWizard";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // First-run onboarding: no business yet, or setup not finished/skipped.
  const business = await getMyBusiness();
  if (!business || !business.onboarded) {
    return (
      <AppProvider>
        <OnboardingWizard business={business} />
      </AppProvider>
    );
  }

  // Display name from the profile (matches @mention tokens + agent list), with fallbacks.
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.user_metadata?.full_name as string) || (user.email ? user.email.split("@")[0] : "Agente");
  const shellUser: ShellUser = { id: user.id, email: user.email ?? "", name: myName };

  const [chatBadges, notifications, sessions, stages] = await Promise.all([
    getChatBadges(business.id, user.id),
    getNotifications(business.id, user.id, myName),
    getSessions(business.id),
    getStages(business.id),
  ]);

  // Open orders = not yet in the terminal stage. Bounded head-count (no full table scan).
  const lastStageId = stages.length ? stages[stages.length - 1].id : null;
  let q = supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", business.id);
  if (lastStageId) q = q.neq("stage_id", lastStageId);
  const { count: openOrders } = await q;
  const objectName = (business.object_singular ?? "Pedido") + "s";

  return (
    <Shell
      user={shellUser}
      businessId={business.id}
      badges={{ chat: chatBadges.mine, orders: openOrders }}
      secondaryBadges={{ chat: chatBadges.unassigned }}
      notifications={notifications}
      connected={isConnected(sessions)}
      objectName={objectName}
      personal={business.mode === "personal"}
    >
      {children}
    </Shell>
  );
}
