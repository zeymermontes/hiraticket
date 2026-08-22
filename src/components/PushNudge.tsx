"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { browserSupportsPush, pushKeyPresent, subscribeToPush, currentPushEndpoint } from "@/lib/notify";
import { savePushSubscription, listPushDevices } from "@/app/(app)/settings/push-actions";
import { isStandalone } from "@/lib/useIsMobile";

/** La marca de "ahora no" es POR ORGANIZACIÓN.
 *
 *  Con una sola clave global pasaba esto: activas los avisos en tu organización de siempre, o
 *  descartas el aviso una vez, y al entrar a la segunda —- donde no tienes ninguna suscripción y por
 *  tanto no puede llegarte nada —- el aviso ya no vuelve a salir. Te quedas sin notificaciones de esa
 *  organización sin que nada te lo diga, que es exactamente el fallo que hay que evitar. */
const dismissedKey = (businessId: string) => `ht_pushNudge_${businessId}`;

/**
 * "Ya instalé la app y no me llegan notificaciones".
 *
 * Pasa porque son DOS pasos y solo uno se ve: instalar no suscribe a nada. El permiso lo tiene que
 * dar la persona, desde un gesto suyo, y hasta entonces el servidor no tiene a dónde empujar —- no
 * es que los avisos se pierdan, es que no existe el destinatario. El único sitio donde se podía
 * dar ese segundo paso era una fila dentro de Ajustes, que nadie tiene por qué visitar.
 *
 * Así que se ofrece donde sí se ve, una vez, y se puede quitar. Aparece solo si hay algo que
 * ofrecer: el navegador sabe recibir push, el despliegue trae la clave, este aparato no está ya
 * suscrito y nadie ha dicho que no.
 */
export function PushNudge({ businessId }: { businessId: string }) {
  const { lang } = useApp();
  const es = lang === "es";
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    try { if (localStorage.getItem(dismissedKey(businessId)) === "off") return; } catch { /* modo privado */ }
    if (!browserSupportsPush() || !pushKeyPresent()) return;
    // "denegado" es una decisión tomada: insistir no abre ningún diálogo, solo estorba.
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return;
    // En iPhone el push solo existe con la app en la pantalla de inicio; ahí el aviso que toca es
    // el de instalar (InstallAppRow), no este.
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !isStandalone()) return;
    // "Ya está suscrito" se pregunta contra la ORGANIZACIÓN activa, no contra el navegador: quien
    // entra a una segunda organización tiene suscripción de navegador pero ninguna fila ahí, y
    // sin este matiz el aviso no aparecería justo donde hace falta.
    (async () => {
      const ep = await currentPushEndpoint();
      const devices = await listPushDevices(ep ?? undefined);
      if (!devices.some((d) => d.current)) setShow(true);
    })().catch(() => {});
  }, [businessId]);

  const dismiss = () => { setShow(false); try { localStorage.setItem(dismissedKey(businessId), "off"); } catch {} };

  const enable = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await subscribeToPush();
      if (!r.ok) {
        setErr(r.reason === "denied"
          ? (es ? "El navegador no dio permiso." : "The browser denied permission.")
          : (es ? "No se pudo activar aquí." : "Couldn't enable it here."));
        return;
      }
      const saved = await savePushSubscription(r.sub);
      if (!saved.ok) {
        setErr(es ? "Se activó en el navegador pero no se pudo guardar en el servidor." : "Enabled in the browser but couldn't be saved on the server.");
        return;
      }
      dismiss();
    } catch {
      setErr(es ? "No se pudo activar aquí." : "Couldn't enable it here.");
    } finally { setBusy(false); }
  };

  if (!show) return null;
  return (
    <div className="rt-banner push-nudge" role="status">
      <Icon name="bell" size={15} />
      <span className="grow">
        {err ?? (es ? "Activa los avisos para enterarte con la app cerrada." : "Turn on alerts to hear about messages with the app closed.")}
      </span>
      <button className="btn btn-sm btn-dark" disabled={busy} onClick={enable}>
        {busy ? (es ? "Activando…" : "Enabling…") : (es ? "Activar" : "Turn on")}
      </button>
      <button className="rt-banner-x" onClick={dismiss} aria-label={es ? "Ahora no" : "Not now"}><Icon name="x" size={14} /></button>
    </div>
  );
}
