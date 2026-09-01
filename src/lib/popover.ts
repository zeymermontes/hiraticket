import type { CSSProperties } from "react";

/** Fixed-position style for a popover anchored to a trigger's rect, clamped inside the viewport so
 *  it never runs off-screen. Opens below the trigger by default; flips above if it would overflow the
 *  bottom. `align` picks which edge to anchor: "left" (default) or "right" (for right-aligned/outbound
 *  triggers). Pass the menu's `width` and an estimated `height` for accurate clamping. */
export function menuStyle(
  rect: DOMRect,
  opts?: { width?: number; height?: number; align?: "left" | "right"; gap?: number; margin?: number },
): CSSProperties {
  const width = opts?.width ?? 200;
  const height = opts?.height ?? 280;
  const align = opts?.align ?? "left";
  const gap = opts?.gap ?? 4;
  const m = opts?.margin ?? 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Horizontal: anchor to the chosen edge, then clamp both sides into [m, vw - m].
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.min(Math.max(m, left), Math.max(m, vw - width - m));

  // Vertical: below the trigger, but flip above if it would overflow the bottom.
  const below = rect.bottom + gap;
  const top = below + height > vh - m && rect.top - gap - height > m ? rect.top - gap - height : below;

  return { position: "fixed", left, top, width, maxHeight: Math.max(160, vh - top - m), overflowY: "auto", zIndex: 201 };
}

/**
 * Lo mismo, para lo que cuelga del COMPOSITOR: se abre hacia arriba.
 *
 * Los cuatro menús del compositor del chat de clientes —- plantillas, el autocompletado de "/",
 * menciones y stickers —- se colocaban a mano (`bottom: innerHeight - rect.top`, `left: rect.left`,
 * ancho fijo). En escritorio no se notaba; en un teléfono de 360 px un menú de 300 anclado a un
 * botón que ya está a 70 px del borde se sale de la pantalla por la derecha, y la mitad de las
 * plantillas quedaba fuera. `menuStyle` no servía tal cual porque abre hacia ABAJO, y ahí abajo
 * solo está el teclado.
 *
 * Así que: el ancho se encoge primero a lo que cabe, después se sujeta a los bordes, y si arriba no
 * queda sitio se abre hacia abajo —- que es mejor que salirse.
 */
export function menuStyleAbove(
  rect: DOMRect,
  opts?: { width?: number; height?: number; align?: "left" | "right"; gap?: number; margin?: number },
): CSSProperties {
  const height = opts?.height ?? 280;
  const align = opts?.align ?? "left";
  const gap = opts?.gap ?? 6;
  const m = opts?.margin ?? 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Encoger ANTES de colocar: un ancho que no cabe no hay posición que lo salve.
  const width = Math.max(160, Math.min(opts?.width ?? 240, vw - 2 * m));
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.min(Math.max(m, left), Math.max(m, vw - width - m));

  const roomAbove = rect.top - gap - m;
  if (roomAbove >= Math.min(height, 160)) {
    return { position: "fixed", left, bottom: vh - rect.top + gap, width, maxHeight: Math.min(height, roomAbove), overflowY: "auto", zIndex: 201 };
  }
  const top = rect.bottom + gap;
  return { position: "fixed", left, top, width, maxHeight: Math.max(160, vh - top - m), overflowY: "auto", zIndex: 201 };
}
