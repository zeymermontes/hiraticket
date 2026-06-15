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
