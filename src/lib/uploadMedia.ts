"use client";
import { createClient } from "@/lib/supabase/client";
import { makeImageThumb } from "@/lib/imageThumb";
import { uploadPath } from "@/lib/mediaUpload";

/**
 * Subir un archivo al bucket `media`, desde el navegador.
 *
 * Estaba escrito tres veces —- chat de clientes, chat de equipo y plantillas —- y las tres fallaban
 * igual de mal: un "Failed to fetch" seco, que es lo que dice el navegador cuando la petición ni
 * siquiera llegó a completar. Detrás de esa frase caben tres cosas muy distintas, y ninguna se
 * distinguía:
 *
 *  1. El archivo no se puede LEER. En Android el selector devuelve a menudo un puntero a un
 *     proveedor (Drive, WhatsApp, Descargas) en vez del archivo; si el proveedor ya no lo entrega,
 *     el `fetch` muere al ir a leer el cuerpo y la culpa parece de la red. Por eso el archivo se
 *     materializa ANTES: así el fallo sale donde de verdad está, con un texto que se entiende.
 *  2. Se cortó la conexión a media subida. Un teléfono cambiando de wifi a datos hace justo esto,
 *     y basta con volver a intentarlo —- ya con el archivo en memoria, que es lo que lo hace
 *     repetible. Se reintenta UNA vez.
 *  3. El archivo excede el tope del servidor, que corta la conexión en lugar de responder. Se ve
 *     igual que (2), así que el peso viaja en el mensaje: con eso se distingue de un vistazo.
 */

/** Tope de subida por defecto de Supabase Storage. Sirve para explicar, no para bloquear. */
const SOFT_MAX = 50 * 1024 * 1024;

export interface UploadedMedia {
  path: string;
  mime: string;
  name: string;
  size: number;
  thumb?: string;
}

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

/** El archivo en memoria. Un puntero que el proveedor ya no entrega muere aquí, y se nota. */
async function materialize(file: File): Promise<Blob> {
  try {
    return new Blob([await file.arrayBuffer()], { type: file.type || "application/octet-stream" });
  } catch {
    throw new Error(`no se pudo leer "${file.name}" desde el teléfono; guárdalo en el dispositivo y vuelve a elegirlo`);
  }
}

export async function uploadMedia(
  businessId: string,
  folder: "out" | "internal" | "templates",
  file: File,
): Promise<UploadedMedia> {
  const supabase = createClient();
  const body = await materialize(file);
  const mime = file.type || "application/octet-stream";

  let last = "";
  for (let intento = 0; intento < 2; intento++) {
    const path = uploadPath(businessId, folder, file);
    try {
      const { error } = await supabase.storage.from("media").upload(path, body, { contentType: mime, upsert: true });
      if (!error) {
        // La miniatura se calcula aquí porque es el único momento en que el archivo está a mano sin
        // volver a bajarlo. Solo aplica a imágenes; para todo lo demás devuelve undefined.
        return { path, mime, name: file.name, size: file.size, thumb: await makeImageThumb(file) };
      }
      last = error.message;
    } catch (e) {
      // `upload` lanza (en vez de devolver `error`) cuando el fallo es de red.
      last = e instanceof Error ? e.message : String(e);
    }
  }

  const peso = ` (${mb(file.size)} MB)`;
  const tope = file.size > SOFT_MAX ? "; el tope de subida son 50 MB" : "";
  throw new Error(`${last}${peso}${tope}`);
}
