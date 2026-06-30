"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Update the signed-in agent's own profile (display name / color / avatar). RLS: "own profile write". */
export async function updateMyProfile(patch: { full_name?: string; avatar_color?: string; avatar_url?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "no-auth" };

  const clean: Record<string, unknown> = {};
  if (patch.full_name !== undefined) clean.full_name = patch.full_name.trim() || null;
  if (patch.avatar_color !== undefined) clean.avatar_color = patch.avatar_color;
  if (patch.avatar_url !== undefined) clean.avatar_url = patch.avatar_url || null;
  if (Object.keys(clean).length === 0) return { ok: true };

  const { data, error } = await supabase.from("profiles").update(clean).eq("id", user.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "no-permission" };

  revalidatePath("/profile");
  revalidatePath("/", "layout"); // refresh the nav-rail avatar/name everywhere
  return { ok: true };
}
