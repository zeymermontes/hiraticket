"use client";
import { useEffect, useState } from "react";

/**
 * ¿Estamos en un teléfono?
 *
 * Existe porque el CSS no alcanza. `ChatScreen` decide sus columnas con `style` inline
 * (`gridTemplateColumns`), y un `style` inline le gana a cualquier `@media`: la regla que
 * colapsaba el chat a una columna en 680px llevaba tiempo escrita y sin efecto. Para apagar ese
 * inline hace falta saberlo en JavaScript, no solo en la hoja de estilos.
 *
 * Es por ANCHO y no por "es un dispositivo táctil": una tableta con teclado o una ventana angosta
 * en escritorio quieren el mismo trato, y un portátil con pantalla táctil no.
 *
 * OJO con el servidor: durante el SSR no hay ventana, así que arranca en `false` (escritorio) y
 * se corrige en el primer efecto. Quien lo use para ESCONDER algo debe tenerlo en cuenta —- por eso
 * el layout móvil se aplica con CSS siempre que se pueda, y esto queda para lo que el CSS no puede.
 */
export const MOBILE_BP = 768; // debe coincidir con --bp-mobile en tokens.css

export function useIsMobile(bp: number = MOBILE_BP): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [bp]);
  return mobile;
}

/** ¿Corre como app instalada (pantalla de inicio) y no como pestaña? En iOS es la diferencia
 *  entre tener Web Push y no tenerlo, así que Ajustes necesita saberlo para explicar por qué. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
