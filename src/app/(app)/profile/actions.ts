"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";

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
    if (!business) return { ok: false, error: "no-business" };
    /**
     * Se escribe con la llave de servicio y NO por la función `set_my_member_color`.
     *
     * La función existía por una buena razón —- RLS filtra filas y no columnas, así que abrir
     * business_members a que cada quien actualice su fila dejaría cambiarse el `role` de paso —-
     * pero en producción no escribía nada y sin dar error: `auth.uid()` dentro de ella no estaba
     * resolviendo al usuario, así que el UPDATE tocaba cero filas y todo parecía haber ido bien.
     * Ese es el fallo que se veía como "cambio el color y sale igual en las dos organizaciones":
     * ninguna de las dos guardaba nada, y las dos caían al color del perfil.
     *
     * Aquí no hace falta esa función: la acción YA sabe quién llama (la sesión) y en qué
     * organización está (la cookie, que solo elige entre las suyas), así que la escritura se acota
     * a mano a esa pareja y a esa única columna. Es más estrecho que lo que permitía la función, y
     * sin una pieza en medio que pueda fallar en silencio.
     */
    const { data: written, error } = await createAdminClient()
      .from("business_members")
      .update({ avatar_color: patch.avatar_color })
      .eq("user_id", user.id)
      .eq("business_id", business.id)
      .select("business_id");
    // Sin la migración 0085 no existe la columna: se guarda donde vivía antes para no dejar el
    // selector sin efecto, pero el error se devuelve si tampoco eso funciona.
    if (error) {
      const alt = await supabase.from("profiles").update({ avatar_color: patch.avatar_color }).eq("id", user.id);
      if (alt.error) return { ok: false, error: `perfil: ${alt.error.message}` };
      return { ok: true };
    }
    // Un UPDATE que no tocó ninguna fila NO es un error para Postgres, y ese silencio es justo lo
    // que hizo perder dos rondas persiguiendo por qué el color no cambiaba: la pantalla decía que
    // había guardado. Si no se escribió, se dice, y se dice DÓNDE se intentó.
    if (!written?.length) {
      return { ok: false, error: `sin fila para user ${user.id.slice(0, 8)} en negocio ${business.id.slice(0, 8)}` };
    }
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

/**
 * El color de la APP para la organización activa (0088).
 *
 * Aparte de updateMyProfile porque no es del perfil: el nombre y la foto son de la persona, esto
 * es "cómo se ve la app cuando estoy en ESTA organización". Misma escritura acotada a mano a
 * (esta persona, esta organización) y a esta única columna.
 */
export async function setMyBrandColor(color: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !business) return { ok: false, error: "no-session" };
  const { error } = await createAdminClient()
    .from("business_members")
    .update({ brand_color: color || null })
    .eq("user_id", user.id)
    .eq("business_id", business.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
