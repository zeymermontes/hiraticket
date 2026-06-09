"use client";
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { tagColor } from "@/lib/types";

/** Popover to pick an existing tag or create a new one (deterministic colors). */
export function TagPicker({
  businessId, current, rect, onPick, onRemove, onClose,
}: {
  businessId: string;
  current: string[];
  rect: DOMRect;
  onPick: (tag: string) => void;
  onRemove?: (tag: string) => void;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const [all, setAll] = useState<string[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.from("contacts").select("tags").eq("business_id", businessId).then(({ data }) => {
      const set = new Set<string>();
      (data ?? []).forEach((c) => ((c.tags as string[]) ?? []).forEach((t) => set.add(t)));
      setAll([...set].sort());
    });
  }, [businessId]);

  const cur = new Set(current);
  const needle = q.trim().toLowerCase();
  const suggestions = all.filter((t) => !cur.has(t) && t.toLowerCase().includes(needle));
  const exists = all.some((t) => t.toLowerCase() === needle) || cur.has(q.trim());
  const choose = (t: string) => { if (t.trim()) { onPick(t.trim()); onClose(); } };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={onClose} />
      <div className="menu" style={{ position: "fixed", top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 256), width: 240, maxHeight: 320, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", zIndex: 201 }}>
        <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
          <div className="field field-sm field-filled"><Icon name="tag" size={14} /><input autoFocus placeholder={lang === "es" ? "Buscar o crear…" : "Search or create…"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) choose(q); }} /></div>
          {onRemove && current.length > 0 && (
            <div className="row gap-1" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {current.map((t) => (
                <span key={t} style={{ display: "inline-flex", alignItems: "center" }}>
                  <Pill color={tagColor(t)}>{t}<button onClick={() => onRemove(t)} aria-label="remove" title={lang === "es" ? "Quitar" : "Remove"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, marginLeft: 4, padding: 0, border: "none", background: "transparent", color: "currentColor", opacity: 0.75, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}><Icon name="x" size={12} /></button></Pill>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="scroll" style={{ overflowY: "auto", padding: 4 }}>
          {q.trim() && !exists && (
            <button className="menu-item" onClick={() => choose(q)}><Icon name="plus" size={15} />{lang === "es" ? "Crear" : "Create"} <Pill color={tagColor(q.trim())}>{q.trim()}</Pill></button>
          )}
          {suggestions.map((t) => (
            <button className="menu-item" key={t} onClick={() => choose(t)}><Pill color={tagColor(t)}><Icon name="tag" size={11} />{t}</Pill></button>
          ))}
          {suggestions.length === 0 && !q.trim() && <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Sin etiquetas todavía. Escribe una para crearla." : "No tags yet. Type one to create it."}</div>}
        </div>
      </div>
    </>
  );
}
