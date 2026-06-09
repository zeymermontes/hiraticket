import { getMyBusiness } from "@/lib/queries";
import { getReports } from "@/lib/extras";
import { Onboarding } from "@/components/Onboarding";
import { ReportsScreen } from "@/components/ReportsScreen";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;
  const data = await getReports(business.id);
  return <ReportsScreen data={data} />;
}
