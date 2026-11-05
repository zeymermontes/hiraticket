import React from "react";

// Formato de texto de WhatsApp: lo que el cliente escribe como *negritas*, _itálicas_,
// ~tachado~, `código`, ```bloque```, "> cita" o "- lista" WhatsApp lo pinta con formato. Antes
// aquí se veían los asteriscos y guiones tal cual, así que un mensaje recibido se leía distinto en
// Hiraticket que en el teléfono, y al escribir no había forma de saber cómo iba a llegar.
//
// Lo usan los dos chats (clientes y equipo) para pintar las burbujas y para la vista previa del
// compositor. Cada chat sigue pintando a su manera lo que NO es formato —ligas, menciones— a
// través de `leaf`: esta capa solo envuelve.
//
// Reglas, las de WhatsApp:
//   · El marcador de apertura va pegado a una letra y no lo precede otra letra o número: «2*3*4» y
//     «nombre_de_archivo» se quedan como están.
//   · No cruza saltos de línea.
//   · Dentro de código no hay formato.
//   · Una liga nunca se toca: «https://x.com/a_b_c» no se vuelve itálica.

type Leaf = (text: string, key: string) => React.ReactNode;

const URL_RE = /https?:\/\/[^\s]+/g;
// Las ligas se apartan antes de buscar formato y se devuelven al pintar. Se marcan con caracteres
// de uso privado, que no aparecen en un mensaje real.
const P0 = "", P1 = "";
const HOLE = new RegExp(`${P0}(\\d+)${P1}`, "g");

const MARKS: { ch: string; tag: "strong" | "em" | "s" }[] = [
  { ch: "*", tag: "strong" },
  { ch: "_", tag: "em" },
  { ch: "~", tag: "s" },
];
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARK_RE = MARKS.map((m) => {
  const c = esc(m.ch);
  // (inicio o algo que no sea letra/número/el propio marcador) MARCA texto-sin-espacios-en-los-bordes MARCA (no seguido de letra/número)
  return { ...m, re: new RegExp(`(^|[^\\p{L}\\p{N}${c}])${c}(?=[^\\s${c}])([^\\n]*?[^\\s${c}])${c}(?![\\p{L}\\p{N}])`, "u") };
});
const CODE_RE = /`([^`\n]+)`/;

const codeStyle: React.CSSProperties = { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", fontSize: "0.92em", background: "rgba(127,127,127,0.16)", borderRadius: 4, padding: "0 4px" };
const blockStyle: React.CSSProperties = { ...codeStyle, display: "block", padding: "6px 8px", margin: "2px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" };
const quoteStyle: React.CSSProperties = { display: "block", borderLeft: "3px solid rgba(127,127,127,0.55)", paddingLeft: 8, opacity: 0.9 };

/** Formato dentro de una línea. `restore` devuelve las ligas apartadas antes de pintar. */
function inline(text: string, leaf: Leaf, restore: (s: string) => string, key: string): React.ReactNode[] {
  let best: { start: number; end: number; inner: string; tag: "strong" | "em" | "s" | "code" } | null = null;
  const code = CODE_RE.exec(text);
  if (code) best = { start: code.index, end: code.index + code[0].length, inner: code[1], tag: "code" };
  for (const m of MARK_RE) {
    const hit = m.re.exec(text);
    if (!hit) continue;
    const start = hit.index + hit[1].length;
    if (!best || start < best.start) best = { start, end: hit.index + hit[0].length, inner: hit[2], tag: m.tag };
  }
  if (!best) return text ? [leaf(restore(text), key)] : [];
  const out: React.ReactNode[] = [];
  if (best.start > 0) out.push(leaf(restore(text.slice(0, best.start)), `${key}a`));
  out.push(best.tag === "code"
    ? <code key={`${key}c`} style={codeStyle}>{restore(best.inner)}</code>
    : React.createElement(best.tag, { key: `${key}m` }, inline(best.inner, leaf, restore, `${key}i`)));
  out.push(...inline(text.slice(best.end), leaf, restore, `${key}z`));
  return out;
}

/**
 * Texto con el formato de WhatsApp aplicado. `leaf` pinta los tramos sin formato (ahí cada chat
 * convierte sus ligas y menciones); si no se pasa, se pinta el texto tal cual.
 * El contenedor debe conservar los saltos de línea (`white-space: pre-wrap`), como ya hacen las burbujas.
 */
export function formatWa(text: string, leaf: Leaf = (s, k) => <React.Fragment key={k}>{s}</React.Fragment>): React.ReactNode {
  if (!text) return text;
  // Sin ningún marcador no hay nada que hacer: el caso de casi todos los mensajes.
  if (!/[*_~`>]|^\s*[-*] /m.test(text)) return leaf(text, "t");

  const urls: string[] = [];
  const held = text.replace(URL_RE, (u) => { urls.push(u); return `${P0}${urls.length - 1}${P1}`; });
  const restore = (s: string) => s.replace(HOLE, (_, i) => urls[Number(i)] ?? "");

  const out: React.ReactNode[] = [];
  // ```bloques``` primero: adentro no se interpreta nada.
  held.split(/```([\s\S]*?)```/).forEach((part, i) => {
    if (i % 2 === 1) { out.push(<code key={`b${i}`} style={blockStyle}>{restore(part.replace(/^\n|\n$/g, ""))}</code>); return; }
    if (!part) return;
    const lines = part.split("\n");
    lines.forEach((line, j) => {
      const key = `p${i}l${j}`;
      const quote = /^> (.*)$/.exec(line);
      const bullet = /^(\s*)[-*] +(.*)$/.exec(line);
      if (quote) out.push(<span key={key} style={quoteStyle}>{inline(quote[1], leaf, restore, key)}</span>);
      else if (bullet) out.push(<React.Fragment key={key}>{bullet[1]}• {inline(bullet[2], leaf, restore, key)}</React.Fragment>);
      else out.push(<React.Fragment key={key}>{inline(line, leaf, restore, key)}</React.Fragment>);
      // Una cita es un bloque: ya termina su renglón sola.
      if (j < lines.length - 1 && !quote) out.push("\n");
    });
  });
  return out;
}

/**
 * El mismo texto sin los marcadores, para donde solo cabe una línea de texto plano: la vista previa
 * en la lista de chats o la cita de una respuesta. Ahí «*Hola*, _necesito_» se leía con los
 * asteriscos y guiones a la vista. Solo se quitan los que WhatsApp tomaría como formato.
 */
export function plainWa(text: string | null | undefined): string {
  if (!text || !/[*_~`>-]/.test(text)) return text ?? "";
  const urls: string[] = [];
  let t = text.replace(URL_RE, (u) => { urls.push(u); return `${P0}${urls.length - 1}${P1}`; });
  t = t.replace(/```([\s\S]*?)```/g, (_, inner: string) => inner.trim()).replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^> /gm, "").replace(/^(\s*)[-*] +/gm, "$1• ");
  // Los marcadores se anidan (*negrita con _itálica_*): se repite hasta que no quede ninguno.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const m of MARK_RE) {
      const g = new RegExp(m.re.source, "gu");
      const next = t.replace(g, "$1$2");
      if (next !== t) { t = next; changed = true; }
    }
    if (!changed) break;
  }
  return t.replace(HOLE, (_, i) => urls[Number(i)] ?? "");
}

/** ¿El texto trae algo que WhatsApp va a pintar con formato? Decide si vale la pena la vista previa. */
export function hasWaFormat(text: string): boolean {
  if (!text || !/[*_~`>-]/.test(text)) return false;
  const held = text.replace(URL_RE, "x");
  if (/```[\s\S]*?```/.test(held) || CODE_RE.test(held)) return true;
  if (/^> \S/m.test(held) || /^\s*[-*] +\S/m.test(held)) return true;
  return MARK_RE.some((m) => m.re.test(held));
}

/**
 * Vista previa de cómo se verá el mensaje que se está escribiendo. Solo aparece cuando el borrador
 * trae formato: un mensaje normal no necesita que le digan cómo se va a ver.
 */
export function WaFormatPreview({ text, lang }: { text: string; lang: "es" | "en" }) {
  if (!hasWaFormat(text)) return null;
  return (
    <div className="col gap-1" style={{ padding: "6px 10px", margin: "0 0 6px", borderRadius: 10, background: "var(--surface-2)", border: "1px dashed var(--border)" }}>
      <span className="t-xs muted" style={{ fontWeight: 600 }}>{lang === "es" ? "Así se verá" : "How it will look"}</span>
      <div className="t-sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto" }}>{formatWa(text)}</div>
    </div>
  );
}
