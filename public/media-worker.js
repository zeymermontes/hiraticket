/* eslint-disable */
/**
 * Web Worker del caché de archivos. Baja, arma y guarda los bytes FUERA del hilo principal.
 *
 * Todo esto corría antes en el hilo de la interfaz, y por eso abrir un chat con una foto pesada la
 * congelaba: leer el cuerpo de la respuesta, juntar los trozos en un Blob y escribirlo en IndexedDB
 * son operaciones que compiten con el render y con responder a un clic. Aquí no pueden. Es la
 * diferencia entre "no debería trabar" y "no puede trabar" —- es lo que hace WhatsApp Web.
 *
 * IndexedDB vive aquí también, a propósito: así el clonado estructurado de un blob grande al
 * guardarlo tampoco toca el hilo principal. Lo único que cruza es el Blob terminado, que se pasa por
 * referencia y no se copia.
 *
 * Va en /public y no como módulo del bundle para no depender de la configuración del empaquetador.
 * Se carga con ?v= para que un cambio aquí no quede servido desde el caché del navegador.
 */

const DB_NAME = "ht_media";
const DB_VERSION = 1;
const STORE = "blobs";
const USED_INDEX = "usedAt";

/** Tope del caché completo. Al pasarse se borran los menos usados recientemente. */
const MAX_BYTES = 300 * 1024 * 1024;
/**
 * Tope por archivo al PRECARGAR: más grande que esto no se baja solo, porque se comería una parte
 * desproporcionada del caché por algo que quizá nadie mire.
 */
const MAX_ITEM_BYTES = 8 * 1024 * 1024;
/**
 * Tope por archivo cuando alguien lo ABRIÓ. Ahí sí se guarda aunque sea grande: lo pidió a
 * propósito, y volver a bajar 16 MB cada vez que expande la misma foto es justo lo que hay que
 * evitar. El desalojo por menos-usado se encarga del presupuesto total.
 */
const MAX_OPENED_BYTES = 64 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "path" }).createIndex(USED_INDEX, "usedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Modo privado, cuota llena o IndexedDB apagado: se sigue sin caché, no se rompe nada.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const store = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);

/**
 * La entrada guardada para una ruta, o null. Puede ser los bytes o solo una MARCA de que el archivo
 * es demasiado grande para guardarlo.
 *
 * La marca es lo que evita el peor comportamiento que tenía esto: un archivo arriba del tope nunca
 * se guardaba, así que nunca había acierto de caché, así que se volvía a bajar completo en cada
 * montaje —- para siempre. Ahora se baja una vez (de hecho ni eso: se corta al leer la cabecera) y
 * se recuerda que no vale la pena.
 */
function readEntry(path) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      let req;
      try { req = store(db, "readonly").get(path); } catch { return resolve(null); }
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const hit = req.result;
        if (!hit || (!hit.blob && !hit.tooBig)) return resolve(null);
        // El toque de usedAt va aparte: si falla, el hit sigue siendo válido.
        try { store(db, "readwrite").put({ ...hit, usedAt: Date.now() }); } catch {}
        resolve(hit);
      };
    });
  });
}

/** Marca una ruta como demasiado grande, con su tamaño, para no volver a pedirla. */
async function markTooBig(path, bytes) {
  const db = await openDb();
  if (!db) return;
  try { store(db, "readwrite").put({ path, blob: null, bytes, tooBig: 1, usedAt: Date.now() }); } catch {}
}

/** Borra los menos usados recientemente hasta volver bajo el tope. */
function evict(db) {
  return new Promise((resolve) => {
    let req;
    try { req = store(db, "readonly").index(USED_INDEX).getAll(); } catch { return resolve(); }
    req.onerror = () => resolve();
    req.onsuccess = () => {
      const all = req.result || [];
      let total = all.reduce((n, e) => n + (e.bytes || 0), 0);
      // getAll por el índice viene ordenado por usedAt ascendente: los primeros son los más viejos.
      for (const e of all) {
        if (total <= MAX_BYTES) break;
        try { store(db, "readwrite").delete(e.path); total -= e.bytes || 0; } catch { break; }
      }
      resolve();
    };
  });
}

async function writeBlob(path, blob, cap) {
  if (!blob.size || blob.size > (cap || MAX_ITEM_BYTES)) return;
  const db = await openDb();
  if (!db) return;
  try { store(db, "readwrite").put({ path, blob, bytes: blob.size, usedAt: Date.now() }); } catch { return; }
  await evict(db);
}

/** Ya en curso, para no bajar dos veces el mismo archivo si dos burbujas lo piden a la vez. */
const inFlight = new Map();

async function download(path, url, onProgress, bailOverBytes) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("fetch " + res.status);
  const total = Number(res.headers.get("content-length") || 0);
  // Se decide con la cabecera, antes de leer un solo byte del cuerpo: si no cabe en el caché, se
  // cancela ahí mismo. Así aprender que un archivo pesa 16 MB cuesta una cabecera, no 16 MB.
  if (bailOverBytes && total > bailOverBytes) {
    try { res.body.cancel(); } catch {}
    return { tooBig: total };
  }
  onProgress(total > 0 ? 0 : null);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    if (total > 0) onProgress(Math.min(99, Math.round((got / total) * 100)));
  }
  return { blob: new Blob(chunks, { type: res.headers.get("content-type") || "application/octet-stream" }) };
}

self.onmessage = async (e) => {
  const { id, type, path, url } = e.data || {};
  const post = (msg) => self.postMessage({ id, ...msg });

  if (type === "clear") {
    const db = await openDb();
    if (db) { try { store(db, "readwrite").clear(); } catch {} }
    return post({ type: "done" });
  }

  // "get"  = los bytes ahora, bajándolos si hace falta (el visor: alguien abrió la foto).
  // "warm" = dejarlos guardados para después, si vale la pena por tamaño (el hilo).
  // "peek" = SOLO mirar el caché, nunca la red. Es lo que permite que el hilo muestre la versión
  //          nítida de una foto que ya se abrió una vez, sin volver a pedir nada.
  if (type !== "get" && type !== "warm" && type !== "peek") return;

  try {
    if (path) {
      const hit = await readEntry(path);
      // En "get" la marca se ignora: alguien abrió el visor a propósito y quiere ver el archivo,
      // pese lo que pese. En "warm" se respeta y no se toca la red.
      if (hit && hit.tooBig && type !== "get") return post({ type: "toobig", bytes: hit.bytes });
      if (hit && hit.blob) return post({ type: "blob", blob: hit.blob });
    }
    if (type === "peek") return post({ type: "miss" }); // no toca la red, por definición
    if (type === "warm" && path && inFlight.has(path)) return post({ type: "miss" });
    if (!url) return post({ type: "miss" });

    const key = path || url;
    let job = inFlight.get(key);
    if (!job) {
      job = download(path, url, (pct) => post({ type: "progress", pct }), type === "warm" ? MAX_ITEM_BYTES : 0)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    const out = await job;
    if (out.tooBig) {
      if (path) await markTooBig(path, out.tooBig);
      return post({ type: "toobig", bytes: out.tooBig });
    }
    if (path) await writeBlob(path, out.blob, type === "get" ? MAX_OPENED_BYTES : MAX_ITEM_BYTES);
    // En "warm" no se devuelve el blob: el <img> ya está pintando con la URL firmada y mandarlo
    // solo obligaría al hilo principal a cambiar el src para nada.
    post(type === "get" ? { type: "blob", blob: out.blob } : { type: "done" });
  } catch {
    post({ type: "error" });
  }
};
