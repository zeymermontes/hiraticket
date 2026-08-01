"use client";
import React, { useMemo, useRef, useState, type CSSProperties } from "react";
import { formatMoney } from "@/lib/types";
import type { Product } from "@/lib/extras";

/** Igual que en CatalogPicker: `position: fixed` anclado al rect del campo, no `absolute` — si no,
 *  el dropdown se corta cuando el campo está cerca del borde del panel con scroll (mermas,
 *  artículos del pedido, ambos dentro del drawer que hace scroll). */
function popStyle(rect: DOMRect): CSSProperties {
  const W = Math.max(220, Math.min(320, rect.width)), m = 8, gap = 4;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(m, rect.left), vw - W - m);
  const below = vh - rect.bottom - m;
  const above = rect.top - m;
  const base: CSSProperties = { position: "fixed", left, width: W, zIndex: 201 };
  if (below < 160 && above > below) return { ...base, bottom: vh - rect.top + gap, maxHeight: Math.min(260, above - gap) };
  return { ...base, top: rect.bottom + gap, maxHeight: Math.min(260, below - gap) };
}

/**
 * Campo de texto libre que además sugiere del catálogo mientras se escribe — reemplaza al par
 * "input + flechita para abrir el catálogo" que había en mermas y en productos del pedido. Al
 * escribir se filtra en vivo; si nada hace match se oculta (no un "sin resultados" fijo); al
 * borrar letras vuelve a aparecer lo que sí matchea. Con el campo vacío y enfocado se ve el
 * catálogo completo, para poder seguir explorándolo como con la flechita de antes.
 */
export function CatalogAutocomplete({
  value, onChange, onPick, onBlur, onKeyDown, products, personal, lang, placeholder, className, style, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (p: Product) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  products: Product[];
  personal: boolean;
  lang: "es" | "en";
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name, lang === "es" ? "es" : "en", { sensitivity: "base" })), [products, lang]);
  const needle = value.trim().toLowerCase();
  const filtered = needle ? sorted.filter((p) => p.name.toLowerCase().includes(needle)) : sorted;
  const show = open && filtered.length > 0;

  const openAt = () => { setRect(inputRef.current?.getBoundingClientRect() ?? null); setOpen(true); };

  return (
    <span style={{ display: "inline-flex", flex: 1, minWidth: 0, ...style }}>
      <input
        ref={inputRef}
        className={className}
        style={{ width: "100%" }}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); openAt(); }}
        onFocus={openAt}
        // El timeout deja que el click en una opción del menú (onMouseDown la previene, pero por
        // si acaso) alcance a dispararse antes de que el blur cierre el dropdown.
        onBlur={(e) => { setTimeout(() => setOpen(false), 150); onBlur?.(e); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); onKeyDown?.(e); }}
      />
      {show && rect && (
        <div className="menu scroll" style={{ ...popStyle(rect), overflowY: "auto", padding: 4 }}>
          {filtered.map((p) => (
            <button key={p.id} type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setOpen(false); }}>
              <span className="grow truncate">{p.name}</span>
              {!personal && <span className="mono t-xs muted">${formatMoney(p.price)}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
