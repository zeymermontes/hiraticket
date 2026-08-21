"use server";
// Acciones puntuales del chat que NO son lecturas en vivo.
//
// Las lecturas en vivo (lista, contadores, mensajes, encabezado, detalle, insignias) vivían aquí y
// se mudaron a la ruta `/chat/live` —- ahí está explicado el porqué: React serializa las acciones
// de servidor por cliente, y una lectura colgada dejaba a todas las demás esperando detrás sin
// dar ningún error. Si hace falta una lectura nueva del chat en vivo, va en esa ruta, no aquí.
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getStickerTray, type StickerItem } from "@/lib/chat";
import { getNotificationFeed, type Notif, type NotifFilter } from "@/lib/notifications";
import { getMyBusiness } from "@/lib/queries";

/** Paginated notification feed for the bell + /notifications page (infinite scroll). */
export async function loadNotificationFeed(before?: string, filter: NotifFilter = "all", unreadOnly = false): Promise<Notif[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const biz = await getMyBusiness();
  if (!user || !biz) return [];
  const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const myName = (prof?.full_name as string) || (user.email ? user.email.split("@")[0] : "");
  return getNotificationFeed(biz.id, user.id, myName, { before, filter, unreadOnly });
}

/** Favorites + recent stickers for the send-sticker tray. */
export async function loadStickerTray(businessId: string): Promise<{ favorites: StickerItem[]; recent: StickerItem[] }> {
  return getStickerTray(businessId);
}
