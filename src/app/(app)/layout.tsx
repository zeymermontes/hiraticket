import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getMyChatBadge, getNotifications } from "@/lib/notifications";
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

  const [chatBadge, notifications] = await Promise.all([
    getMyChatBadge(business.id, user.id),
    getNotifications(business.id),
  ]);

  return (
    <Shell user={shellUser} badges={{ chat: chatBadge }} notifications={notifications}>
      {children}
    </Shell>
  );
}
