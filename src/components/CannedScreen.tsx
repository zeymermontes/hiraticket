"use client";
import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Lang } from "@/lib/i18n";
import type { CannedMessage } from "@/lib/canned";
import { createCanned, updateCanned, deleteCanned } from "@/app/(app)/canned/actions";

const VARIABLES: { key: string; es: string; en: string }[] = [
  { key: "name", es: "Nombre del cliente", en: "Customer name" },
  { key: "order_number", es: "Número de pedido", en: "Order number" },
  { key: "total", es: "Total", en: "Total" },
  { key: "phone", es: "Teléfono", en: "Phone" },
  { key: "agent", es: "Agente", en: "Agent" },
  { key: "business", es: "Negocio", en: "Business" },
];

/** Textarea where typing "@" autocompletes {{variables}}. */
function VariableTextarea({
  value, onChange, onCommit, placeholder, rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  rows?: number;
}) {
  const { lang } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ q: string; at: number } | null>(null);
  const [sel, setSel] = useState(0);

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (m) { setMenu({ q: m[1], at: caret - m[1].length - 1 }); setSel(0); }
    else setMenu(null);
  }

  const filtered = menu
    ? VARIABLES.filter((va) => {
        const q = menu.q.toLowerCase();
        return va.key.includes(q) || va[lang as Lang].toLowerCase().includes(q);
      })
    : [];

  function insert(key: string) {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart;
    const before = value.slice(0, menu.at);
    const after = value.slice(caret);
    const text = `{{${key}}}`;
    onChange(before + text + after);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + text).length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={ref}
        className="inp-inline"
        style={{ width: "100%", height: "auto", padding: 8 }}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (menu && filtered.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(filtered[sel].key); }
            else if (e.key === "Escape") { setMenu(null); }
          }
        }}
        onBlur={() => { setTimeout(() => setMenu(null), 150); onCommit?.(); }}
      />
      {menu && filtered.length > 0 && (
        <div className="menu scroll" style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, width: 280, maxHeight: 240, zIndex: 60 }}>
          <div className="menu-label">{lang === "es" ? "Variables (@)" : "Variables (@)"}</div>
          {filtered.map((va, i) => (
            <button type="button" key={va.key} className={"menu-item" + (i === sel ? " on" : "")}
              style={i === sel ? { background: "var(--surface-2)" } : undefined}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); insert(va.key); }}>
              <span className="mono" style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 7px", borderRadius: 6, background: "var(--brand-50)", color: "var(--brand-700)", border: "1px solid var(--brand-300)", fontSize: 11.5, fontWeight: 600 }}>{`{{${va.key}}}`}</span>
              <span className="t-xs muted">{va[lang as Lang]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CannedRow({ item }: { item: CannedMessage }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [body, setBody] = useState(item.body);

  function commit() {
    if (body !== item.body) start(async () => { await updateCanned(item.id, { body }); router.refresh(); });
  }
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
      <div className="row gap-2">
        <strong>{item.title}</strong>
        {item.category && <Pill color="violet">{item.category}</Pill>}
        {item.shortcut && <span className="mono t-xs muted">{item.shortcut}</span>}
        <span className="grow" />
        <button className="iconbtn sm" onClick={() => start(async () => { await deleteCanned(item.id); router.refresh(); })}><Icon name="trash" size={15} /></button>
      </div>
      <div style={{ marginTop: 8 }}>
        <VariableTextarea value={body} onChange={setBody} onCommit={commit} rows={2} />
      </div>
    </div>
  );
}

export function CannedScreen({ businessId, items }: { businessId: string; items: CannedMessage[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("General");
  const [shortcut, setShortcut] = useState("");

  function add() {
    if (!title.trim() || !body.trim()) return;
    start(async () => {
      await createCanned(businessId, { title, body, category, shortcut });
      setTitle(""); setBody(""); setShortcut("");
      router.refresh();
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Plantillas" : "Templates"}</h1>
        <Pill color="slate" large>{items.length}</Pill>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="canned" size={16} /><h4>{lang === "es" ? "Mensajes guardados" : "Saved messages"}</h4></div>
          <div className="ws-block-body col gap-2">
            {items.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin plantillas." : "No templates."}</div>}
            {items.map((c) => <CannedRow key={c.id} item={c} />)}
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nueva plantilla" : "New template"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Título" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Categoría" : "Category"} value={category} onChange={(e) => setCategory(e.target.value)} />
              <input className="inp-inline" style={{ width: 100 }} placeholder="/atajo" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
            </div>
            <VariableTextarea value={body} onChange={setBody} rows={4}
              placeholder={lang === "es" ? "Cuerpo… escribe @ para insertar variables" : "Body… type @ to insert variables"} />
            <div className="t-xs muted">{lang === "es" ? "Escribe @ para insertar variables como {{name}}." : "Type @ to insert variables like {{name}}."}</div>
            <button className="btn btn-primary btn-block" disabled={pending || !title.trim() || !body.trim()} onClick={add}><Icon name="plus" size={15} />{lang === "es" ? "Crear" : "Create"}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
