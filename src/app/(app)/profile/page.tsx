import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { ProfileScreen } from "@/components/ProfileScreen";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return null;

  // avatar_url (0045) may not be applied yet — fall back gracefully.
  let prof: Record<string, unknown> | null = null;
  const r = await supabase.from("profiles").select("full_name, avatar_color, avatar_url").eq("id", user.id).maybeSingle();
  prof = r.error
    ? ((await supabase.from("profiles").select("full_name, avatar_color").eq("id", user.id).maybeSingle()).data as Record<string, unknown> | null)
    : (r.data as Record<string, unknown> | null);

  const initial = {
    userId: user.id,
    email: user.email ?? "",
    name: (prof?.full_name as string) || (user.email ? user.email.split("@")[0] : ""),
    color: (prof?.avatar_color as string) || "#0E8C82",
    avatarUrl: (prof?.avatar_url as string | null) ?? null,
  };
  return <ProfileScreen initial={initial} />;
}
