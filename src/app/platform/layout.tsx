import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { PlatformShell } from "@/components/PlatformShell";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <PlatformShell>{children}</PlatformShell>;
}
