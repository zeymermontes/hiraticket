import { getMyBusiness, listMyOrgs } from "@/lib/queries";
import { getStages } from "@/lib/business";
import { getSessions } from "@/lib/whatsapp";
import { isPlatformAdmin } from "@/lib/platform";
import { showOfficialWhatsApp, embeddedSignupConfig } from "@/lib/whatsapp-official";
import { SettingsScreen } from "@/components/SettingsScreen";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const [sessions, platformAdmin, showOfficial, stages, orgs] = await Promise.all([
    getSessions(business.id),
    isPlatformAdmin(),
    showOfficialWhatsApp(),
    getStages(business.id),
    listMyOrgs(),
  ]);
  const es = embeddedSignupConfig();
  return (
    <SettingsScreen
      businessId={business.id}
      /* Con más de una organización, los avisos hay que decir DE CUÁL son (0084). Con una sola,
         decirlo sería ruido —- y esa es la situación de casi todo el mundo. */
      orgName={orgs.length > 1 ? business.name : null}
      sessions={sessions}
      stages={stages}
      doneFromStageId={business.done_from_stage_id ?? null}
      confirmPaymentStageId={business.confirm_payment_stage_id ?? null}
      confirmPaymentEnabled={business.confirm_payment_enabled ?? true}
      isPlatformAdmin={platformAdmin}
      showOfficial={showOfficial}
      fbAppId={es.appId}
      esConfigId={es.configId}
    />
  );
}
