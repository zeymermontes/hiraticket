import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Shell, type ShellUser } from "@/components/Shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const shellUser: ShellUser = {
    email: user.email ?? "",
    name:
      (user.user_metadata?.full_name as string) ||
      (user.email ? user.email.split("@")[0] : "Agente"),
  };

  return <Shell user={shellUser}>{children}</Shell>;
}
