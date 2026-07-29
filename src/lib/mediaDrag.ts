"use client";
import type React from "react";

/** Nombre de archivo presentable: el guardado, o uno derivado del tipo. */
function fileName(name: string | null | undefined, mime: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (n) return n;
  const ext = (mime ?? "").split("/").pop() || "bin";
  return `archivo.${ext}`;
}

/** Props para arrastrar un adjunto FUERA del navegador (al escritorio, a Finder, a otra app o a
 *  otra página) sin bajarlo antes.
 *
 *  La clave es el tipo `DownloadURL`: Chrome y Edge lo leen y descargan el archivo ellos mismos al
 *  soltarlo. Firefox y Safari lo ignoran, así que se acompaña de `text/uri-list` y `text/plain`
 *  —que sí entienden— y ahí el arrastre deja al menos el enlace. */
export function dragOutProps(url: string | null | undefined, mime: string | null | undefined, name: string | null | undefined) {
  if (!url) return {};
  const file = fileName(name, mime);
  const type = mime || "application/octet-stream";
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // Un <img> arrastra su propia imagen por defecto; esto lo reemplaza por el archivo real.
      try { e.dataTransfer.setData("DownloadURL", `${type}:${file}:${url}`); } catch {}
      try { e.dataTransfer.setData("text/uri-list", url); } catch {}
      try { e.dataTransfer.setData("text/plain", url); } catch {}
      e.dataTransfer.effectAllowed = "copy";
      // No propaga al contenedor del chat: si no, soltarlo dentro lo interpreta como adjuntar.
      e.stopPropagation();
    },
  };
}

/** ¿Se puede poner ESTE adjunto en el portapapeles como archivo?
 *
 *  Solo imágenes. El portapapeles web acepta un puñado de tipos (texto, HTML, PNG) y nada más: un
 *  PDF o un ZIP no se pueden copiar como archivo desde una página, en ningún navegador. Para esos
 *  el camino es arrastrarlos fuera (dragOutProps) o descargarlos. */
export function canCopyFile(mime: string | null | undefined): boolean {
  return (mime ?? "").startsWith("image/")
    && typeof ClipboardItem !== "undefined"
    && !!navigator.clipboard?.write;
}

/** Copia el ARCHIVO al portapapeles (no su enlace). Queda pegable en Docs, Slack, WhatsApp…
 *  Devuelve false si el navegador lo rechaza. */
export async function copyFile(url: string, mime: string | null | undefined): Promise<boolean> {
  if (!canCopyFile(mime)) return false;
  try {
    const blob = await (await fetch(url)).blob();
    // Safari y Chrome solo aceptan PNG; WebP (los stickers) y JPEG se reencodan.
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch { return false; }
}

/** Copia el enlace del adjunto como texto. Acción aparte a propósito: "copiar archivo" y
 *  "copiar enlace" son cosas distintas y antes se decidía sola cuál hacer. */
export async function copyLink(url: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(url); return true; } catch { return false; }
}

/** Descarga el adjunto directo, sin abrir pestaña ni preview.
 *
 *  El atributo `download` de un <a> lo ignora el navegador cuando el archivo es de otro origen, y
 *  los adjuntos viven en Supabase Storage — por eso hasta ahora abrían pestaña en vez de bajar.
 *
 *  Camino preferido: Storage acepta `?download=<nombre>` y devuelve el Content-Disposition, así
 *  que el navegador baja el archivo con su nombre real sin que tengamos que traerlo a memoria
 *  (importa con videos y PDFs grandes). Si la URL no es de Storage, se cae al blob. */
export async function downloadMedia(url: string, name: string | null | undefined, mime?: string | null): Promise<boolean> {
  const file = fileName(name, mime);
  try {
    if (url.includes("/storage/v1/object/")) {
      const sep = url.includes("?") ? "&" : "?";
      triggerAnchor(`${url}${sep}download=${encodeURIComponent(file)}`, file);
      return true;
    }
    const blob = await (await fetch(url)).blob();
    const obj = URL.createObjectURL(blob);
    triggerAnchor(obj, file);
    setTimeout(() => URL.revokeObjectURL(obj), 10_000);
    return true;
  } catch { return false; }
}

function triggerAnchor(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Reencoda a PNG vía canvas (WebP y JPEG no son pegables directo en varios navegadores). */
async function toPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bmp, 0, 0);
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}
