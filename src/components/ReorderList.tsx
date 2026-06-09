"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface DragHandle { onPointerDown: (e: React.PointerEvent) => void }

/**
 * Pointer-based reorderable list with a floating ghost + live (FLIP-animated) preview of where
 * the dragged item will land. Drag is initiated only from the handle passed to renderItem.
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
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; dx: number; dy: number } | null>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragRef = useRef<string | null>(null);
  dragRef.current = dragKey;

  const map = new Map(items.map((it) => [getKey(it), it]));

  // Re-sync from props when items change (added/removed/persisted), but never mid-drag.
  useEffect(() => { if (!dragRef.current) setOrder(items.map(getKey)); /* eslint-disable-next-line */ }, [keyStr]);

  // FLIP: animate the non-dragged items from their previous position to the new one.
  useLayoutEffect(() => {
    itemRefs.current.forEach((el, key) => {
      const next = el.getBoundingClientRect();
      const prev = prevRects.current.get(key);
      if (prev && key !== dragRef.current) {
        const dy = prev.top - next.top;
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 150, easing: "cubic-bezier(.2,.7,.3,1)" });
      }
      prevRects.current.set(key, next);
    });
  });

  function startDrag(key: string, e: React.PointerEvent) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const el = itemRefs.current.get(key);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDragKey(key);
    setGhost({ x: e.clientX, y: e.clientY, w: rect.width, dx: e.clientX - rect.left, dy: e.clientY - rect.top });
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
      let targetKey: string | null = null;
      for (const k of orderRef.current) {
        if (k === key) continue;
        const r = itemRefs.current.get(k)?.getBoundingClientRect();
        if (!r) continue;
        if (ev.clientY < r.top + r.height / 2) { targetKey = k; break; }
      }
      setOrder((prev) => {
        const arr = prev.filter((k) => k !== key);
        arr.splice(targetKey ? arr.indexOf(targetKey) : arr.length, 0, key);
        return arr.join("|") === prev.join("|") ? prev : arr;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setDragKey(null);
      setGhost(null);
      const final = orderRef.current;
      if (final.join("|") !== keyStr) onReorder(final);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className={className}>
      {order.map((key) => {
        const item = map.get(key);
        if (!item) return null;
        const dragging = dragKey === key;
        return (
          <div key={key} ref={(el) => { if (el) itemRefs.current.set(key, el); else itemRefs.current.delete(key); }}
            className={itemClassName} style={{ opacity: dragging ? 0.4 : 1 }}>
            {renderItem(item, { onPointerDown: (e) => startDrag(key, e) }, dragging)}
          </div>
        );
      })}
      {ghost && dragKey && map.get(dragKey) && (
        <div style={{ position: "fixed", left: ghost.x - ghost.dx, top: ghost.y - ghost.dy, width: ghost.w, zIndex: 6000, pointerEvents: "none", boxShadow: "var(--sh-lg)", borderRadius: 12, transform: "scale(1.02) rotate(.6deg)", background: "var(--surface)" }}>
          {renderItem(map.get(dragKey)!, { onPointerDown: () => {} }, false)}
        </div>
      )}
    </div>
  );
}
