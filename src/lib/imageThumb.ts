"use client";

/**
 * Miniatura generada en el navegador, al subir.
 *
 * Es la pieza que faltaba. Había dos lugares generando miniaturas —- WhatsApp (las manda dentro del
 * mensaje) y el worker de Go (las calcula al recibir) —- y los dos cubren solo lo que ENTRA. Las
 * imágenes que sube el equipo van del navegador directo a Storage, así que no pasaban por ninguno:
 * una foto pesada mandada por un agente no tenía nada que pintar y la burbuja terminaba cargando el
 * original completo, que es exactamente lo que traba la pestaña.
 *
 * Con esto, todo lo que sube ya trae su miniatura, y la regla del hilo se simplifica a "sin
 * miniatura, se pide un clic" —- sin fechas ni adivinar tamaños.
 *
 * Aquí sale gratis: el archivo ya está en memoria porque hay que subirlo de todos modos.
 */

/** Lado mayor de la miniatura. Igual que el worker de Go, para que se vean igual de los dos lados. */
const MAX_PX = 320;
/** Calidad JPEG. Sale en unos pocos KB y se muestra en una caja de ~220 px. */
const QUALITY = 0.62;
/** Tope de seguridad: una miniatura que no quepa aquí no vale la pena guardarla en la fila. */
const MAX_BYTES = 24 * 1024;

/**
 * Devuelve un data URI JPEG con la miniatura, o undefined si no se pudo.
 *
 * Nunca lanza: una miniatura es una mejora, no un requisito. Si falla, el mensaje se manda igual y
 * la foto simplemente queda detrás de un "Ver foto".
 */
export async function makeImageThumb(file: File | Blob): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  // Los SVG no tienen tamaño intrínseco fiable y ya son diminutos: no hay nada que reducir.
  if (file.type === "image/svg+xml") return undefined;

  let bmp: ImageBitmap | undefined;
  try {
    // createImageBitmap decodifica FUERA del hilo principal, así que subir una foto de 16 MB no
    // congela la interfaz mientras se calcula su miniatura.
    bmp = await createImageBitmap(file);
    const { width: sw, height: sh } = bmp;
    if (!sw || !sh) return undefined;

    const scale = Math.min(MAX_PX / sw, MAX_PX / sh, 1);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    // El suavizado importa al reducir mucho: sin él las fotos salen con dientes.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, dw, dh);

    const uri = canvas.toDataURL("image/jpeg", QUALITY);
    return uri.length <= MAX_BYTES ? uri : undefined;
  } catch {
    // Formato que el navegador no sabe decodificar, canvas "sucio", o memoria insuficiente.
    return undefined;
  } finally {
    bmp?.close();
  }
}
