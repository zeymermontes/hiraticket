import { getMyBusiness } from "@/lib/queries";
import { getCanned } from "@/lib/canned";
import { CannedScreen } from "@/components/CannedScreen";

export const dynamic = "force-dynamic";

export default async function CannedPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const items = await getCanned(business.id);
  return <CannedScreen businessId={business.id} items={items} />;
}
