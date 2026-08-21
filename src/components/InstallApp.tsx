"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { isStandalone } from "@/lib/useIsMobile";

type BipEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global { interface Window { __htInstall?: BipEvent | null } }

/** Qué se le puede ofrecer a este navegador ahora mismo. */
export type InstallState =
  | "none"      // ya está instalada, o el navegador no ofrece nada que podamos disparar
  | "prompt"    // Chrome/Edge guardaron el evento: hay diálogo de instalación de verdad
  | "ios";      // Safari en iPhone/iPad: no hay API, solo se puede explicar el gesto

/**
 * ¿Se puede instalar, y cómo?
 *
 * Instalar una PWA se pide de dos maneras irreconciliables. Chrome y Edge avisan con
 * `beforeinstallprompt` y dejan abrir su diálogo cuando queramos —- ese evento lo atrapa el script
 * del layout raíz, porque llega antes de que exista este componente. Safari no tiene ninguna API:
 * en iPhone la única vía es Compartir → Agregar a inicio, así que lo honesto es explicarlo, no
 * fingir un botón que no puede hacer nada.
 *
 * Y en iOS no es un adorno: Web Push SOLO existe si la app está en la pantalla de inicio. Sin este
 * paso, "avisos con la app cerrada" en un iPhone es un botón que nunca funcionará.
 */
export function useInstallApp(): { state: InstallState; install: () => Promise<boolean> } {
  const [state, setState] = useState<InstallState>("none");

  useEffect(() => {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      // iPadOS 13+ se anuncia como Mac; lo delata que la pantalla sea táctil.
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // Safari es el único navegador de iOS que puede agregar a inicio: Chrome/Firefox en iPhone son
    // Safari por dentro pero NO tienen esa opción, así que ofrecérsela sería mandar a una pared.
    const iOSSafari = iOS && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

    const apply = () => {
      if (isStandalone()) { setState("none"); return; }   // ya instalada: nada que ofrecer
      if (window.__htInstall) { setState("prompt"); return; }
      setState(iOSSafari ? "ios" : "none");
    };
    apply();
    window.addEventListener("ht:installable", apply);
    window.addEventListener("ht:installed", apply);
    return () => {
      window.removeEventListener("ht:installable", apply);
      window.removeEventListener("ht:installed", apply);
    };
  }, []);

  const install = useCallback(async () => {
    const ev = window.__htInstall;
    if (!ev) return false;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    // El evento se gasta al usarse: Chrome no deja volver a llamar prompt() sobre el mismo objeto.
    // Si dijeron que no, mandará otro en una visita futura.
    window.__htInstall = null;
    setState("none");
    return outcome === "accepted";
  }, []);

  return { state, install };
}

/**
 * La fila de "Instalar app", para el menú del perfil y el panel "Más".
 *
 * En iOS se convierte en instrucciones desplegables en vez de un botón: es lo único que se puede
 * hacer ahí, y decirlo cuesta menos que un botón que no responde.
 */
export function InstallAppRow({ variant = "menu" }: { variant?: "menu" | "block" }) {
  const { lang } = useApp();
  const es = lang === "es";
  const { state, install } = useInstallApp();
  const [howTo, setHowTo] = useState(false);

  if (state === "none") return null;

  const label = es ? "Instalar app" : "Install app";

  if (state === "prompt") {
    return variant === "menu" ? (
      <button className="menu-item" onClick={() => { install().catch(() => {}); }}><Icon name="download" size={15} />{label}</button>
    ) : (
      <button className="btn btn-primary btn-block" onClick={() => { install().catch(() => {}); }}><Icon name="download" size={16} />{label}</button>
    );
  }

  // iOS: el gesto, en dos pasos y con el icono que van a buscar en la barra de Safari.
  const steps = es
    ? "Toca Compartir ⬆ en la barra de Safari y elige “Agregar a inicio”."
    : "Tap Share ⬆ in Safari's bar and pick “Add to Home Screen”.";
  const why = es
    ? "Instalada abre a pantalla completa y es la única forma de recibir avisos con la app cerrada en iPhone."
    : "Installed it opens full screen, and it's the only way to get alerts with the app closed on iPhone.";

  return (
    <div className={variant === "menu" ? "" : "col gap-1"}>
      <button className={variant === "menu" ? "menu-item" : "btn btn-outline btn-block"} onClick={() => setHowTo((v) => !v)}>
        <Icon name="download" size={variant === "menu" ? 15 : 16} />{label}
      </button>
      {howTo && (
        <div className="t-xs muted" style={{ padding: "6px 12px 10px", lineHeight: 1.5 }}>
          {steps}<br />{why}
        </div>
      )}
    </div>
  );
}
