"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface DragHandle { onPointerDown: (e: React.PointerEvent) => void }

/**
 * Stable pointer-based reorderable list.
 *  - The floating ghost follows the cursor via direct DOM writes (no per-frame re-render).
 *  - Insertion index is computed against the OTHER items' centers captured once at drag start,
 *    so it's monotonic and never oscillates (no flicker).
 *  - The list only re-renders when the order actually changes; the gap where the item will land
 *    is shown by the hidden placeholder, and the other rows shift with a FLIP animation.
 */
export function ReorderList<T>({
  items, getKey, onReorder, renderItem, className, itemClassName,
}: {
  items: T[];
  getKey: (item: T) => string;
  onReorder: (orderedKeys: string[]) => void;
  renderItem: (item: T, handle: DragHandle, dragging: boolean) => React.ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  const keyStr = items.map(getKey).join("|");
  const [order, setOrder] = useState<string[]>(items.map(getKey));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const orderRef = useRef(order); orderRef.current = order;
  const dragRef = useRef<string | null>(null); dragRef.current = dragKey;

  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const ghostRef = useRef<HTMLDivElement>(null);
  const slots = useRef<{ key: string; center: number }[]>([]);
  const offset = useRef({ dx: 0, dy: 0 });
  const start = useRef({ x: 0, y: 0 });
  const width = useRef(0);

  const map = new Map(items.map((it) => [getKey(it), it]));

  // Re-sync from props when not dragging (added/removed/persisted order).
  useEffect(() => { if (!dragRef.current) setOrder(items.map(getKey)); /* eslint-disable-next-line */ }, [keyStr]);

  // FLIP: runs only when the list actually re-renders (order/drag change), not per frame.
  useLayoutEffect(() => {
    itemRefs.current.forEach((el, key) => {
      const next = el.getBoundingClientRect();
      const prev = prevRects.current.get(key);
      if (prev && key !== dragRef.current) {
        const dy = prev.top - next.top;
        if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 160, easing: "cubic-bezier(.2,.7,.3,1)" });
      }
      prevRects.current.set(key, next);
    });
  });

  function startDrag(key: string, e: React.PointerEvent) {
    if (e.button) return;
    e.preventDefault();
    const el = itemRefs.current.get(key);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    start.current = { x: e.clientX, y: e.clientY };
    width.current = rect.width;
    // Fixed reference centers of the OTHER items, in current visual order.
    slots.current = orderRef.current.filter((k) => k !== key).map((k) => {
      const r = itemRefs.current.get(k)!.getBoundingClientRect();
      return { key: k, center: r.top + r.height / 2 };
    });
    document.body.style.userSelect = "none";
    setDragKey(key);

    const move = (ev: PointerEvent) => {
      const g = ghostRef.current;
      if (g) g.style.transform = `translate(${ev.clientX - offset.current.dx}px, ${ev.clientY - offset.current.dy}px) scale(1.02)`;
      let idx = 0;
      for (const s of slots.current) { if (ev.clientY > s.center) idx++; else break; }
      const base = slots.current.map((s) => s.key);
      base.splice(idx, 0, key);
      if (base.join("|") !== orderRef.current.join("|")) setOrder(base);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      const final = orderRef.current;
      setDragKey(null);
      if (final.join("|") !== keyStr) onReorder(final);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const dragItem = dragKey ? map.get(dragKey) : null;

  return (
    <div className={className}>
      {order.map((key) => {
        const item = map.get(key);
        if (!item) return null;
        const dragging = dragKey === key;
        return (
          <div key={key} ref={(el) => { if (el) itemRefs.current.set(key, el); else itemRefs.current.delete(key); }}
            className={itemClassName} style={dragging ? { visibility: "hidden" } : undefined}>
            {renderItem(item, { onPointerDown: (e) => startDrag(key, e) }, dragging)}
          </div>
        );
      })}
      {dragItem && (
        <div ref={ghostRef} style={{
          position: "fixed", left: 0, top: 0, width: width.current, zIndex: 6000, pointerEvents: "none",
          transform: `translate(${start.current.x - offset.current.dx}px, ${start.current.y - offset.current.dy}px) scale(1.02)`,
          boxShadow: "var(--sh-lg)", borderRadius: 12, background: "var(--surface)", willChange: "transform", opacity: 0.97,
        }}>
          {renderItem(dragItem, { onPointerDown: () => {} }, false)}
        </div>
      )}
    </div>
  );
}
