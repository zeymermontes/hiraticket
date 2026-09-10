"use client";
import { Icon } from "@/components/Icon";

/**
 * La cita de un mensaje —- el bloque "en respuesta a" que va arriba de la burbuja y la vista
 * previa sobre el compositor. Es el MISMO componente para el chat de clientes y el de equipo.
 *
 * Antes la cita era una línea de texto: para una imagen decía "📎 image" y para un PDF a veces
 * el nombre y a veces nada. Como en WhatsApp, ahora lleva quién lo mandó, el texto o pie (o qué
 * tipo de archivo es), y a la derecha la miniatura si es foto/video/sticker o el ícono si es
 * documento. Con eso se entiende A QUÉ le están contestando sin tener que ir a buscarlo.
 */

/** Lo mínimo que hace falta para pintar una cita, sea de la tabla que sea. */
export interface QuoteSource {
  type: string;
  body: string | null;
  media_url?: string | null;
  media_mime?: string | null;
  media_name?: string | null;
  deleted?: boolean;
  meta?: Record<string, unknown> | null;
}

/** Copia de la cita que dejó el worker en `meta.quote` cuando el original no existe en la base
 *  (se mandó antes de conectar el número, o es de otro chat). Solo para pintarla: no hay a dónde
 *  saltar. Ver `quoteOf` / `withMetaKeyJSON` en el worker. */
export interface MetaQuote {
  type: string;
  text?: string;
  name?: string;
  mime?: string;
  thumb?: string;
  /** true = lo mandó el negocio (la respuesta es a algo nuestro). */
  mine?: boolean;
}
export function metaQuoteOf(m: { meta?: Record<string, unknown> | null }): MetaQuote | null {
  const q = (m.meta as { quote?: MetaQuote } | null | undefined)?.quote;
  return q && typeof q === "object" && typeof q.type === "string" ? q : null;
}

const isMedia = (t: string) => t === "image" || t === "video" || t === "sticker" || t === "audio" || t === "document";

/** Qué dice la cita: el texto o pie si lo hay; si no, qué es (con su emoji, como en WhatsApp). */
export function quoteText(m: QuoteSource, lang: "es" | "en"): string {
  const es = lang === "es";
  if (m.deleted) return es ? "Mensaje eliminado" : "Message deleted";
  if (m.body && m.body.trim()) return m.body;
  switch (m.type) {
    case "image": return es ? "📷 Foto" : "📷 Photo";
    case "video": return es ? "🎥 Video" : "🎥 Video";
    case "audio": return es ? "🎤 Audio" : "🎤 Audio";
    case "sticker": return "🩷 Sticker";
    case "document": return "📄 " + (m.media_name || (es ? "Documento" : "Document"));
    case "location": return es ? "📍 Ubicación" : "📍 Location";
    case "contact": return es ? "👤 Contacto" : "👤 Contact";
    case "call": return es ? "📞 Llamada" : "📞 Call";
    default: return "";
  }
}

/** La miniatura de la cita: la que guardó el worker/el navegador (`meta.thumb`), y si no hay,
 *  para una foto o sticker la imagen misma (firmada). Un video sin miniatura no tiene nada que
 *  enseñar —- se queda con el "🎥 Video" del texto. */
export function quoteThumb(m: QuoteSource): string | null {
  if (m.deleted) return null;
  const t = (m.meta as { thumb?: string } | null | undefined)?.thumb;
  if (t) return t;
  if ((m.type === "image" || m.type === "sticker") && m.media_url) return m.media_url;
  return null;
}

export function QuoteCard({ who, source, lang, onClick, compact }: {
  /** Quién mandó el mensaje citado: "Tú", el agente, el cliente. */
  who: string | null;
  source: QuoteSource;
  lang: "es" | "en";
  /** Sin onClick no es un enlace: pasa cuando el original no está en la base y solo tenemos la copia. */
  onClick?: () => void;
  /** Sobre el compositor: una sola línea, sin margen abajo. */
  compact?: boolean;
}) {
  const text = quoteText(source, lang);
  const thumb = quoteThumb(source);
  const isDoc = source.type === "document" && !source.deleted;
  const clickable = !!onClick;
  return (
    <div
      className="row gap-2"
      role={clickable ? "button" : undefined}
      title={clickable ? (lang === "es" ? "Ir al mensaje" : "Go to message") : undefined}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      style={{
        alignItems: "stretch", borderLeft: "3px solid var(--brand)", borderRadius: 6, background: "rgba(0,0,0,.05)",
        padding: compact ? "3px 8px" : "4px 8px", marginBottom: compact ? 0 : 4, fontSize: 12, maxWidth: compact ? "100%" : 260,
        cursor: clickable ? "pointer" : "default", minWidth: 0, overflow: "hidden",
      }}
    >
      <span className="col grow" style={{ minWidth: 0, justifyContent: "center" }}>
        {who && <span className="truncate" style={{ fontWeight: 700, color: "var(--brand-700)", fontSize: 11.5 }}>{who}</span>}
        <span className="row gap-1 truncate" style={{ opacity: source.deleted ? 0.6 : 0.85, fontStyle: source.deleted ? "italic" : undefined, alignItems: "center" }}>
          {isDoc && <Icon name="file" size={12} />}
          <span className="truncate">{isDoc ? text.replace(/^📄 /, "") : text}</span>
        </span>
      </span>
      {thumb && isMedia(source.type) && (
        <span style={{ width: compact ? 30 : 44, height: compact ? 30 : 44, borderRadius: 5, overflow: "hidden", flex: "none", background: "rgba(0,0,0,.1)", alignSelf: "center" }}>
          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: source.type === "sticker" ? "contain" : "cover", display: "block" }} />
        </span>
      )}
    </div>
  );
}
