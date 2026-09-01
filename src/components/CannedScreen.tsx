"use client";
import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Lang } from "@/lib/i18n";
import type { CannedMessage } from "@/lib/canned";
import { createCanned, updateCanned, deleteCanned } from "@/app/(app)/canned/actions";
import { uploadMedia } from "@/lib/uploadMedia";

const VARIABLES: { key: string; es: string; en: string }[] = [
  { key: "name", es: "Nombre del cliente", en: "Customer name" },
  { key: "order_number", es: "Número de pedido", en: "Order number" },
  { key: "total", es: "Total", en: "Total" },
  { key: "phone", es: "Teléfono", en: "Phone" },
  { key: "agent", es: "Agente", en: "Agent" },
  { key: "business", es: "Negocio", en: "Business" },
];

const CATEGORIES: { key: string; es: string; en: string }[] = [
  { key: "greetings", es: "Saludos", en: "Greetings" },
  { key: "quote", es: "Cotización", en: "Quote" },
  { key: "shipping", es: "Envío", en: "Shipping" },
  { key: "payment", es: "Pago", en: "Payment" },
  { key: "closing", es: "Cierre", en: "Closing" },
  { key: "General", es: "General", en: "General" },
];
const catLabel = (k: string, lang: string) => CATEGORIES.find((c) => c.key === k)?.[lang as "es" | "en"] ?? k;

// In personal mode: drop the money variable + payment category, relabel order/customer wording.
function variablesFor(personal: boolean) {
  if (!personal) return VARIABLES;
  return VARIABLES.filter((v) => v.key !== "total").map((v) =>
    v.key === "order_number" ? { ...v, es: "Número de tarea", en: "Task number" }
      : v.key === "name" ? { ...v, es: "Nombre del contacto", en: "Contact name" } : v);
}
const categoriesFor = (personal: boolean) => (personal ? CATEGORIES.filter((c) => c.key !== "payment") : CATEGORIES);

/** Render a template body with {{vars}} highlighted as chips. */
function TemplatePreview({ body }: { body: string }) {
  const parts = body.split(/(\{\{\s*\w+\s*\}\})/g);
  return <>{parts.map((p, i) => /^\{\{/.test(p)
    ? <span key={i} className="mono" style={{ padding: "0 5px", borderRadius: 5, background: "var(--brand-50)", color: "var(--brand-700)", fontSize: 12, fontWeight: 600 }}>{p}</span>
    : <span key={i}>{p}</span>)}</>;
}

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
  const { lang, personal } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ q: string; at: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [sel, setSel] = useState(0);

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (m) {
      setMenu({ q: m[1], at: caret - m[1].length - 1 });
      setSel(0);
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 270), left: r.left, width: Math.min(320, Math.max(240, r.width)) });
      }
    } else setMenu(null);
  }

  const filtered = menu
    ? variablesFor(personal).filter((va) => {
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
      {menu && filtered.length > 0 && pos && (
        <div className="menu scroll" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: 250, zIndex: 1000 }}>
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

/** Las columnas del adjunto de una plantilla. Vacías = plantilla de solo texto. */
const NO_MEDIA = { media_url: null, media_mime: null, media_name: null, media_size: null, media_thumb: null };

/**
 * Sube el archivo de una plantilla y devuelve las columnas que lo describen.
 *
 * Va al mismo bucket que los adjuntos del chat pero a su propia carpeta, y se sube UNA vez: cada
 * envío reutiliza esta ruta en vez de volver a subir el archivo (ver 0090).
 */
async function uploadTemplateFile(businessId: string, file: File) {
  const up = await uploadMedia(businessId, "templates", file);
  return {
    media_url: up.path,
    media_mime: up.mime,
    media_name: up.name,
    media_size: up.size,
    media_thumb: up.thumb ?? null,
  };
}

/** El archivo de una plantilla: nombre, tipo y, si se puede quitar, la X. */
function FileChip({ name, mime, onRemove }: { name: string; mime?: string | null; onRemove?: () => void }) {
  return (
    <div className="row gap-2" style={{ alignItems: "center", padding: "6px 8px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)", minWidth: 0 }}>
      <Icon name="file" size={15} />
      <span className="truncate grow" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>{name}</span>
      {mime && <span className="t-xs muted" style={{ flex: "none" }}>{mime.split("/").pop()}</span>}
      {onRemove && <button className="iconbtn sm" onClick={onRemove}><Icon name="x" size={13} /></button>}
    </div>
  );
}

function CannedRow({ item, businessId }: { item: CannedMessage; businessId: string }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [body, setBody] = useState(item.body);
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  function commit() {
    if (body !== item.body) start(async () => { await updateCanned(item.id, { body }); router.refresh(); });
  }
  function attach(file: File) {
    setErr(null);
    start(async () => {
      try {
        await updateCanned(item.id, await uploadTemplateFile(businessId, file));
        router.refresh();
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    });
  }
  // Quitar el archivo de la plantilla NO lo borra de Storage: los mensajes que ya salieron apuntan
  // a esa misma ruta y se quedarían en blanco.
  function detach() { start(async () => { await updateCanned(item.id, NO_MEDIA); router.refresh(); }); }
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
      <div className="row gap-2">
        <strong>{item.title}</strong>
        {item.shortcut && <Pill color="slate"><span className="mono">{item.shortcut}</span></Pill>}
        <span className="grow" />
        <button className="iconbtn sm" onClick={() => start(async () => { await deleteCanned(item.id); router.refresh(); })}><Icon name="trash" size={15} /></button>
      </div>
      <div style={{ marginTop: 8 }}>
        <VariableTextarea value={body} onChange={setBody} onCommit={commit} rows={2} />
      </div>
      <div style={{ marginTop: 8 }}>
        <input ref={fileRef} type="file" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }} />
        {item.media_url
          ? <FileChip name={item.media_name || "Archivo"} mime={item.media_mime} onRemove={detach} />
          : <button className="btn btn-sm btn-outline" onClick={() => fileRef.current?.click()}><Icon name="paperclip" size={14} />{lang === "es" ? "Adjuntar archivo" : "Attach file"}</button>}
        {err && <div className="t-xs" style={{ color: "var(--red)", marginTop: 4 }}>{err}</div>}
      </div>
    </div>
  );
}

export function CannedScreen({ businessId, items }: { businessId: string; items: CannedMessage[] }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("General");
  const [shortcut, setShortcut] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  // Con archivo, el texto es opcional: una plantilla puede ser SOLO el archivo (la lista de precios,
  // el formulario) y entonces sale como adjunto sin pie.
  const canCreate = !!title.trim() && (!!body.trim() || !!file);

  function add() {
    if (!canCreate) return;
    setErr(null);
    start(async () => {
      try {
        const media = file ? await uploadTemplateFile(businessId, file) : {};
        await createCanned(businessId, { title, body, category, shortcut, ...media });
        setTitle(""); setBody(""); setShortcut(""); setFile(null);
        router.refresh();
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Plantillas" : "Templates"}</h1>
        <Pill color="slate" large>{items.length}</Pill>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
       <div className="page-grid" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <div className="col gap-3">
          {/* variables reference */}
          <section className="ws-block">
            <div className="ws-block-head"><Icon name="sparkles" size={16} /><h4 className="grow">{lang === "es" ? "Variables disponibles" : "Available variables"}</h4><span className="t-xs muted">{lang === "es" ? "se llenan solas al insertar" : "auto-filled on insert"}</span></div>
            <div className="ws-block-body row gap-2" style={{ flexWrap: "wrap" }}>
              {variablesFor(personal).map((v) => <span key={v.key} className="mono" title={v[lang]} style={{ padding: "3px 8px", borderRadius: 6, background: "var(--brand-50)", color: "var(--brand-700)", border: "1px solid var(--brand-300)", fontSize: 12, fontWeight: 600 }}>{`{{${v.key}}}`}</span>)}
            </div>
          </section>

          {/* saved, grouped by category */}
          {items.length === 0 && <section className="ws-block"><div className="ws-block-body"><div className="muted t-sm">{lang === "es" ? "Sin plantillas." : "No templates."}</div></div></section>}
          {[...new Set(items.map((i) => i.category || "General"))].map((cat) => (
            <section className="ws-block" key={cat}>
              <div className="ws-block-head"><Icon name="canned" size={16} /><h4 className="grow">{catLabel(cat, lang)}</h4><span className="badge badge-soft">{items.filter((i) => (i.category || "General") === cat).length}</span></div>
              <div className="ws-block-body col gap-2">
                {items.filter((i) => (i.category || "General") === cat).map((c) => <CannedRow key={c.id} item={c} businessId={businessId} />)}
              </div>
            </section>
          ))}
        </div>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nueva plantilla" : "New template"}</h4></div>
          <div className="ws-block-body col gap-2">
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Título" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} />
              <input className="inp-inline" style={{ width: 96 }} placeholder="/atajo" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
            </div>
            <select className="select" style={{ width: "100%" }} value={category} onChange={(e) => setCategory(e.target.value)}>
              {categoriesFor(personal).map((c) => <option key={c.key} value={c.key}>{c[lang]}</option>)}
            </select>
            <VariableTextarea value={body} onChange={setBody} rows={4}
              placeholder={lang === "es" ? "Cuerpo… escribe @ para insertar variables" : "Body… type @ to insert variables"} />
            <input ref={fileRef} type="file" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
            {file
              ? <FileChip name={file.name} mime={file.type} onRemove={() => setFile(null)} />
              : <button className="btn btn-sm btn-outline btn-block" onClick={() => fileRef.current?.click()}><Icon name="paperclip" size={14} />{lang === "es" ? "Adjuntar archivo (opcional)" : "Attach a file (optional)"}</button>}
            {body.trim() && (
              <div>
                <label className="lbl">{lang === "es" ? "Vista previa" : "Preview"}</label>
                <div style={{ padding: 10, borderRadius: 10, background: "var(--surface-2)", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}><TemplatePreview body={body} /></div>
              </div>
            )}
            {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
            <button className="btn btn-primary btn-block" disabled={pending || !canCreate} onClick={add}><Icon name="plus" size={15} />{lang === "es" ? "Crear" : "Create"}</button>
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}
