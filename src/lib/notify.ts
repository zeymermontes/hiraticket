"use client";
// Notificaciones fuera de la pestaña: sonido + Notification del sistema.
//
// Hasta ahora la app solo tenía toasts dentro de la página, que duran 6 segundos y únicamente se
// ven con la pestaña abierta y al frente. Si estabas en otra app o en otra pestaña, un mensaje
// nuevo — de cliente o del equipo — no te llegaba por ningún lado.
//
// Vive aquí y no dentro de un chat porque los dos chats pasan por RealtimeNotifier: así clientes
// y equipo se comportan igual por construcción, en vez de tener que mantenerlos sincronizados.

// Misma llave que el interruptor de Ajustes que ya existía (y que usaba playChime en
// Shell): con una llave propia, apagar el sonido en Ajustes no habría apagado este.
const MUTE_KEY = "ht_muteNotif";
const DESKTOP_KEY = "ht_desktop";
const ASKED_KEY = "ht_notif_asked";

const on = (key: string) => {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
};

export const soundEnabled = () => { try { return localStorage.getItem(MUTE_KEY) !== "1"; } catch { return true; } };
export const desktopEnabled = () => on(DESKTOP_KEY);
export function setSoundEnabled(v: boolean) { try { localStorage.setItem(MUTE_KEY, v ? "0" : "1"); } catch {} }
export function setDesktopEnabled(v: boolean) { try { localStorage.setItem(DESKTOP_KEY, v ? "1" : "0"); } catch {} }

export const notifyPermission = (): NotificationPermission | "unsupported" =>
  typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission;

/** Pide permiso desde un gesto explícito del usuario (el botón de Ajustes). Devuelve el resultado.
 *  Los navegadores exigen el gesto: pedirlo al cargar la página se ignora o se penaliza. */
export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

/** Intento silencioso al primer clic/tecla, para quien nunca ha decidido.
 *
 *  Solo se marca como "ya preguntado" cuando el navegador DEVUELVE una decisión (granted/denied).
 *  Antes se marcaba antes de pedirlo, y ahí estaba el problema: Chrome muestra un aviso discreto
 *  en la barra —no un modal— a quien ya bloqueó notificaciones en otros sitios, así que la persona
 *  no veía nada, la promesa quedaba en "default", y no se le volvía a preguntar nunca. Quien caiga
 *  en ese caso ahora lo prende desde Ajustes. */
export function requestNotifyPermissionOnce() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  try { if (localStorage.getItem(ASKED_KEY) === "1") return; } catch {}
  const ask = () => {
    window.removeEventListener("pointerdown", ask);
    window.removeEventListener("keydown", ask);
    Notification.requestPermission()
      .then((res) => { if (res !== "default") { try { localStorage.setItem(ASKED_KEY, "1"); } catch {} } })
      .catch(() => {});
  };
  window.addEventListener("pointerdown", ask, { once: true });
  window.addEventListener("keydown", ask, { once: true });
}

let ctx: AudioContext | null = null;
/** Dos tonos cortos, generados con WebAudio: evita meter un archivo de audio al bundle y no
 *  depende de que un asset cargue. */
export function playPing() {
  if (typeof window === "undefined" || !soundEnabled()) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    // Tras un cambio de pestaña el contexto queda suspendido; sin esto el ping se pierde.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [880, 1170].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } catch { /* audio bloqueado por el navegador — el toast sigue apareciendo */ }
}

/** Notificación del sistema. Solo cuando la pestaña NO está al frente: con la pestaña visible el
 *  toast ya cumple, y duplicarlo es ruido.
 *
 *  Pasa por el SERVICE WORKER cuando lo hay, y no por `new Notification()`. Eso no es un detalle:
 *  en Android Chrome `new Notification()` LANZA excepción —- exige un service worker —- así que el
 *  `catch` de abajo se comía todos los avisos en teléfono y nadie se enteraba. Con el SW registrado
 *  funcionan los dos, y de paso el clic lo maneja `notificationclick` en sw.js, que reusa la
 *  ventana abierta en vez de abrir otra. */
export function desktopNotify(opts: { title: string; body: string; href?: string; tag?: string; image?: string }) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!desktopEnabled() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  const icon = opts.image || "/icons/icon-192.png";
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) {
        reg.showNotification(opts.title, {
          body: opts.body, icon, badge: "/icons/icon-192.png", tag: opts.tag,
          data: { href: opts.href || "/chat" },
        }).catch(() => {});
      } else {
        legacyNotify(opts, icon);
      }
    }).catch(() => legacyNotify(opts, icon));
    return;
  }
  legacyNotify(opts, icon);
}

/** Camino viejo, para escritorio sin service worker registrado todavía. */
function legacyNotify(opts: { title: string; body: string; href?: string; tag?: string }, icon: string) {
  try {
    const n = new Notification(opts.title, { body: opts.body, icon, tag: opts.tag });
    n.onclick = () => {
      window.focus();
      if (opts.href) window.location.href = opts.href;
      n.close();
    };
  } catch { /* sin SW y sin soporte: se queda en el toast */ }
}

/** Vibra, donde el dispositivo pueda.
 *  Solo Android (Chrome/Firefox): iOS no expone la API y un escritorio no tiene con qué vibrar,
 *  así que ahí el aviso se queda en sonido + notificación. */
export function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch {}
}

/** Patrón de llamada: pulsos largos separados, distinto de un mensaje. */
export const CALL_VIBRATION = [400, 200, 400, 200, 400];

/** Sonido + notificación del sistema para un mensaje entrante. */
export function alertIncoming(opts: { title: string; body: string; href?: string; tag?: string; image?: string }) {
  playPing();
  desktopNotify(opts);
}

/* ============================================================
   WEB PUSH — avisos con la app CERRADA
   Lo de arriba solo funciona con la pestaña abierta. Esto registra el dispositivo para que el
   servidor pueda empujar (ver src/lib/push.ts y public/sw.js).
   ============================================================ */

/** La clave pública VAPID viaja al navegador; la privada JAMÁS. Sin clave, no hay push y la app
 *  se comporta como antes. */
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** ¿Este NAVEGADOR sabe recibir push? (service worker + PushManager). */
export const browserSupportsPush = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

/** ¿Este DESPLIEGUE trae la clave pública VAPID? Se separa de lo anterior porque son dos fallos
 *  distintos y antes se contaban como uno: sin la variable en el servidor, la app decía "este
 *  navegador no soporta notificaciones" —- culpando al teléfono de algo que le faltaba al
 *  despliegue, y mandando a buscar el problema al sitio equivocado. */
export const pushKeyPresent = () => !!VAPID_PUBLIC;

export const pushSupported = () => browserSupportsPush() && pushKeyPresent();

/** La clave viaja en base64url y `applicationServerKey` la quiere en bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Lo que hay que mandarle al servidor para poder empujar a este aparato. */
export interface PushSubJSON { endpoint: string; p256dh: string; auth: string; ua: string }

const toJSON = (sub: PushSubscription): PushSubJSON | null => {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent };
};

/**
 * Suscribe este dispositivo. DEBE llamarse desde un gesto de la persona (el botón de Ajustes):
 * los navegadores ignoran —- o penalizan para siempre —- una petición de permiso sin gesto, y en
 * iOS es requisito estricto.
 *
 * Devuelve la suscripción para que el llamador la guarde en el servidor, o null con el motivo.
 */
export async function subscribeToPush(): Promise<{ ok: true; sub: PushSubJSON } | { ok: false; reason: "unsupported" | "denied" | "failed" }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const perm = await requestNotifyPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };
  try {
    const reg = await navigator.serviceWorker.ready;
    // Si ya había una, se reusa: volver a suscribir con otra clave falla, y de todos modos el
    // endpoint sería el mismo.
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true, // obligatorio en Chrome: nada de push silencioso
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    });
    const j = toJSON(sub);
    return j ? { ok: true, sub: j } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Baja de este dispositivo. Devuelve el endpoint que se dio de baja, para borrarlo del servidor. */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  } catch { return null; }
}

/** El endpoint actual, si este aparato ya está suscrito. Sirve para marcar "este dispositivo" en
 *  la lista de Ajustes. */
export async function currentPushEndpoint(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch { return null; }
}
