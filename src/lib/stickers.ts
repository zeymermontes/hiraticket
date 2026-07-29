/** El mime de todos los stickers guardados: WhatsApp solo los maneja como WebP. */
export const STICKER_MIME = "image/webp";

/**
 * Las rutas del bucket `media` son `<business_id>/…` (las arma el worker, ver `uploadMedia`).
 *
 * Desde 0070 el cliente manda la ruta del sticker en vez del id del mensaje del que salió, así que
 * hay que confirmar que la ruta sea de este negocio: sin esto, alguien podría pedir el reenvío de un
 * archivo de otro inquilino nomás cambiando el parámetro.
 */
export function ownsMediaPath(businessId: string, path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !path.includes("..") && path.startsWith(businessId + "/");
}
