import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness, listMyOrgs } from "@/lib/queries";
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

  // El color efectivo es el de la MEMBRESÍA si lo hay, y si no el del perfil (0085): nulo ahí
  // significa "usa el de siempre", que es como arranca una organización nueva.
  const business = await getMyBusiness();
  const orgs = await listMyOrgs();
  let memberColor: string | null = null;
  if (business) {
    const { data: mem } = await supabase.from("business_members")
      .select("avatar_color").eq("business_id", business.id).eq("user_id", user.id).maybeSingle();
    memberColor = ((mem as { avatar_color?: string | null } | null)?.avatar_color) ?? null;
  }

  const initial = {
    userId: user.id,
    email: user.email ?? "",
    name: (prof?.full_name as string) || (user.email ? user.email.split("@")[0] : ""),
    color: memberColor || (prof?.avatar_color as string) || "#0E8C82",
    avatarUrl: (prof?.avatar_url as string | null) ?? null,
  };
  // Solo con más de una organización tiene sentido decir que el color es de esta.
  return <ProfileScreen initial={initial} orgName={orgs.length > 1 && business ? business.name : null} />;
}
