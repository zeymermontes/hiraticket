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

/** Enfoca el composer y deja el cursor al final del texto.
 *
 *  Llamar SIEMPRE dentro del gesto del usuario (el click en "Responder"/"Editar"): en iOS y en
 *  Android un `focus()` que ocurre fuera del gesto enfoca pero NO abre el teclado, que es justo
 *  lo que se busca en el teléfono.
 *
 *  El `setSelectionRange` se repite en el frame siguiente porque al editar el texto se escribe en
 *  el mismo tick y el valor todavía no está en el nodo cuando enfocamos.
 */
export function focusComposer(ref: RefObject<HTMLTextAreaElement | null>) {
  const el = ref.current;
  if (!el || el.disabled || el.readOnly) return;
  el.focus();
  const caretAlFinal = () => {
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch { /* algunos navegadores lo rechazan */ }
  };
  caretAlFinal();
  requestAnimationFrame(caretAlFinal);
}

/** ¿Enter envía el mensaje, o hace salto de línea?
 *
 *  Con teclado físico envía (y Shift+Enter salta de línea), que es lo esperado en escritorio.
 *  En un teléfono NO: ahí Enter es la tecla de salto de línea del teclado en pantalla y no hay
 *  Shift que valga, así que si envía es imposible escribir un mensaje de dos líneas. En táctil se
 *  envía con el botón.
 *
 *  Se mide por el puntero primario, no por el ancho: una ventana angosta en escritorio sigue
 *  teniendo teclado, y un teléfono en horizontal sigue sin tenerlo.
 */
export function enterSends(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(pointer: fine)").matches ?? true;
}
