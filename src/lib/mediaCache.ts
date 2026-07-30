"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Caché de archivos en el navegador, indexado por la RUTA en storage.
 *
 * Dos problemas se resuelven aquí.
 *
 * Uno: `createSignedUrls` genera un token nuevo en cada llamada y el token va en el query string.
 * El detalle del chat se vuelve a pedir seguido, así que el `src` de cada imagen cambiaba de cadena
 * aunque el archivo fuera el mismo —- y para el navegador una URL distinta es un archivo distinto,
 * o sea que re-descargaba todas las fotos cada vez. La ruta sí es estable, así que es la llave.
 *
 * Dos: bajar, armar y guardar los bytes son operaciones que compiten con el render. Por eso todo
 * eso vive en un Web Worker (`/public/media-worker.js`), IndexedDB incluido. Es la diferencia entre
 * "no debería trabar" y "no puede trabar", y es lo que hace WhatsApp Web.
 *
 * Este módulo es solo el cliente: manda mensajes, recibe blobs y los convierte en object URLs, que
 * es lo único que tiene que pasar en el hilo principal.
 */

/** Súbelo al cambiar el worker: si no, el navegador puede seguir sirviendo el viejo de su caché. */
const WORKER_URL = "/media-worker.js?v=5";

/**
 * Se dispara cuando el visor termina de guardar un archivo (detail = la ruta). Los peek del hilo lo
 * escuchan para volver a mirar el caché: sin esto, la burbuja seguía en miniatura o en "Ver foto"
 * hasta re-abrir la conversación, aunque los bytes ya estuvieran en el dispositivo —- que era
 * exactamente lo que se pedía evitar.
 */
const CACHED_EVENT = "ht:mediacached";

type Reply =
  | { id: number; type: "previewready"; path: string }
  | { id: number; type: "blob"; blob: Blob }
  | { id: number; type: "progress"; pct: number | null }
  | { id: number; type: "toobig"; bytes: number }
  | { id: number; type: "done" }
  | { id: number; type: "miss" }
  | { id: number; type: "error" };

/** `tooBig` trae el tamaño real cuando el archivo no cabe en el caché. Sirve de dos cosas: no
 *  volver a pedirlo, y decirle a la burbuja que esa foto es pesada sin depender de `media_size`
 *  —- que viene nulo en todos los mensajes anteriores a la migración 0067. */
type Answer = { blob: Blob | null; tooBig?: number };

interface Pending {
  resolve: (a: Answer) => void;
  onProgress?: (pct: number | null) => void;
}

let worker: Worker | null | undefined; // undefined = sin intentar, null = no disponible
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(WORKER_URL);
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const msg = e.data;
      // Anuncio suelto (sin petición pendiente): el worker terminó de generar la vista previa de
      // una entrada vieja. Se reenvía como CACHED_EVENT para que los peek de ese archivo re-miren.
      if (msg.type === "previewready") {
        window.dispatchEvent(new CustomEvent(CACHED_EVENT, { detail: msg.path }));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") return p.onProgress?.(msg.pct);
      pending.delete(msg.id);
      if (msg.type === "blob") return p.resolve({ blob: msg.blob });
      if (msg.type === "toobig") return p.resolve({ blob: null, tooBig: msg.bytes });
      p.resolve({ blob: null });
    };
    // Si el worker muere, se responde a todo lo pendiente y se marca como no disponible para caer
    // al camino sin caché en vez de dejar promesas colgadas para siempre.
    worker.onerror = () => {
      for (const [, p] of pending) p.resolve({ blob: null });
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function ask(type: "get" | "warm" | "peek" | "clear", path?: string | null, url?: string | null, onProgress?: (pct: number | null) => void): Promise<Answer> {
  const w = getWorker();
  if (!w) return Promise.resolve({ blob: null });
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve, onProgress });
    w.postMessage({ id, type, path, url });
  });
}

/**
 * Devuelve el `src` a usar para un archivo. `path` es la ruta en storage (estable) y `url` la URL
 * firmada del momento. Solo para pintar: el `href` y el arrastrar-a-otra-app deben seguir usando la
 * URL firmada, porque un blob local no sirve fuera de esta pestaña.
 *
 * En un fallo de caché NO se cambia el `src`: se pinta con la URL firmada, que el <img> ya está
 * bajando de todos modos, y los bytes se guardan de fondo. Cambiarlo a un blob a medio camino solo
 * daría un parpadeo para ahorrar una descarga que ya ocurrió.
 */
export function useCachedMedia(
  path: string | null | undefined,
  url: string | null | undefined,
  /**
   * "warm": si no está en caché, lo baja y lo guarda. "peek": solo mira el caché y NUNCA la red —-
   * devuelve `src` únicamente si los bytes ya estaban ahí. Peek es lo que permite que el hilo
   * muestre la versión nítida de una foto que ya se abrió, sin volver a pedir nada.
   */
  mode: "warm" | "peek" = "warm",
): { src: string | undefined; tooBigBytes: number } {
  const [cached, setCached] = useState<string | null>(null);
  const [tooBigBytes, setTooBig] = useState(0);
  // Sube cuando el visor guarda ESTE archivo: relanza el peek para pintar la versión nítida.
  const [tick, setTick] = useState(0);

  // La URL firmada cambia en cada refetch, y devolverla tal cual era un error grave: el `src` del
  // <img> cambiaba de cadena a media descarga, y ante un src nuevo el navegador CANCELA lo que iba
  // bajando y empieza de cero. Con una foto de 16 MB y un detalle que se refresca cada pocos
  // segundos, eso es un bucle donde la foto nunca termina —- se veía como la pestaña trabada, con
  // decenas de peticiones canceladas y megas tirados a la basura.
  //
  // Se fija la primera URL vista para este archivo y no se suelta. El token sigue siendo válido
  // (duran 7 días), así que no hay nada que ganar cambiándolo.
  const pin = useRef<{ path?: string | null; url?: string }>({});
  if (pin.current.path !== path || !pin.current.url) {
    pin.current = { path, url: url ?? undefined };
  }
  const stableUrl = pin.current.url;

  const urlRef = useRef(stableUrl);
  urlRef.current = stableUrl;

  useEffect(() => {
    if (!path || mode !== "peek") return;
    const onCached = (e: Event) => { if ((e as CustomEvent).detail === path) setTick((t) => t + 1); };
    window.addEventListener(CACHED_EVENT, onCached);
    return () => window.removeEventListener(CACHED_EVENT, onCached);
  }, [path, mode]);

  useEffect(() => {
    if (!path) { setCached(null); return; }
    let alive = true;
    let objectUrl: string | null = null;
    // "warm" devuelve el blob si YA estaba guardado, y null si hubo que bajarlo —- en ese caso los
    // bytes quedan en el caché para la próxima y aquí no se toca el src, que ya está pintando.
    ask(mode, path, mode === "warm" ? urlRef.current : null).then((a) => {
      if (!alive) return;
      if (a.tooBig) return setTooBig(a.tooBig);
      if (!a.blob) return;
      objectUrl = URL.createObjectURL(a.blob);
      setCached(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, mode, tick]);

  // En peek, si no estaba en caché no hay nada que devolver: caer a la URL firmada la bajaría,
  // que es exactamente lo que peek existe para no hacer.
  return { src: cached ?? (mode === "warm" ? stableUrl : undefined), tooBigBytes };
}

/**
 * Baja un archivo informando el avance, y lo guarda si cabe.
 *
 * El progreso solo se puede medir así, no en un `<img>`: el navegador no expone cuánto lleva bajado
 * de una imagen. Por eso el visor pide el archivo él mismo.
 *
 * `onProgress` recibe null cuando el servidor no manda Content-Length —- ahí no hay porcentaje
 * posible y vale más mostrar "cargando" que un número inventado.
 */
export async function fetchWithProgress(path: string | null | undefined, url: string, onProgress: (pct: number | null) => void): Promise<string | null> {
  const { blob } = await ask("get", path, url, onProgress);
  if (blob) {
    if (path) window.dispatchEvent(new CustomEvent(CACHED_EVENT, { detail: path }));
    return URL.createObjectURL(blob);
  }
  // Sin worker (o si falló): que el <img> lo intente con la URL firmada es mejor que no mostrar nada.
  return null;
}

/** Vacía el caché — al cerrar sesión, para no dejar archivos de un negocio en un equipo compartido. */
export async function clearMediaCache() {
  await ask("clear");
}
