import { getMyBusiness } from "@/lib/queries";
import { Onboarding } from "@/components/Onboarding";
import { Placeholder } from "@/components/Placeholder";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const business = await getMyBusiness();
  if (!business) return <Onboarding />;
  return <Placeholder icon="chat" labelKey="nav_chat" />;
}
