"use client";
import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { menuStyle } from "@/lib/popover";
import { useApp } from "@/components/AppContext";
import { tagColor } from "@/lib/types";
import { deleteTagFromCatalog } from "@/app/(app)/business/actions";

interface CatalogTag { id: string; name: string }

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
  const [all, setAll] = useState<CatalogTag[]>([]);
  const [q, setQ] = useState("");

  const load = () => {
    const supabase = createClient();
    // Del catálogo (0073), no de escanear contacts.tags: esa consulta no tenía límite explícito, así
    // que en un negocio con muchos contactos el tope por defecto de PostgREST la truncaba —- se veía
    // como "solo salen las etiquetas recientes". El catálogo es chico y no tiene ese problema.
    supabase.from("tags").select("id, name").eq("business_id", businessId).then(({ data }) => {
      // Alfabético sin distinguir mayúsculas: el orden de la base depende de su collation, y
      // "Zapatos" antes que "árbol" por ir en mayúscula no es lo que alguien espera de "alfabético".
      setAll(((data ?? []) as CatalogTag[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
    });
  };
  useEffect(load, [businessId]);

  const cur = new Set(current);
  const needle = q.trim().toLowerCase();
  const suggestions = all.filter((t) => !cur.has(t.name) && t.name.toLowerCase().includes(needle));
  const exists = all.some((t) => t.name.toLowerCase() === needle) || cur.has(q.trim());
  const choose = (t: string) => { if (t.trim()) { onPick(t.trim()); onClose(); } };
  // Quita del CATÁLOGO, no del contacto actual —- es una acción distinta de onRemove (que sí
  // quita la etiqueta puesta aquí). El popover se queda abierto: es de esperar seguir borrando
  // más de una seguida sin tener que reabrir el selector cada vez.
  const removeFromCatalog = (t: CatalogTag) => { setAll((a) => a.filter((x) => x.id !== t.id)); deleteTagFromCatalog(t.id); };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={onClose} />
      <div className="menu" style={{ ...menuStyle(rect, { width: 240, height: 320, gap: 6 }), maxHeight: 320, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
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
            <div className="menu-item" key={t.id} style={{ justifyContent: "space-between" }}>
              <span role="button" tabIndex={0} onClick={() => choose(t.name)} onKeyDown={(e) => { if (e.key === "Enter") choose(t.name); }} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer" }}>
                <Pill color={tagColor(t.name)}><Icon name="tag" size={11} />{t.name}</Pill>
              </span>
              <button onClick={(e) => { e.stopPropagation(); removeFromCatalog(t); }} aria-label="remove from catalog" title={lang === "es" ? "Quitar del catálogo" : "Remove from catalog"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, border: "none", background: "transparent", color: "currentColor", opacity: 0.5, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          {suggestions.length === 0 && !q.trim() && <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Sin etiquetas todavía. Escribe una para crearla." : "No tags yet. Type one to create it."}</div>}
        </div>
      </div>
    </>
  );
}
