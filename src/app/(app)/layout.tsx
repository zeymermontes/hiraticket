import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getChatBadges, getNotifications } from "@/lib/notifications";
import { getInternalUnread } from "@/lib/internal";
import { getSessions, isConnected } from "@/lib/whatsapp";
import { getStages } from "@/lib/business";
import { getDueOrders } from "@/lib/extras";
import { doneStageIds } from "@/lib/doneStage";
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

  const [chatBadges, notifications, sessions, stages, internalUnread, { data: mem }] = await Promise.all([
    getChatBadges(business.id, user.id),
    getNotifications(business.id, user.id, myName),
    getSessions(business.id),
    getStages(business.id),
    getInternalUnread(business.id, user.id),
    supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle(),
  ]);

  // Open orders = not yet in the terminal stage. Bounded head-count (no full table scan).
  const doneIds = [...doneStageIds(stages, business.done_from_stage_id)];
  let q = supabase.from("orders").select("id", { count: "exact", head: true }).eq("business_id", business.id).is("deleted_at", null);
  if (doneIds.length) q = q.not("stage_id", "in", `(${doneIds.join(",")})`);
  // Fechas para las banderitas del TopBar: pedidos abiertos con fecha límite y citas programadas.
  // Solo las fechas —- los cubos (hoy/mañana/vencido) se arman en el CLIENTE, porque "hoy" depende
  // del huso del navegador y el servidor vive en UTC.
  const [{ count: openOrders }, dueOrders, { data: dueAppts }] = await Promise.all([
    q,
    getDueOrders(business.id, stages, business.done_from_stage_id ?? null),
    supabase.from("appointments").select("starts_at").eq("business_id", business.id).eq("status", "scheduled")
      .gte("starts_at", new Date(Date.now() - 60 * 86400000).toISOString())
      .lte("starts_at", new Date(Date.now() + 7 * 86400000).toISOString()),
  ]);
  const dueDates = [
    ...dueOrders.map((o) => o.due_at),
    ...((dueAppts ?? []) as { starts_at: string }[]).map((a) => a.starts_at),
  ];
  const objectName = (business.object_singular ?? "Pedido") + "s";

  return (
    <Shell
      user={shellUser}
      businessId={business.id}
      badges={{ chat: chatBadges.mine, orders: openOrders, internal: internalUnread }}
      secondaryBadges={{ chat: chatBadges.unassigned }}
      notifications={notifications}
      connected={isConnected(sessions)}
      objectName={objectName}
      personal={business.mode === "personal"}
      isAdmin={mem?.role === "admin"}
      notifPrefs={parseNotifPrefs(prof?.notif_prefs)}
      dueDates={dueDates}
    >
      {children}
    </Shell>
  );
}
