import { isPlatformAdmin, platformAdminCount, getPlatformOverview } from "@/lib/platform";
import { PlatformClaim, PlatformOverviewView } from "@/components/PlatformViews";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const admin = await isPlatformAdmin();
  if (!admin) {
    const count = await platformAdminCount();
    return <PlatformClaim canClaim={count === 0} />;
  }
  const data = await getPlatformOverview();
  return <PlatformOverviewView data={data} />;
}
