"use client";

/**
 * Detecta que esta pestaña quedó con un build viejo y la recupera.
 *
 * Next le pone un hash a cada server action al compilar. Un navegador que cargó la página antes de
 * un despliegue sigue pidiendo los hashes del build anterior, que ya no existen en el servidor —
 * responde 404 con el header de abajo y en el cliente la promesa se rechaza.
 *
 * Sin esto la pestaña queda zombi: el latido de resync del chat reintenta cada 4 segundos, los
 * `.catch()` se tragan el error, y la persona ve una app que parece viva pero está congelada en
 * datos viejos mientras golpea al servidor para siempre. Pasa en CADA despliegue, no solo al
 * migrar de servidor.
 *
 * Se intercepta en `fetch` a propósito: es el único punto por el que pasan todas las llamadas a
 * server actions, así que funciona igual en los sitios que ignoran el error — que son la mayoría.
 */

/** Header que pone Next cuando el action pedido no existe en este build (`app-router-headers`). */
const NOT_FOUND_HEADER = "x-nextjs-action-not-found";

const LAST_RELOAD_KEY = "ht_buildSkewReload";
/**
 * Ventana mínima entre recargas automáticas. Sin ella, un servidor que por cualquier razón siempre
 * contestara "no existe" dejaría al navegador recargando en bucle — peor que quedarse viejo.
 */
const RELOAD_COOLDOWN_MS = 60_000;

/** Se dispara en `window` cuando hay desfase y la pestaña está a la vista (hay que preguntarle). */
export const BUILD_SKEW_EVENT = "ht:buildskew";

let installed = false;
let stale = false;

/**
 * True cuando el build de esta pestaña ya no existe en el servidor. Los sondeos periódicos lo
 * consultan para dejar de reintentar: una vez que sabemos que va a fallar, insistir solo gasta CPU
 * del servidor.
 */
export const isBuildStale = () => stale;

/** Recarga para tomar el build nuevo. No hace nada si ya recargamos hace poco. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // Sin sessionStorage no hay candado contra el bucle, así que preferimos no recargar solos.
    return;
  }
  location.reload();
}

function onSkewDetected() {
  if (stale) return;
  stale = true;
  // Oculta: nadie pierde nada y es justo la pestaña olvidada que sondea sin fin. Visible: lo
  // preguntamos, porque un modal abierto o un pedido a medio llenar sí se perderían. (El borrador
  // del chat se guarda en cada tecla, ese sobrevive de todos modos.)
  if (document.visibilityState !== "visible") return reloadForNewBuild();
  window.dispatchEvent(new Event(BUILD_SKEW_EVENT));
  // Si ignoran el aviso y se van a otra pestaña, aprovechamos que ya no hay nada que perder.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") reloadForNewBuild();
  });
}

/** Envuelve `fetch` una sola vez para mirar (sin tocar) las respuestas de server actions. */
export function installBuildSkewGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = window.fetch;
  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await original.apply(this, args);
    // Solo se leen headers: la respuesta se devuelve intacta y sin consumir el cuerpo.
    if (res.headers.get(NOT_FOUND_HEADER) === "1") onSkewDetected();
    return res;
  } as typeof fetch;
}
