import { createClient } from "@/lib/supabase/server";
import { mediaTypeOf } from "@/lib/mediaUpload";

export interface CannedMessage {
  id: string;
  title: string;
  body: string;
  category: string | null;
  shortcut: string | null;
  /** Ruta dentro del bucket `media`, no URL. null = plantilla de solo texto. Ver 0090. */
  media_url: string | null;
  media_mime: string | null;
  media_name: string | null;
  media_size: number | null;
  media_thumb: string | null;
}

/** Las columnas del adjunto. Se pide igual desde el navegador y desde los flujos. */
export const CANNED_COLS = "id, title, body, category, shortcut, media_url, media_mime, media_name, media_size, media_thumb";

export async function getCanned(businessId: string): Promise<CannedMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("canned_messages")
    .select(CANNED_COLS)
    .eq("business_id", businessId)
    .order("category", { ascending: true });
  return (data ?? []) as CannedMessage[];
}

type CannedMedia = Pick<CannedMessage, "media_url" | "media_mime" | "media_name" | "media_size" | "media_thumb">;

/**
 * Los campos de `messages` con los que sale una plantilla.
 *
 * Una plantilla de texto sale como siempre; una con archivo sale como el adjunto y el texto va de
 * pie de foto —- exactamente lo mismo que hace el modal de "Enviar archivos". Se comparte para que
 * el flujo automático y el envío a mano no manden cosas distintas.
 *
 * El archivo NO se re-sube: se reutiliza la ruta que guardó la plantilla (ver 0090).
 */
export function cannedMediaFields(tpl: CannedMedia) {
  if (!tpl.media_url) return { type: "text", media_url: null, media_mime: null, media_name: null, media_size: null, meta: null };
  const mime = tpl.media_mime || "application/octet-stream";
  return {
    type: mediaTypeOf(mime),
    media_url: tpl.media_url,
    media_mime: mime,
    media_name: tpl.media_name,
    media_size: tpl.media_size,
    meta: tpl.media_thumb ? { thumb: tpl.media_thumb } : null,
  };
}
