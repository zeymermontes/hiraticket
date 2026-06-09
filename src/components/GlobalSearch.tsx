"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import { globalSearch, type SearchResults } from "@/app/(app)/search-actions";

const STATUS: Record<string, { color: PillColor; es: string; en: string }> = {
  open: { color: "blue", es: "Abierto", en: "Open" },
  pending: { color: "amber", es: "Pendiente", en: "Pending" },
  resolved: { color: "green", es: "Resuelto", en: "Resolved" },
};

type Flat =
  | { kind: "chat"; data: SearchResults["chats"][number] }
  | { kind: "order"; data: SearchResults["orders"][number] }
  | { kind: "customer"; data: SearchResults["customers"][number] };

/** Highlight every case-insensitive occurrence of `q` inside `text`. */
function hl(text: string, q: string): React.ReactNode {
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) { out.push(text.slice(i)); break; }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark key={k++}>{text.slice(idx, idx + needle.length)}</mark>);
    i = idx + needle.length;
  }
  return out;
}

export function GlobalSearch({ businessId }: { businessId: string }) {
  const { lang } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SearchResults>({ chats: [], orders: [], customers: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // Debounced search; ignore out-of-order responses.
  useEffect(() => {
    const term = q.trim();
    setActive(0);
    if (!term) { setRes({ chats: [], orders: [], customers: [] }); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const r = await globalSearch(businessId, term);
      if (id === reqId.current) { setRes(r); setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, businessId]);

  // ⌘K / Ctrl+K to focus + open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flat = useMemo<Flat[]>(() => [
    ...res.chats.map((d) => ({ kind: "chat", data: d } as Flat)),
    ...res.orders.map((d) => ({ kind: "order", data: d } as Flat)),
    ...res.customers.map((d) => ({ kind: "customer", data: d } as Flat)),
  ], [res]);

  function go(f: Flat) {
    setOpen(false);
    setQ("");
    if (f.kind === "chat") router.push(`/chat?c=${f.data.id}`);
    else if (f.kind === "order") router.push(`/orders?order=${f.data.id}`);
    else if (f.data.conversationId) router.push(`/chat?c=${f.data.conversationId}`);
    else router.push(`/orders?new=1&contact=${encodeURIComponent(f.data.name)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); return; }
    if (!flat.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) go(flat[active]); }
  }

  const showPanel = open && q.trim().length > 0;
  let idx = -1; // running index across groups for active highlighting

  const row = (f: Flat, icon: React.ReactNode, title: React.ReactNode, sub: React.ReactNode, pill: React.ReactNode) => {
    idx++;
    const i = idx;
    return (
      <button key={f.kind + (f.data as { id: string }).id} className={"gs-row" + (i === active ? " on" : "")}
        onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(f); }}>
        <span className="gs-ic">{icon}</span>
        <span className="gs-text">
          <span className="gs-title truncate">{title}</span>
          <span className="gs-sub truncate">{sub}</span>
        </span>
        {pill}
      </button>
    );
  };

  return (
    <div className="gsearch">
      <div className="field field-sm" style={{ width: 280 }}>
        <Icon name="search" />
        <input ref={inputRef} value={q} placeholder={lang === "es" ? "Buscar chats, pedidos, clientes…" : "Search chats, orders, customers…"}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown} />
        <kbd className="gs-kbd">⌘K</kbd>
      </div>

      {showPanel && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div className="gs-panel scroll" onMouseDown={(e) => e.stopPropagation()}>
            {loading && flat.length === 0 && <div className="gs-empty">{lang === "es" ? "Buscando…" : "Searching…"}</div>}
            {!loading && flat.length === 0 && (
              <div className="gs-empty">
                <div style={{ fontWeight: 600 }}>{lang === "es" ? `Sin resultados para «${q}»` : `No results for “${q}”`}</div>
                <div className="t-xs muted" style={{ marginTop: 4 }}>{lang === "es" ? "Prueba con un nombre, teléfono o código de pedido." : "Try a name, phone or order code."}</div>
              </div>
            )}

            {res.chats.length > 0 && <div className="gs-group">{lang === "es" ? "Conversaciones" : "Conversations"}</div>}
            {res.chats.map((c) => row(
              { kind: "chat", data: c },
              <Avatar name={c.contactName} initials={deriveInitials(c.contactName || c.phone || "?")} color={avatarColor(c.phone)} size={34} />,
              hl(c.contactName, q),
              hl(c.preview || c.phone, q),
              <Pill color={STATUS[c.status]?.color ?? "slate"} dot>{STATUS[c.status]?.[lang] ?? c.status}</Pill>,
            ))}

            {res.orders.length > 0 && <div className="gs-group">{lang === "es" ? "Pedidos" : "Orders"}</div>}
            {res.orders.map((o) => row(
              { kind: "order", data: o },
              <span className="gs-ic-sq"><Icon name="orders" size={16} /></span>,
              <><span className="mono">{hl(o.code, q)}</span> · {hl(o.customerName, q)}</>,
              hl(o.itemSummary, q),
              o.status ? <Pill color={o.color as PillColor} dot>{o.status}</Pill> : null,
            ))}

            {res.customers.length > 0 && <div className="gs-group">{lang === "es" ? "Clientes" : "Customers"}</div>}
            {res.customers.map((c) => row(
              { kind: "customer", data: c },
              <Avatar name={c.name} initials={deriveInitials(c.name || c.phone || "?")} color={avatarColor(c.phone)} size={34} />,
              hl(c.name, q),
              hl(c.phone || c.tags.join(", "), q),
              c.tags[0] ? <Pill color="brand"><Icon name="tag" size={10} />{c.tags.length}</Pill> : null,
            ))}

            {flat.length > 0 && (
              <div className="gs-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> {lang === "es" ? "navegar" : "navigate"}</span>
                <span><kbd>↵</kbd> {lang === "es" ? "abrir" : "open"}</span>
                <span><kbd>esc</kbd> {lang === "es" ? "cerrar" : "close"}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
