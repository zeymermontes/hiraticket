import { getMyBusiness } from "@/lib/queries";
import { getCampaigns } from "@/lib/extras";
import { getCanned } from "@/lib/canned";
import { Onboarding } from "@/components/Onboarding";
import { CampaignsScreen } from "@/components/CampaignsScreen";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;
  const [campaigns, canned] = await Promise.all([
    getCampaigns(business.id),
    getCanned(business.id),
  ]);
  return <CampaignsScreen businessId={business.id} campaigns={campaigns} cannedTitles={canned.map((c) => c.title)} />;
}
