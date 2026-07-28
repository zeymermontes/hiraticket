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

  const connect = async () => {
    if (stopped) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
    } catch { /* sin sesión: subscribe fallará y el backoff reintentará */ }
    if (stopped) return;
    if (ch) { try { supabase.removeChannel(ch); } catch {} ch = null; }
    ch = build(supabase.channel(name)).subscribe((status) => {
      if (stopped) return;
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

  const check = () => {
    if (stopped || typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (!ch || ch.state !== "joined") { attempt = 0; clearTimeout(timer); connect(); }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
  }
  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
    }
    if (ch) { try { supabase.removeChannel(ch); } catch {} }
  };
}
