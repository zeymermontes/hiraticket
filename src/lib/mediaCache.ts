"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Caché de archivos en el navegador, indexado por la RUTA en storage.
 *
 * El problema: `createSignedUrls` genera un token nuevo en cada llamada, y el token va en el query
 * string. Como el detalle del chat se vuelve a pedir seguido —- cada mensaje nuevo por realtime,
 * cada acción, y cada 4 segundos mientras el realtime está caído —- el `src` de cada imagen cambia
 * de cadena aunque el archivo sea el mismo. Para el navegador una URL distinta es un archivo
 * distinto, así que **re-descargaba todas las fotos de la conversación cada vez**.
 *
 * La ruta sí es estable, así que es la llave correcta. Es lo mismo que hace WhatsApp Web guardando
 * los bytes por hash del archivo: una vez que los tiene, no los vuelve a pedir.
 *
 * En un fallo de caché NO se cambia el `src`: se pinta con la URL firmada (que el <img> ya está
 * bajando de todos modos) y los bytes se guardan de fondo. Cambiar el src a un blob a medio camino
 * solo provocaría un parpadeo para ahorrar una descarga que ya ocurrió.
 */

const DB_NAME = "ht_media";
const DB_VERSION = 1;
const STORE = "blobs";
const USED_INDEX = "usedAt";

/** Tope del caché. Al pasarse se borran los menos usados recientemente. */
const MAX_BYTES = 300 * 1024 * 1024;
/**
 * Arriba de esto no se guarda: un archivo así se comería una parte desproporcionada del caché, y
 * guardarlo implica leer todos los bytes a memoria mientras la interfaz intenta responder. Para uno
 * de estos vale más volver a pedirlo que congelar la pestaña por adelantarse.
 */
const MAX_ITEM_BYTES = 8 * 1024 * 1024;

interface Entry { path: string; blob: Blob; bytes: number; usedAt: number }

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "path" }).createIndex(USED_INDEX, "usedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Modo privado, cuota llena o IndexedDB deshabilitado: se sigue sin caché, no se rompe nada.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Los bytes guardados para esta ruta, o null. Marca el uso para que la limpieza respete lo vivo. */
async function readBlob(path: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let req: IDBRequest<Entry | undefined>;
    try { req = tx(db, "readonly").get(path) as IDBRequest<Entry | undefined>; } catch { return resolve(null); }
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const hit = req.result;
      if (!hit?.blob) return resolve(null);
      // El toque de usedAt va en su propia transacción: si falla, el hit sigue siendo válido.
      try { tx(db, "readwrite").put({ ...hit, usedAt: Date.now() }); } catch {}
      resolve(hit.blob);
    };
  });
}

/** Borra los menos usados recientemente hasta volver bajo el tope. */
async function evict(db: IDBDatabase) {
  const store = tx(db, "readwrite");
  const all: Entry[] = await new Promise((resolve) => {
    const req = store.index(USED_INDEX).getAll() as IDBRequest<Entry[]>;
    req.onerror = () => resolve([]);
    req.onsuccess = () => resolve(req.result ?? []);
  });
  let total = all.reduce((n, e) => n + (e.bytes || 0), 0);
  if (total <= MAX_BYTES) return;
  // getAll por el índice ya viene ordenado por usedAt ascendente: los primeros son los más viejos.
  for (const e of all) {
    if (total <= MAX_BYTES) break;
    try { tx(db, "readwrite").delete(e.path); total -= e.bytes || 0; } catch { break; }
  }
}

async function writeBlob(path: string, blob: Blob) {
  if (!blob.size || blob.size > MAX_ITEM_BYTES) return;
  const db = await openDb();
  if (!db) return;
  try { tx(db, "readwrite").put({ path, blob, bytes: blob.size, usedAt: Date.now() } satisfies Entry); } catch { return; }
  await evict(db);
}

/** Guarda los bytes de una ruta que no estaba en caché. Se llama una vez por ruta por sesión. */
const inFlight = new Set<string>();
async function warm(path: string, url: string) {
  if (inFlight.has(path)) return;
  inFlight.add(path);
  try {
    // Misma URL que ya pidió el <img>, así que normalmente sale del caché HTTP del navegador.
    const res = await fetch(url);
    if (!res.ok) return;
    // El tamaño se mira ANTES de leer el cuerpo: `.blob()` de un archivo enorme trae todos los
    // bytes a memoria, y eso es parte de lo que trababa la interfaz al abrir un chat con una foto
    // pesada. Si no viene Content-Length, `writeBlob` lo descarta después por tamaño.
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_ITEM_BYTES) return;
    await writeBlob(path, await res.blob());
  } catch {
    // Sin red o URL vencida: no pasa nada, se reintenta la próxima vez que se monte.
  } finally {
    inFlight.delete(path);
  }
}

/**
 * Devuelve el `src` a usar para un archivo. `path` es la ruta en storage (estable) y `url` la URL
 * firmada del momento. Solo para pintar: el `href` y el arrastrar-a-otra-app deben seguir usando la
 * URL firmada, porque un blob local no sirve fuera de esta pestaña.
 */
export function useCachedMedia(path: string | null | undefined, url: string | null | undefined): string | undefined {
  const [cached, setCached] = useState<string | null>(null);
  // La URL firmada cambia en cada refetch. Se guarda en un ref para que eso NO reinicie el efecto:
  // una vez que tenemos los bytes, un token nuevo es irrelevante.
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!path) { setCached(null); return; }
    let alive = true;
    let objectUrl: string | null = null;
    (async () => {
      const blob = await readBlob(path);
      if (!alive) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setCached(objectUrl);
      } else if (urlRef.current) {
        // Se pinta con la URL firmada y los bytes quedan guardados para la próxima vez.
        void warm(path, urlRef.current);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return cached ?? url ?? undefined;
}

/** Vacía el caché — al cerrar sesión, para no dejar archivos de un negocio en un equipo compartido. */
export async function clearMediaCache() {
  const db = await openDb();
  if (!db) return;
  try { tx(db, "readwrite").clear(); } catch {}
}
