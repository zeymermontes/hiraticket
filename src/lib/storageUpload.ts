"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Subida a Storage que SÍ reporta avance.
 *
 * `supabase.storage.upload()` usa fetch, y fetch no sabe decir cuántos bytes lleva enviados. Para
 * poder pintar una barra por archivo hay que hablarle al endpoint REST de Storage con XHR, que es
 * el único que expone `upload.onprogress`.
 *
 * Si algo de esa ruta falla (env sin definir, contrato del endpoint cambiado, CORS), se cae al
 * `upload()` normal: se pierde la barra, no la subida.
 */
export async function uploadWithProgress(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  body: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (base && anon) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || anon;
      const done = await new Promise<{ ok: boolean; error?: string } | null>((resolve) => {
        // Mismo formato que manda `storage-js` desde el navegador: multipart con `cacheControl` y el
        // archivo en el campo de nombre vacío. El Content-Type NO se pone a mano —- lo escribe el
        // navegador con el boundary, y el tipo real del archivo viaja en su propia parte.
        const form = new FormData();
        form.append("cacheControl", "3600");
        form.append("", new File([body], path.split("/").pop() || "file", { type: contentType || body.type || "application/octet-stream" }));

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${base}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("apikey", anon);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
        // Solo un 2xx cuenta como subido. Cualquier otra cosa —- incluido un 4xx —- devuelve null y
        // deja que lo reintente `storage-js`: si algún día el endpoint cambia de contrato, se
        // pierde la barra de avance, nunca la posibilidad de subir. Y si de verdad estaba mal
        // (archivo enorme, permisos), el segundo intento falla igual y con el mensaje bueno.
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve({ ok: true }); } else resolve(null); };
        xhr.onerror = () => resolve(null); // red/CORS → que lo intente la ruta normal
        xhr.send(form);
      });
      if (done) return done;
    } catch { /* cae al camino de abajo */ }
  }
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType: contentType || undefined, upsert: true });
  onProgress?.(100);
  return error ? { ok: false, error: error.message } : { ok: true };
}
