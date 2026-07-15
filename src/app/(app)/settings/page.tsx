import { getMyBusiness } from "@/lib/queries";
import { getSessions } from "@/lib/whatsapp";
import { isPlatformAdmin } from "@/lib/platform";
import { showOfficialWhatsApp, embeddedSignupConfig } from "@/lib/whatsapp-official";
import { SettingsScreen } from "@/components/SettingsScreen";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const [sessions, platformAdmin, showOfficial] = await Promise.all([
    getSessions(business.id),
    isPlatformAdmin(),
    showOfficialWhatsApp(),
  ]);
  const es = embeddedSignupConfig();
  return (
    <SettingsScreen
      businessId={business.id}
      sessions={sessions}
      isPlatformAdmin={platformAdmin}
      showOfficial={showOfficial}
      fbAppId={es.appId}
      esConfigId={es.configId}
    />
  );
}
