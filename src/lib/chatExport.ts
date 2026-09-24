"use client";
import { zip, downloadBlob } from "@/lib/zip";

/**
 * Exportar un tramo de chat para dárselo a una IA (o a quien sea) como contexto.
 *
 * Un mensaje del chat de clientes y uno del chat de equipo no tienen la misma forma, así que cada
 * chat los traduce primero a este `ExportMsg` neutro y el resto (transcripción, bajada de archivos,
 * zip) es común. La salida es un `chat.md` legible por humanos y por modelos —- una línea por
 * mensaje, con fecha, remitente y texto —- y, si se pide, una carpeta `media/` con los adjuntos
 * referenciados desde el texto por su ruta.
 */
export interface ExportMsg {
  id: string;
  ts: string;                 // ISO
  who: string;                // nombre a mostrar del remitente
  mine: boolean;              // salió de este lado (agente / yo)
  type: string;               // text | image | video | audio | document | sticker | location | contact | call
  body: string | null;
  media: { url: string; mime: string | null; name: string | null; size: number | null } | null;
  /** Adjunto que ya no se puede bajar (purgado, pendiente, con error): se anota en el texto. */
  mediaNote: string | null;
  quoted: { who: string | null; text: string } | null;
  deleted: boolean;
  edited: boolean;
  forwarded: boolean;
  reactions: string[];
  /** Texto extra para tipos sin archivo (ubicación, contacto, llamada). */
  extra: string | null;
}

export interface ExportOpts {
  lang: "es" | "en";
  title: string;                                  // "Chat con Juan Pérez"
  header: { label: string; value: string }[];     // líneas de contexto (cliente, teléfono…)
  msgs: ExportMsg[];
  includeMedia: boolean;
  fileBase: string;                               // nombre del archivo sin extensión
  onProgress?: (done: number, total: number) => void;
}

export interface ExportResult { messages: number; files: number; failed: number; zipped: boolean }

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stamp = (d: Date) => `${dayKey(d)} ${clock(d)}`;

/** Nombre de archivo seguro y con extensión, para la carpeta media/. */
function safeFileName(idx: number, m: ExportMsg): string {
  const mime = m.media?.mime ?? "";
  const extFromMime = mime.split("/").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
  let name = (m.media?.name ?? "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ");
  if (!name) name = `${m.type || "archivo"}${extFromMime ? "." + (extFromMime === "jpeg" ? "jpg" : extFromMime) : ""}`;
  if (!/\.[a-z0-9]{1,5}$/i.test(name) && extFromMime) name += "." + (extFromMime === "jpeg" ? "jpg" : extFromMime);
  if (name.length > 70) { const dot = name.lastIndexOf("."); const ext = dot > 0 ? name.slice(dot) : ""; name = name.slice(0, 70 - ext.length) + ext; }
  return `${String(idx).padStart(4, "0")}_${name}`;
}

function typeLabel(t: string, lang: "es" | "en"): string {
  const es = lang === "es";
  switch (t) {
    case "image": return es ? "imagen" : "image";
    case "video": return "video";
    case "audio": return "audio";
    case "sticker": return "sticker";
    case "document": return es ? "documento" : "document";
    default: return es ? "archivo" : "file";
  }
}

/** La transcripción en Markdown. `mediaNames` mapea id de mensaje → ruta dentro del zip. */
export function buildTranscript(opts: ExportOpts, mediaNames: Map<string, string>, failed: Set<string>): string {
  const es = opts.lang === "es";
  const L: string[] = [];
  L.push(`# ${opts.title}`, "");
  for (const h of opts.header) L.push(`- ${h.label}: ${h.value}`);
  if (opts.msgs.length) {
    const first = new Date(opts.msgs[0].ts), last = new Date(opts.msgs[opts.msgs.length - 1].ts);
    L.push(`- ${es ? "Rango" : "Range"}: ${stamp(first)} → ${stamp(last)}`);
  }
  L.push(`- ${es ? "Mensajes" : "Messages"}: ${opts.msgs.length}`);
  L.push(`- ${es ? "Exportado" : "Exported"}: ${stamp(new Date())}`);
  L.push("");
  L.push(es
    ? "Formato: `[hora] remitente: texto`. Los adjuntos van en la carpeta `media/` y se citan por su ruta. Las horas son locales de quien exportó."
    : "Format: `[time] sender: text`. Attachments live in the `media/` folder and are referenced by path. Times are local to the exporter.");
  L.push("");

  let day = "";
  for (const m of opts.msgs) {
    const d = new Date(m.ts);
    const k = dayKey(d);
    if (k !== day) { day = k; L.push(`## ${k}`, ""); }
    const tags: string[] = [];
    if (m.forwarded) tags.push(es ? "reenviado" : "forwarded");
    if (m.edited) tags.push(es ? "editado" : "edited");
    const head = `[${clock(d)}] ${m.who}${tags.length ? ` (${tags.join(", ")})` : ""}:`;

    if (m.deleted) { L.push(`${head} _${es ? "mensaje eliminado" : "message deleted"}_`); L.push(""); continue; }

    const parts: string[] = [];
    if (m.quoted) parts.push(`> ${es ? "En respuesta a" : "Replying to"} ${m.quoted.who ?? (es ? "un mensaje" : "a message")}: "${m.quoted.text.replace(/\s+/g, " ").slice(0, 200)}"`);
    const file = mediaNames.get(m.id);
    if (file) parts.push(`📎 [${typeLabel(m.type, opts.lang)}](${file})${m.media?.name ? ` — ${m.media.name}` : ""}`);
    else if (m.media && failed.has(m.id)) parts.push(`📎 ${typeLabel(m.type, opts.lang)}${m.media.name ? ` "${m.media.name}"` : ""} (${es ? "no se pudo descargar" : "could not be downloaded"})`);
    else if (m.media && !opts.includeMedia) parts.push(`📎 ${typeLabel(m.type, opts.lang)}${m.media.name ? ` "${m.media.name}"` : ""} (${es ? "no incluido" : "not included"})`);
    else if (m.mediaNote) parts.push(`📎 ${m.mediaNote}`);
    if (m.extra) parts.push(m.extra);
    if (m.body && m.body.trim()) parts.push(m.body.trim());
    if (m.reactions.length) parts.push(`${es ? "Reacciones" : "Reactions"}: ${m.reactions.join(" ")}`);

    if (!parts.length) { L.push(`${head} _(${es ? "sin contenido" : "no content"})_`); L.push(""); continue; }
    // El texto puede tener varias líneas: la primera va junto al encabezado y el resto sangrado
    // para que se lea que sigue siendo el mismo mensaje.
    const body = parts.join("\n").split("\n");
    L.push(`${head} ${body[0]}`);
    for (const extra of body.slice(1)) L.push(`    ${extra}`);
    L.push("");
  }
  return L.join("\n");
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`media ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Baja los adjuntos (de 3 en 3), arma la transcripción y dispara la descarga: un .zip si lleva
 *  archivos, o el .md suelto si no. */
export async function exportChat(opts: ExportOpts): Promise<ExportResult> {
  const withMedia = opts.includeMedia ? opts.msgs.filter((m) => m.media && !m.deleted) : [];
  const mediaNames = new Map<string, string>();
  const failed = new Set<string>();
  const files: { name: string; data: Uint8Array }[] = [];
  let done = 0;
  opts.onProgress?.(0, withMedia.length);

  // Nombres por adelantado (numerados en orden cronológico) para que la transcripción los cite
  // aunque la bajada vaya en paralelo.
  const planned = withMedia.map((m, i) => ({ m, name: `media/${safeFileName(i + 1, m)}` }));
  let cursor = 0;
  const worker = async () => {
    while (cursor < planned.length) {
      const { m, name } = planned[cursor++];
      try {
        files.push({ name, data: await fetchBytes(m.media!.url) });
        mediaNames.set(m.id, name);
      } catch { failed.add(m.id); }
      done++;
      opts.onProgress?.(done, withMedia.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, planned.length) }, worker));
  // Orden estable dentro del zip (el paralelismo los mete desordenados).
  files.sort((a, b) => a.name.localeCompare(b.name));

  const md = buildTranscript(opts, mediaNames, failed);
  const enc = new TextEncoder();
  const base = opts.fileBase.replace(/[\\/:*?"<>|]/g, "_").trim() || "chat";
  if (files.length) {
    downloadBlob(zip([{ name: "chat.md", data: enc.encode(md) }, ...files]), `${base}.zip`);
    return { messages: opts.msgs.length, files: files.length, failed: failed.size, zipped: true };
  }
  downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
  return { messages: opts.msgs.length, files: 0, failed: failed.size, zipped: false };
}

/** Nombre base del archivo: `chat-juan-perez-20260924`. */
export function exportFileBase(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "chat";
  const d = new Date();
  return `chat-${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
