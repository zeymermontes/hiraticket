"use client";
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

/** Mantiene vivo un canal de realtime.
 *
 *  Por qué existe: los canales se suscribían con `.subscribe()` a secas. Si el socket se caía —red
 *  intermitente, suspensión del equipo, el token expirando— el canal quedaba muerto y no volvía
 *  solo. El síntoma es el que reportaron: a veces recargas y no llegan avisos, y a veces ni se
 *  sincronizan los mensajes de WhatsApp, sin nada en pantalla que lo explique.
 *
 *  Hace tres cosas que faltaban:
 *
 *  1. Re-autentica el socket antes de cada intento. El access token dura una hora y lo puede
 *     renovar el middleware del servidor; el socket se queda con el viejo, Realtime lo cierra al
 *     expirar, y al reconectar vuelve a presentar un token muerto.
 *  2. Reintenta con backoff exponencial (1s → 30s) en vez de rendirse al primer error.
 *  3. Revisa al volver a la pestaña y al recuperar red — que es justo cuando el socket suele haber
 *     muerto sin avisar.
 *
 *  Devuelve la función de limpieza para el useEffect.
 */
export function keepSubscribed(
  supabase: SupabaseClient,
  name: string,
  build: (ch: RealtimeChannel) => RealtimeChannel,
  opts?: {
    /** `reconnected` es false la primera vez y true tras recuperarse: sirve para ponerse al día. */
    onHealthy?: (reconnected: boolean) => void;
    onDown?: () => void;
  },
): () => void {
  let ch: RealtimeChannel | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everHealthy = false;
  /**
   * Qué intento de conexión es el vigente.
   *
   * Sin esto había un bucle que se alimentaba solo, y salía caro: al reconectar se retira el canal
   * anterior, y ese retiro le entrega un `CLOSED` a SU MISMA función de estado —- que no sabía que
   * ya la habían jubilado. Lo interpretaba como caída, programaba otra reconexión, la reconexión
   * retiraba el canal nuevo, y vuelta a empezar. Como el contador de espera se pone a cero en cada
   * conexión buena, el ciclo se quedaba clavado en uno por segundo: medido, ~11 peticiones por
   * segundo para siempre, porque cada "reconexión" arrastra una puesta al día completa. En un
   * teléfono eso es la batería.
   *
   * Con el número de intento, el aviso de un canal ya reemplazado se ignora y el ciclo se corta.
   */
  let gen = 0;

  const connect = async () => {
    if (stopped) return;
    const mine = ++gen;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
    } catch { /* sin sesión: subscribe fallará y el backoff reintentará */ }
    if (stopped || mine !== gen) return;
    if (ch) { const old = ch; ch = null; try { supabase.removeChannel(old); } catch {} }
    ch = build(supabase.channel(name)).subscribe((status) => {
      if (stopped || mine !== gen) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        const reconnected = everHealthy;
        everHealthy = true;
        opts?.onHealthy?.(reconnected);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        opts?.onDown?.();
        retry();
      }
    });
  };

  const retry = () => {
    if (stopped) return;
    clearTimeout(timer);
    const wait = Math.min(30_000, 1_000 * 2 ** attempt);
    attempt += 1;
    timer = setTimeout(connect, wait);
  };

  /**
   * Vuelta a la vida tras un rato fuera.
   *
   * Mirar `ch.state` no basta y ese era el agujero: cuando el sistema CONGELA la app —- que es lo
   * que hace Android con una app instalada en segundo plano —- el socket se muere del lado del
   * servidor, pero el aviso de cierre nunca llega a un proceso congelado. Al volver, el canal
   * sigue diciendo "joined" tan tranquilo mientras ya no recibe nada: por eso al reabrir no
   * aparecían los chats nuevos y luego saltaba el aviso de conexión perdida.
   *
   * Así que tras más de 15 s escondido no se pregunta, se rehace la suscripción y punto. Cuesta un
   * viaje; dar por bueno un socket muerto cuesta no enterarse de los mensajes.
   */
  const RESUME_AFTER_MS = 15_000;
  let hiddenAt = 0;
  const check = (force = false) => {
    if (stopped || typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (force || !ch || ch.state !== "joined") { attempt = 0; clearTimeout(timer); connect(); }
  };
  const onVis = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    check(away > RESUME_AFTER_MS);
  };

  /**
   * Vigilante de pulso.
   *
   * Hace falta porque el canal MIENTE: se puede cerrar el socket de golpe y el canal se queda
   * diciendo "joined" tan contento, sin llamar nunca a la función de estado. Medido: socket muerto
   * a propósito, y ni aviso en pantalla ni sondeo de respaldo ni reconexión —- la app simplemente
   * dejaba de enterarse de todo, en silencio. Es el "vuelvo a abrir y no están los chats nuevos".
   *
   * Así que cada 10 s se pregunta a la capa de transporte, que sí sabe la verdad. Es una
   * comprobación en memoria, sin red: cuesta nada.
   */
  const beat = setInterval(() => {
    if (stopped || typeof document === "undefined" || document.visibilityState !== "visible") return;
    const alive = ch?.state === "joined" && supabase.realtime.isConnected();
    if (!alive && ch) { opts?.onDown?.(); check(true); }
  }, 10_000);

  const onWake = () => check();
  // Volver desde el caché de "atrás/adelante" (y algunos reanudados de PWA) no dispara
  // visibilitychange: el socket de una página restaurada así está igual de muerto.
  const onShow = (e: PageTransitionEvent) => { if (e.persisted) check(true); };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onShow);
  }
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(beat);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onShow);
    }
    if (ch) { try { supabase.removeChannel(ch); } catch {} }
  };
}
