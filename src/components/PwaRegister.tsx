"use client";
import { useEffect } from "react";

/**
 * Registra el service worker.
 *
 * Va montado en el shell y no en cada pantalla porque lo que habilita —- recibir notificaciones —-
 * no depende de dónde estés. Ver `public/sw.js`: ese worker NO cachea nada a propósito.
 *
 * En desarrollo también se registra: si no, no habría manera de probar el push en local, que es
 * justo lo que hace falta antes de publicar.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Tras la carga: registrar compite por red y CPU con el primer pintado, y aquí no hay prisa.
    const register = () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // Buscar versión nueva al volver a la app.
    //
    // El worker es el único código de la app que NO se renueva al desplegar: el navegador se queda
    // con el que instaló y solo mira si hay otro cuando le toca. Una app instalada puede pasar días
    // sin darle esa oportunidad, y mientras tanto arrastra el worker viejo —- que es justo lo que
    // hizo falta esperar para que llegara el icono correcto de la barra de estado. Preguntar al
    // volver cuesta una petición condicional y quita ese "y ahora espera a que se actualice solo".
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return null;
}
