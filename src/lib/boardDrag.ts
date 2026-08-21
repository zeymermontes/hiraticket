"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Arrastrar tarjetas entre columnas de un tablero, en ratón Y en pantalla táctil.
 *
 * Hay dos mecanismos porque el navegador obliga:
 *
 * - **Ratón**: arrastre nativo de HTML (`draggable`), que es lo que ya había y funciona bien.
 * - **Táctil**: el arrastre nativo NO existe en iPhone y en Android depende del navegador, así que
 *   se hace a mano con eventos de puntero. Se activa MANTENIENDO PULSADO ~280 ms: sin esa espera,
 *   el primer deslizamiento del dedo sobre una tarjeta se llevaría la tarjeta en vez de desplazar
 *   la columna, y el tablero se volvería imposible de recorrer.
 *
 * Y lo que faltaba en las dos: **desplazamiento lateral al llegar al borde**. En un teléfono cabe
 * una columna por pantalla, así que sin esto solo se puede soltar donde ya se está mirando —- o sea
 * en ningún sitio útil. Al acercar el fantasma a un borde, el tablero se desplaza, y más rápido
 * cuanto más pegado esté.
 *
 * Detalle no obvio: mientras dura el arrastre se apaga `scroll-snap-type` del tablero. El imán de
 * columnas está para el dedo, y peleaba con el desplazamiento por cuadros —- lo devolvía de un tirón
 * a la columna anterior. Se restaura al soltar, así que el imán sigue ahí para navegar.
 */

const LONG_PRESS_MS = 280;
const CANCEL_SLOP = 10;   // px de deslizamiento que cancelan el "mantener pulsado" (era un scroll)
const EDGE_MAX = 76;      // ancho máximo de la zona sensible de cada borde
const MAX_SPEED = 20;     // px por cuadro con el dedo pegado al borde

export function useBoardDrag({ onDrop }: { onDrop: (colId: string, cardId: string) => void }) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // Qué tarjeta va en el aire. En ref y no solo en estado: quien suelta lee esto en el mismo turno
  // en que se limpia el estado, y ahí `drag` todavía valdría lo de antes.
  const dragRef = useRef<string | null>(null);
  const vx = useRef(0);
  const raf = useRef(0);
  // Con el dedo quieto en el borde, el tablero se sigue moviendo y la columna de debajo cambia:
  // el rastreo del destino tiene que correr también por cuadro, no solo al mover el dedo.
  const onScrollTick = useRef<() => void>(() => {});

  // Táctil de verdad (teléfono/tableta), no "pantalla angosta": un portátil táctil con ratón
  // conserva el arrastre nativo, que ahí es mejor.
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const apply = () => setTouch(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const tick = useCallback(() => {
    const el = boardRef.current;
    if (!el || !vx.current) { raf.current = 0; return; }
    el.scrollLeft += vx.current;
    onScrollTick.current();
    raf.current = requestAnimationFrame(tick);
  }, []);

  const edgeScroll = useCallback((clientX: number) => {
    const el = boardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const zone = Math.min(EDGE_MAX, r.width * 0.22);
    let v = 0;
    if (clientX < r.left + zone) v = -MAX_SPEED * Math.min(1, (r.left + zone - clientX) / zone);
    else if (clientX > r.right - zone) v = MAX_SPEED * Math.min(1, (clientX - (r.right - zone)) / zone);
    vx.current = v;
    if (v && !raf.current) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopScroll = useCallback(() => {
    vx.current = 0;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    onScrollTick.current = () => {};
  }, []);

  const snap = (on: boolean) => { const b = boardRef.current; if (b) b.style.scrollSnapType = on ? "" : "none"; };

  useEffect(() => stopScroll, [stopScroll]);

  /** Columna bajo un punto de la pantalla (el fantasma no estorba: no recibe eventos). */
  const colAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return (el?.closest?.("[data-col]") as HTMLElement | null)?.dataset.col ?? null;
  };

  function startTouchDrag(e: React.PointerEvent, id: string) {
    const card = e.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const offX = startX - rect.left, offY = startY - rect.top;
    const pid = e.pointerId;
    let x = startX, y = startY;
    let active = false;
    let target: string | null = null;
    let ghost: HTMLElement | null = null;

    const place = () => { if (ghost) ghost.style.transform = `translate(${x - offX}px, ${y - offY}px) rotate(1.5deg)`; };
    const track = () => { const next = colAt(x, y); if (next !== target) { target = next; setOver(next); } };

    const activate = () => {
      active = true;
      try { navigator.vibrate?.(12); } catch { /* sin motor de vibración: da igual */ }
      ghost = card.cloneNode(true) as HTMLElement;
      ghost.classList.add("kcard-ghost");
      ghost.style.cssText += `position:fixed;left:0;top:0;width:${rect.width}px;margin:0;pointer-events:none;z-index:400;`;
      place();
      document.body.appendChild(ghost);
      document.body.classList.add("dragging-card");
      snap(false);
      onScrollTick.current = track;
      dragRef.current = id;
      setDrag(id);
      track();
    };
    const timer = window.setTimeout(activate, LONG_PRESS_MS);

    // El navegador solo deja cancelar el desplazamiento si NADIE lo ha empezado todavía —- por eso
    // el listener es `passive:false` y el arrastre nace de un dedo quieto: al activarse aún no hay
    // ningún scroll en marcha que ya no se pueda detener.
    const onTouchMove = (ev: TouchEvent) => { if (active) ev.preventDefault(); };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      x = ev.clientX; y = ev.clientY;
      if (!active) {
        if (Math.abs(x - startX) > CANCEL_SLOP || Math.abs(y - startY) > CANCEL_SLOP) end(false);
        return;
      }
      place(); track(); edgeScroll(x);
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === pid) end(true); };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pid) end(false); };

    function end(drop: boolean) {
      clearTimeout(timer);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      if (!active) return;
      ghost?.remove();
      document.body.classList.remove("dragging-card");
      stopScroll();
      snap(true);
      setDrag(null);
      setOver(null);
      // Soltar sobre el botón "Abrir" no debe abrir nada: el clic que viene detrás se traga. Con
      // fecha de caducidad —- si no llegó ninguno, no puede quedarse esperando a comerse el
      // siguiente clic de verdad, que puede ser dentro de un minuto y en otro sitio.
      const swallow = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 350);
      const card = dragRef.current;
      dragRef.current = null;
      if (drop && target && card) onDropRef.current(target, card);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  return {
    drag,
    over,
    /** Va en el contenedor con scroll horizontal (`.board`). */
    boardProps: {
      ref: boardRef,
      onDragOver: (e: React.DragEvent) => { if (drag) edgeScroll(e.clientX); },
    },
    /** Va en cada columna. `data-col` es también lo que lee el arrastre táctil. */
    columnProps: (colId: string) => ({
      "data-col": colId,
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(colId); edgeScroll(e.clientX); },
      onDragLeave: () => setOver((o) => (o === colId ? null : o)),
      onDrop: () => {
        const card = dragRef.current;
        stopScroll(); snap(true); dragRef.current = null; setDrag(null); setOver(null);
        if (card) onDropRef.current(colId, card);
      },
    }),
    /** Va en cada tarjeta. */
    cardProps: (id: string) => ({
      draggable: !touch,
      onDragStart: () => { dragRef.current = id; setDrag(id); snap(false); },
      onDragEnd: () => { stopScroll(); snap(true); dragRef.current = null; setDrag(null); setOver(null); },
      onPointerDown: (e: React.PointerEvent) => { if (touch && e.pointerType !== "mouse" && !e.button) startTouchDrag(e, id); },
    }),
  };
}
