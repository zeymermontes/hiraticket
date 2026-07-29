import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { getNotificationFeed } from "@/lib/notifications";
import { NotificationsScreen } from "@/components/NotificationsScreen";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.email ? user.email.split("@")[0] : "");
  const initial = await getNotificationFeed(business.id, user.id, myName, { filter: "all" });
  return <NotificationsScreen initial={initial} />;
}
