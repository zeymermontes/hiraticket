"use server";
import { createClient } from "@/lib/supabase/server";
import { parseNotifPrefs, type NotifPrefs } from "@/lib/notifPrefs";

/** Preferencias de notificación del usuario en sesión. */
export async function loadNotifPrefs(): Promise<NotifPrefs | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("notif_prefs").eq("id", user.id).maybeSingle();
  if (error) return null; // 0068 sin aplicar → el llamador usa los valores por defecto
  return parseNotifPrefs((data as { notif_prefs?: unknown } | null)?.notif_prefs);
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { error } = await supabase.from("profiles").update({ notif_prefs: prefs }).eq("id", user.id);
  return { ok: !error };
}
