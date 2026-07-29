"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/platform";

/** Adjuntos que se purgan: pesados Y viejos. El storage lo llenan unos pocos archivos grandes, no
 *  los miles pequeños, así que atacar solo esos libera casi todo sin que nadie lo note. */
const MIN_BYTES = 20 * 1024 * 1024; // 20 MB
const MIN_AGE_DAYS = 90;

export interface MediaUsage {
  totalFiles: number;
  totalBytes: number;
  /** Lo que se llevaría una purga con los umbrales actuales. */
  purgeFiles: number;
  purgeBytes: number;
  minBytes: number;
  minAgeDays: number;
}

const PUBLIC_MARKER = "/object/public/media/";
/** media_url guarda la ruta del objeto, pero hay filas legacy con la URL pública completa. */
function objectPath(u: string): string | null {
  const i = u.indexOf(PUBLIC_MARKER);
  if (i >= 0) return decodeURIComponent(u.slice(i + PUBLIC_MARKER.length));
  return u.startsWith("http") ? null : u;
}

/** Cuánto storage hay y cuánto liberaría la purga. Solo lectura: nunca borra. */
export async function getMediaUsage(): Promise<MediaUsage | null> {
  if (!(await isPlatformAdmin())) return null;
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 86400_000).toISOString();

  // El tamaño vive en storage.objects.metadata; no está en messages, así que se lee de ahí.
  const { data, error } = await admin
    .schema("storage").from("objects")
    .select("name, created_at, metadata")
    .eq("bucket_id", "media")
    .limit(50_000);
  if (error) return null;

  const rows = (data ?? []) as { name: string; created_at: string; metadata: { size?: number } | null }[];
  let totalBytes = 0, purgeFiles = 0, purgeBytes = 0;
  for (const o of rows) {
    const size = Number(o.metadata?.size ?? 0);
    totalBytes += size;
    if (size >= MIN_BYTES && o.created_at < cutoff) { purgeFiles += 1; purgeBytes += size; }
  }
  return { totalFiles: rows.length, totalBytes, purgeFiles, purgeBytes, minBytes: MIN_BYTES, minAgeDays: MIN_AGE_DAYS };
}

export interface PurgeResult { ok: boolean; deleted: number; freedBytes: number; error?: string }

/** Borra los adjuntos pesados y viejos, y marca sus mensajes.
 *
 *  Borra por la API de Storage y no por SQL: quitar la fila de storage.objects deja el archivo
 *  ocupando espacio igual, que es justo lo que se quiere liberar.
 *
 *  El mensaje NO se borra: se marca con media_purged_at y se limpia media_url, así la conversación
 *  conserva que hubo un archivo (con su nombre) y la UI puede pedir que lo reenvíen. */
export async function purgeOldLargeMedia(): Promise<PurgeResult> {
  if (!(await isPlatformAdmin())) return { ok: false, deleted: 0, freedBytes: 0, error: "no-autorizado" };
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 86400_000).toISOString();

  const { data: objs, error: oErr } = await admin
    .schema("storage").from("objects")
    .select("name, created_at, metadata")
    .eq("bucket_id", "media")
    .lt("created_at", cutoff)
    .limit(50_000);
  if (oErr) return { ok: false, deleted: 0, freedBytes: 0, error: oErr.message };

  const targets = ((objs ?? []) as { name: string; metadata: { size?: number } | null }[])
    .filter((o) => Number(o.metadata?.size ?? 0) >= MIN_BYTES);
  if (!targets.length) return { ok: true, deleted: 0, freedBytes: 0 };

  const freedBytes = targets.reduce((s, o) => s + Number(o.metadata?.size ?? 0), 0);
  const paths = targets.map((o) => o.name);

  // El mapa ruta→mensaje se arma UNA vez: dentro del bucle sería una consulta a messages por cada
  // lote de 100, releyendo la tabla entera cada vez.
  const { data: msgs } = await admin.from("messages").select("id, media_url").not("media_url", "is", null).limit(50_000);
  const byPath = new Map<string, string>();
  for (const m of (msgs ?? []) as { id: string; media_url: string }[]) {
    const p = objectPath(m.media_url);
    if (p) byPath.set(p, m.id);
  }

  // De 100 en 100: un remove() con miles de rutas se cae por tamaño de petición.
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await admin.storage.from("media").remove(chunk);
    if (error) return { ok: false, deleted, freedBytes: 0, error: error.message };
    deleted += chunk.length;

    // Se marca lote a lote y no al final: si algo falla a medias, no quedan archivos borrados con
    // mensajes que sigan apuntando a ellos.
    const ids = chunk.map((p) => byPath.get(p)).filter((x): x is string => !!x);
    if (ids.length) {
      await admin.from("messages")
        .update({ media_purged_at: new Date().toISOString(), media_url: null })
        .in("id", ids);
    }
  }
  return { ok: true, deleted, freedBytes };
}
