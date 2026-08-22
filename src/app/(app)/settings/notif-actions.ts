"use server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseNotifPrefs, type NotifPrefs } from "@/lib/notifPrefs";

/**
 * Preferencias de aviso de quien está en sesión, EN LA ORGANIZACIÓN ACTIVA.
 *
 * Viven en la membresía y no en el perfil desde 0084: "avísame de los sin asignar" es una
 * respuesta distinta según el negocio, y estando en profiles apagarlo en uno lo apagaba en todos.
 */
export async function loadNotifPrefs(): Promise<NotifPrefs | null> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !business) return null;
  const { data, error } = await supabase.from("business_members")
    .select("notif_prefs").eq("user_id", user.id).eq("business_id", business.id).maybeSingle();
  // 0084 sin aplicar todavía: se cae a las del perfil, que es donde vivían hasta entonces.
  if (error) {
    const { data: prof } = await supabase.from("profiles").select("notif_prefs").eq("id", user.id).maybeSingle();
    return parseNotifPrefs((prof as { notif_prefs?: unknown } | null)?.notif_prefs);
  }
  return parseNotifPrefs((data as { notif_prefs?: unknown } | null)?.notif_prefs);
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !business) return { ok: false };
  // Con la llave de servicio y acotado a mano a (esta persona, esta organización) y a esta única
  // columna. La función `set_my_notif_prefs` hacía lo mismo con más ceremonia y en producción no
  // escribía nada sin dar error —- ver el comentario largo en profile/actions.ts. Aquí la acción ya
  // sabe quién llama y dónde está, así que no hace falta preguntárselo a la base.
  const { error } = await createAdminClient()
    .from("business_members")
    .update({ notif_prefs: prefs })
    .eq("user_id", user.id)
    .eq("business_id", business.id);
  if (!error) return { ok: true };
  // Sin la migración: se guardan donde vivían antes, para no dejar Ajustes sin efecto.
  const { error: fallback } = await supabase.from("profiles").update({ notif_prefs: prefs }).eq("id", user.id);
  return { ok: !fallback };
}
