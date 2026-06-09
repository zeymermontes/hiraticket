import { isPlatformAdmin, platformAdminCount, getPlatformConsole } from "@/lib/platform";
import { PlatformClaim } from "@/components/PlatformViews";
import { PlatformConsole } from "@/components/PlatformConsole";
import { AppProvider } from "@/components/AppContext";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const admin = await isPlatformAdmin();
  if (!admin) {
    const count = await platformAdminCount();
    return <PlatformClaim canClaim={count === 0} />;
  }
  const data = await getPlatformConsole();
  return (
    <AppProvider>
      <PlatformConsole data={data} />
    </AppProvider>
  );
}
