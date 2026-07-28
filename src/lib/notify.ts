"use client";
// Notificaciones fuera de la pestaña: sonido + Notification del sistema.
//
// Hasta ahora la app solo tenía toasts dentro de la página, que duran 6 segundos y únicamente se
// ven con la pestaña abierta y al frente. Si estabas en otra app o en otra pestaña, un mensaje
// nuevo — de cliente o del equipo — no te llegaba por ningún lado.
//
// Vive aquí y no dentro de un chat porque los dos chats pasan por RealtimeNotifier: así clientes
// y equipo se comportan igual por construcción, en vez de tener que mantenerlos sincronizados.

const SOUND_KEY = "ht_sound";
const DESKTOP_KEY = "ht_desktop";
const ASKED_KEY = "ht_notif_asked";

const on = (key: string) => {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
};

export const soundEnabled = () => on(SOUND_KEY);
export const desktopEnabled = () => on(DESKTOP_KEY);
export function setSoundEnabled(v: boolean) { try { localStorage.setItem(SOUND_KEY, v ? "1" : "0"); } catch {} }
export function setDesktopEnabled(v: boolean) { try { localStorage.setItem(DESKTOP_KEY, v ? "1" : "0"); } catch {} }

/** Pide permiso una sola vez, y solo tras un gesto del usuario — los navegadores ignoran (o
 *  penalizan) la petición si se hace al cargar la página. */
export function requestNotifyPermissionOnce() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  try { if (localStorage.getItem(ASKED_KEY) === "1") return; } catch {}
  const ask = () => {
    try { localStorage.setItem(ASKED_KEY, "1"); } catch {}
    Notification.requestPermission().catch(() => {});
    window.removeEventListener("pointerdown", ask);
    window.removeEventListener("keydown", ask);
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
 *  toast ya cumple, y duplicarlo es ruido. */
export function desktopNotify(opts: { title: string; body: string; href?: string; tag?: string }) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!desktopEnabled() || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: "/icon.svg",
      // Mismo tag = la nueva reemplaza a la anterior, así 20 mensajes de un chat no apilan
      // 20 notificaciones del sistema.
      tag: opts.tag,
    });
    n.onclick = () => {
      window.focus();
      if (opts.href) window.location.href = opts.href;
      n.close();
    };
  } catch { /* algunos navegadores exigen service worker (Android) — se ignora */ }
}

/** Sonido + notificación del sistema para un mensaje entrante. */
export function alertIncoming(opts: { title: string; body: string; href?: string; tag?: string }) {
  playPing();
  desktopNotify(opts);
}
