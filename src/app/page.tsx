import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { Landing } from "@/components/Landing";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Public marketing landing; authenticated users go straight to the app.
  const supabase = await createClient();
  const user = await getSessionUser();
  if (user) redirect("/chat");
  return <Landing />;
}
