"use client";

/**
 * Reencodado a formato web ANTES de subir.
 *
 * Es el hermano de `imageThumb`: aquel saca una miniatura para pintar el hilo; este arregla el
 * archivo que de verdad se guarda. Una foto sale del teléfono en 4 MB y 4032 px de ancho para
 * terminar pintada en una tarjeta de 520 px —- se paga el peso entero en cada apertura del link,
 * para nada.
 *
 * Se hace en el navegador y no en un worker/servidor por lo mismo que la miniatura: el archivo ya
 * está en memoria porque hay que subirlo de todos modos, y `createImageBitmap` decodifica fuera del
 * hilo principal, así que ni una foto de 12 MB congela la interfaz.
 *
 * NUNCA lanza y nunca empeora: si el navegador no sabe encodear WebP, si el formato no se puede
 * decodificar, o si el resultado pesa MÁS que el original (pasa con imágenes ya optimizadas), se
 * devuelve el archivo tal cual. Optimizar es una mejora, no un requisito para poder subir.
 */

/** Lado mayor del resultado. La tarjeta del anuncio mide ~520 px de CSS; 1600 cubre pantallas 3x
 *  y todavía deja margen si algún día se muestra más grande. */
const MAX_PX = 1600;
/** Calidad WebP. 0.82 es el punto donde deja de notarse la diferencia a simple vista. */
const QUALITY = 0.82;

export interface OptimizedImage {
  /** Lo que hay que subir: el reencodado, o el original si no se pudo/no convenía. */
  blob: Blob;
  /** Extensión que le toca al archivo en Storage. */
  ext: string;
  /** Tipo MIME de `blob`. */
  type: string;
  /** false = se subió el original tal cual (y entonces no hay nada que presumir de tamaños). */
  converted: boolean;
}

const extFromName = (name: string, type: string) => {
  const fromName = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  const fromType = (type.split("/").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return fromType === "jpeg" ? "jpg" : fromType || "bin";
};

const asIs = (file: File): OptimizedImage => ({
  blob: file, ext: extFromName(file.name, file.type), type: file.type || "application/octet-stream", converted: false,
});

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function optimizeForWeb(file: File): Promise<OptimizedImage> {
  if (!file.type.startsWith("image/")) return asIs(file);
  // SVG es vectorial y ya pesa nada: pasarlo por canvas solo lo rasterizaría (peor y más pesado).
  if (file.type === "image/svg+xml") return asIs(file);
  // El GIF animado perdería la animación —- canvas solo se queda con el primer cuadro.
  if (file.type === "image/gif") return asIs(file);

  let bmp: ImageBitmap | undefined;
  try {
    // `imageOrientation` respeta el EXIF de las fotos de teléfono; el navegador que no lo soporte
    // tira TypeError con las opciones y se reintenta sin ellas (ahí el canvas puede rotarlas, pero
    // eso ya pasaba antes de esta función).
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { bmp = await createImageBitmap(file); }

    const { width: sw, height: sh } = bmp;
    if (!sw || !sh) return asIs(file);

    const scale = Math.min(MAX_PX / sw, MAX_PX / sh, 1);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return asIs(file);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, dw, dh);

    const out = await toBlob(canvas, "image/webp", QUALITY);
    // `toBlob` con un tipo que no soporta NO falla: devuelve un PNG. Un PNG de una foto pesa más
    // que el JPEG original, así que si no salió WebP se deja el archivo como venía.
    if (!out || out.type !== "image/webp") return asIs(file);
    // Ya venía bien comprimido (un JPEG chico, un PNG de pocos colores): reencodar no ayuda.
    if (out.size >= file.size) return asIs(file);

    return { blob: out, ext: "webp", type: "image/webp", converted: true };
  } catch {
    // Formato que el navegador no decodifica, canvas "sucio" o memoria insuficiente.
    return asIs(file);
  } finally {
    bmp?.close();
  }
}

/** "4.2 MB", "380 KB" — para poder enseñar cuánto se ahorró. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
