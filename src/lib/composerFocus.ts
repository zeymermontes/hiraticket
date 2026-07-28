"use client";
import { useEffect, type RefObject } from "react";

/** Deja el cursor listo para escribir al abrir o cambiar de conversación.
 *
 *  Vive aquí y no dentro de un chat porque lo usan los dos (clientes y equipo): compartir el hook
 *  es la única forma de que no se separen con el tiempo.
 *
 *  Solo enfoca con puntero fino (mouse/trackpad). En táctil, enfocar abre el teclado en pantalla
 *  y tapa justo el hilo que acabas de abrir, así que ahí se deja al usuario decidir.
 *
 *  @param ref  el textarea del composer
 *  @param key  id de la conversación o del canal — al cambiar, se vuelve a enfocar
 */
export function useComposerFocus(
  ref: RefObject<HTMLTextAreaElement | null>,
  key: string | null | undefined,
) {
  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    // rAF: al cambiar de hilo el textarea puede remontarse en el mismo tick, y un focus()
    // sobre el nodo viejo se pierde.
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.disabled || el.readOnly) return;
      el.focus();
      // Al final del texto: si quedó un borrador, el cursor no debe caer al inicio.
      const n = el.value.length;
      try { el.setSelectionRange(n, n); } catch { /* algunos navegadores lo rechazan si no está enfocado */ }
    });
    return () => cancelAnimationFrame(id);
  }, [ref, key]);
}
