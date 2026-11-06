"use client";
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { SatKey } from "@/lib/facturacion";
import { searchSatKeys } from "@/app/(app)/features-actions";

/**
 * Buscador de claves del SAT por nombre ("playera", "pieza"). El SAT publica miles de claves y nadie
 * se las sabe: se escribe lo que se vende y se elige de la lista. La consulta sale del servidor
 * (la llave de Facturación nunca llega al navegador), con una pausa para no preguntar en cada
 * tecla. La lista va en línea, debajo del campo, así no hay nada flotante que se salga o se tape.
 *
 * Lo usan el catálogo y la ventana de facturar un pedido.
 */
export function SatSearch({ businessId, kind, lang, onPick }: { businessId: string; kind: "productos" | "unidades"; lang: "es" | "en"; onPick: (k: SatKey) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SatKey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    const id = ++seq.current; // una respuesta vieja no pisa a la de lo último que se escribió
    if (text.length < 3) { setHits(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await searchSatKeys(businessId, kind, text).catch(() => [] as SatKey[]);
      if (seq.current === id) { setHits(r); setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, businessId, kind]);
  const es = lang === "es";
  return (
    <div className="col gap-1" style={{ maxWidth: 360 }}>
      <div className="field field-sm"><Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "productos" ? (es ? "Buscar clave por nombre: playera, lona…" : "Search key by name…") : (es ? "Buscar unidad: pieza, hora, metro…" : "Search unit: piece, hour…")} />
      </div>
      {q.trim().length >= 3 && (
        <div className="col scroll" style={{ maxHeight: 190, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
          {busy && !hits ? <span className="t-xs muted" style={{ padding: "8px 10px" }}>{es ? "Buscando…" : "Searching…"}</span>
            : !hits || hits.length === 0 ? <span className="t-xs muted" style={{ padding: "8px 10px" }}>{es ? "Sin resultados. Prueba con otra palabra." : "No results. Try another word."}</span>
            : hits.map((h) => (
              <button key={h.clave} type="button" className="row gap-2" onClick={() => { onPick(h); setQ(""); setHits(null); }}
                style={{ padding: "7px 10px", background: "none", border: "none", borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer", alignItems: "baseline", color: "var(--text)" }}>
                <span className="mono t-xs" style={{ fontWeight: 700, flex: "none" }}>{h.clave}</span>
                <span className="t-xs" style={{ minWidth: 0 }}>{h.nombre}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
