import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * URLs firmadas para el bucket `media`, que es PRIVADO.
 *
 * Todo lo que la app guarda de Storage es una RUTA (`<negocio>/in/…`, `proofs/<negocio>/…`,
 * `avatars/<usuario>-…`, `promo/<negocio>-…`). En la base quedan también URLs públicas de cuando el
 * bucket era público: `mediaPath` las convierte a ruta, así que firmar sirve para las dos.
 *
 * Firmar cuesta un viaje a Storage, y los avatares se piden en casi cada página: por eso hay un
 * caché en memoria del proceso (por ruta y duración) que reutiliza la firma mientras le quede
 * más de un 20 % de vida. No es un caché de datos —- solo del enlace —- y se vacía al reiniciar.
 */
export const PUBLIC_MEDIA_MARKER = "/object/public/media/";

/** Valor guardado → ruta dentro del bucket. `null` si es una URL externa (se deja tal cual). */
export function mediaPath(u: string | null | undefined): string | null {
  if (!u) return null;
  const i = u.indexOf(PUBLIC_MEDIA_MARKER);
  if (i >= 0) return decodeURIComponent(u.slice(i + PUBLIC_MEDIA_MARKER.length).split("?")[0]);
  if (!u.startsWith("http")) return u; // ya es una ruta
  return null;
}

const WEEK = 60 * 60 * 24 * 7;
const cache = new Map<string, { url: string; exp: number }>();

/** Firma cada valor: ruta o URL pública vieja → URL firmada; URL externa → igual; null → null. */
export async function signMediaUrls(values: (string | null | undefined)[], ttlSec = WEEK): Promise<(string | null)[]> {
  const now = Date.now();
  const paths = values.map(mediaPath);
  const key = (p: string) => `${ttlSec}|${p}`;
  const need = [...new Set(paths.filter((p): p is string => !!p && !((cache.get(key(p))?.exp ?? 0) > now)))];
  if (need.length) {
    try {
      const admin = createAdminClient();
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const { data } = await admin.storage.from("media").createSignedUrls(need, ttlSec);
      for (const s of data ?? []) {
        if (s.signedUrl && s.path) cache.set(key(s.path), { url: s.signedUrl.startsWith("http") ? s.signedUrl : base + s.signedUrl, exp: now + ttlSec * 800 });
      }
    } catch { /* sin firma se devuelve el valor guardado; el navegador dirá que no carga */ }
    if (cache.size > 5000) for (const [k, v] of cache) if (v.exp < now) cache.delete(k);
  }
  return values.map((v, i) => { const p = paths[i]; return p ? (cache.get(key(p))?.url ?? v ?? null) : (v ?? null); });
}

export async function signMediaUrl(value: string | null | undefined, ttlSec = WEEK): Promise<string | null> {
  return (await signMediaUrls([value], ttlSec))[0];
}
