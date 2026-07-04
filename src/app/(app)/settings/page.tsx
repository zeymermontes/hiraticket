import { getMyBusiness } from "@/lib/queries";
import { getSessions } from "@/lib/whatsapp";
import { isPlatformAdmin } from "@/lib/platform";
import { SettingsScreen } from "@/components/SettingsScreen";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const [sessions, platformAdmin] = await Promise.all([getSessions(business.id), isPlatformAdmin()]);
  return <SettingsScreen businessId={business.id} sessions={sessions} isPlatformAdmin={platformAdmin} />;
}
