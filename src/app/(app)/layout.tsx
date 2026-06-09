import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getMyChatBadge, getNotifications } from "@/lib/notifications";
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

  const shellUser: ShellUser = {
    email: user.email ?? "",
    name:
      (user.user_metadata?.full_name as string) ||
      (user.email ? user.email.split("@")[0] : "Agente"),
  };

  const [chatBadge, notifications, sessions, stages] = await Promise.all([
    getMyChatBadge(business.id),
    getNotifications(business.id),
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
      badges={{ chat: chatBadge, orders: openOrders }}
      notifications={notifications}
      connected={isConnected(sessions)}
      objectName={objectName}
    >
      {children}
    </Shell>
  );
}
