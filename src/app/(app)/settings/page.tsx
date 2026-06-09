import { getMyBusiness } from "@/lib/queries";
import { getSessions } from "@/lib/whatsapp";
import { SettingsScreen } from "@/components/SettingsScreen";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const sessions = await getSessions(business.id);
  return <SettingsScreen businessId={business.id} sessions={sessions} />;
}
