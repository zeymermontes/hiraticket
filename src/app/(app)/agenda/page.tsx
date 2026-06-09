import { getMyBusiness } from "@/lib/queries";
import { getAppointments } from "@/lib/extras";
import { Onboarding } from "@/components/Onboarding";
import { AgendaScreen } from "@/components/AgendaScreen";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;
  const appointments = await getAppointments(business.id);
  return <AgendaScreen businessId={business.id} appointments={appointments} />;
}
