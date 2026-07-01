"use client";
import React, { useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/Icon";
import { formatMoney } from "@/lib/types";
import type { Product } from "@/lib/extras";

/** Anchor the popover to the trigger: open just below it (so the search box sits right under the
 *  icon), flipping above only when there's genuinely no room below. Clamped into the viewport. */
function popStyle(rect: DOMRect): CSSProperties {
  const W = 264, m = 8, gap = 4;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let left = rect.right - W;                          // right-align to the trigger
  left = Math.min(Math.max(m, left), vw - W - m);
  const below = vh - rect.bottom - m;
  const above = rect.top - m;
  const base: CSSProperties = { position: "fixed", left, width: W, zIndex: 201 };
  if (below < 200 && above > below) return { ...base, bottom: vh - rect.top + gap, maxHeight: Math.min(340, above - gap) };
  return { ...base, top: rect.bottom + gap, maxHeight: Math.min(340, below - gap) };
}

/** Searchable, alphabetically-sorted catalog picker (replaces a plain <select> so it can be filtered).
 *  `compact` renders just the dropdown-arrow trigger (for a line-item row); otherwise a full-width
 *  "pick from catalog" button. */
export function CatalogPicker({ products, onPick, personal, lang, compact }: {
  products: Product[];
  onPick: (p: Product) => void;
  personal: boolean;
  lang: "es" | "en";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const sorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name, lang === "es" ? "es" : "en", { sensitivity: "base" })), [products, lang]);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? sorted.filter((p) => p.name.toLowerCase().includes(needle)) : sorted;

  const placeholder = personal ? (lang === "es" ? "Elegir tarea repetitiva" : "Pick recurring task") : (lang === "es" ? "Elegir del catálogo" : "Pick from catalog");
  const toggle = () => { if (!open) { setRect(btnRef.current?.getBoundingClientRect() ?? null); setQ(""); } setOpen((o) => !o); };
  const pick = (p: Product) => { onPick(p); setOpen(false); };
  const chevron = <span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><Icon name="arrowr" size={compact ? 13 : 14} /></span>;

  return (
    <span style={{ display: "inline-flex", flex: compact ? "none" : "1 1 auto", minWidth: 0 }}>
      <button ref={btnRef} type="button" onClick={toggle} title={placeholder}
        className={compact ? "iconbtn sm" : "select"}
        style={compact ? { width: 34, flex: "none", justifyContent: "center" } : { width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
        {compact ? chevron : <><Icon name="store" size={14} /><span className="grow truncate">{placeholder}</span>{chevron}</>}
      </button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ ...popStyle(rect), overflowY: "hidden", padding: 6, display: "flex", flexDirection: "column" }}>
            <div className="field field-sm field-filled" style={{ marginBottom: 4, flex: "none" }}>
              <Icon name="search" size={14} />
              <input autoFocus placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="scroll" style={{ overflowY: "auto", minHeight: 0 }}>
              {filtered.length === 0
                ? <div className="muted t-sm" style={{ padding: 8 }}>{lang === "es" ? "Sin resultados" : "No results"}</div>
                : filtered.map((p) => (
                    <button key={p.id} type="button" className="menu-item" onClick={() => pick(p)}>
                      <span className="grow truncate">{p.name}</span>
                      {!personal && <span className="mono t-xs muted">${formatMoney(p.price)}</span>}
                    </button>
                  ))}
            </div>
          </div>
        </>
      )}
    </span>
  );
}
