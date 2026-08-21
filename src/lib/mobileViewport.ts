"use client";

/**
 * El teclado del teléfono, que en iOS no se comporta como uno espera.
 *
 * En Android el teclado ENCOGE la ventana: `100dvh` se ajusta solo y el composer queda arriba del
 * teclado sin hacer nada. En iOS no: el teclado se dibuja ENCIMA sin tocar el viewport de layout,
 * así que un contenedor de `100dvh` sigue midiendo la pantalla completa y su parte de abajo —- el
 * composer, justo el que estás usando —- queda tapada. Encima, Safari desplaza la página entera
 * para "acomodar" el campo enfocado y deja el shell corrido.
 *
 * La única fuente de verdad es `visualViewport`: lo que de verdad se ve. Se publica su alto como
 * `--kb` en el <html> y la app se encoge esa cantidad.
 *
 * El umbral de 120px es a propósito: `visualViewport` también cambia cuando la barra de direcciones
 * del navegador se esconde al hacer scroll, y sin umbral la app estaría reacomodándose en cada
 * deslizada. Un teclado nunca mide menos de eso; una barra de direcciones nunca más.
 */
const KB_MIN = 120;

export function installKeyboardInset(): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return () => {};

  const apply = () => {
    const hidden = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    const open = hidden > KB_MIN;
    root.style.setProperty("--kb", open ? `${Math.round(hidden)}px` : "0px");
    if (open) root.dataset.kb = "open";
    else delete root.dataset.kb;
    // Safari deja la página desplazada tras enfocar un campo; sin esto la barra de arriba se va
    // fuera de vista y no vuelve hasta que cierras el teclado.
    if (open && window.scrollY !== 0) window.scrollTo(0, 0);
  };

  apply();
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    root.style.removeProperty("--kb");
    delete root.dataset.kb;
  };
}
