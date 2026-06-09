import { getMyBusiness } from "@/lib/queries";
import { getCanned } from "@/lib/canned";
import { Onboarding } from "@/components/Onboarding";
import { CannedScreen } from "@/components/CannedScreen";

export const dynamic = "force-dynamic";

export default async function CannedPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;
  const items = await getCanned(business.id);
  return <CannedScreen businessId={business.id} items={items} />;
}
