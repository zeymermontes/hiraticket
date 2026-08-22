"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";

/** Update the signed-in agent's own profile (display name / color / avatar). RLS: "own profile write". */
export async function updateMyProfile(patch: { full_name?: string; avatar_color?: string; avatar_url?: string | null }): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "no-auth" };

  /**
   * El COLOR se guarda por organización; el nombre y la foto siguen siendo de la persona.
   *
   * Es la diferencia entre "quién eres" y "cómo te distingo aquí": tu nombre es el mismo en todas
   * partes, pero el color sirve para saber de un vistazo en cuál estás, así que tiene sentido que
   * cambie de una a otra. Va en la membresía (0085), donde ya viven el rol y las preferencias de
   * aviso, y por RPC —- RLS filtra filas y no columnas, así que abrir business_members a que cada
   * quien escriba su fila dejaría cambiarse el `role` de paso.
   *
   * Cambia SOLO tu fila: la de cada compañero es otra, así que esto no puede alcanzar su color.
   */
  if (patch.avatar_color !== undefined) {
    const business = await getMyBusiness();
    const rpc = business ? await supabase.rpc("set_my_member_color", { p_business: business.id, p_color: patch.avatar_color }) : { error: { message: "no-business" } };
    // Sin la migración 0085 se guarda donde vivía antes, para no dejar el selector sin efecto.
    if (rpc.error) await supabase.from("profiles").update({ avatar_color: patch.avatar_color }).eq("id", user.id);
  }

  const clean: Record<string, unknown> = {};
  if (patch.full_name !== undefined) clean.full_name = patch.full_name.trim() || null;
  if (patch.avatar_url !== undefined) clean.avatar_url = patch.avatar_url || null;
  if (Object.keys(clean).length > 0) {
    const { data, error } = await supabase.from("profiles").update(clean).eq("id", user.id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "no-permission" };
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout"); // refresh the nav-rail avatar/name everywhere
  return { ok: true };
}
