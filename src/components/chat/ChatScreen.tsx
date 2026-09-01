"use client";
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/useIsMobile";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Spinner";
import { WaTemplateModal } from "@/components/chat/WaTemplateModal";
import { Pill, Avatar, deriveInitials, avatarColor, PayDot } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Agent, ConvListItem, ConvDetail, ChatMessage, ConvQuery, ChatListCounts, StoryQuote } from "@/lib/chat";
// Desde @/lib/mediaLimits y NO desde @/lib/chat: chat.ts arrastra server-only/next/headers, y un
// import de VALOR desde este componente de cliente los metería en el bundle del navegador. El
// `import type` de arriba no lo hace porque se borra al compilar.
import { MAX_MEDIA_FETCH_BYTES } from "@/lib/mediaLimits";
import type { Area, Stage } from "@/lib/business";
import { CustomerOverlay } from "@/components/chat/CustomerOverlay";
import { OrderDrawer } from "@/components/OrderDrawer";
import { NewOrderModal } from "@/components/OrdersTable";
import type { Product } from "@/lib/extras";
import { loadOrderDetail } from "@/app/(app)/orders/actions";
import type { OrderDetail } from "@/lib/orders";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { MentionTextarea } from "@/components/MentionTextarea";
import { TagPicker } from "@/components/TagPicker";
import { ReorderList } from "@/components/ReorderList";
import { tagColor, payStatusLabel } from "@/lib/types";
import { TransferModal } from "@/components/TransferModal";
import {
  sendMessage, sendMediaMessage, editMessage, deleteMessage, setConvStatus, acceptConv, addConvNote, transferConv, setConvHidden, snoozeConv,
  requestMediaFetch, deleteConv, renameContact, requestContactInfo, markConvRead, addContactTag, removeContactTag, reactToMessage, retryMessage, forwardMessage, startConversation, sendSticker, saveStickerFavorite, removeStickerFavorite, emptyChatTrash, setConvMuted, bulkSetStatus, bulkAssign, bulkDeleteConvs, lockConvToMe, unlockConv,
} from "@/app/(app)/chat/actions";
import { menuStyle } from "@/lib/popover";
import { useConfirm, type ConfirmOpts } from "@/components/Confirm";
import { useFileDrop, DropOverlay } from "@/components/chat/fileDrop";
import { useToast, useFlowToast } from "@/components/Toast";
import { loadStickerTray } from "@/app/(app)/chat/live-actions";
import { liveListPage, liveChatCounts, liveMessages, liveConvHeader, liveDetail, loadOlderMessages } from "@/lib/chatLive";

const EMPTY_CHAT_COUNTS: ChatListCounts = { all: 0, active: 0, open: 0, pending: 0, resolved: 0, unread: 0, trash: 0, archived: 0, mine: 0, unassigned: 0 };
import { putMessages, getMeta, setMeta, searchLocal } from "@/lib/localCache";
import { useComposerFocus, focusComposer, enterSends } from "@/lib/composerFocus";
import { keepSubscribed } from "@/lib/realtime";
import { isBuildStale } from "@/lib/buildSkew";
import { clearNotificationsFor } from "@/lib/notify";
import { StickerCell } from "@/components/chat/StickerCell";
import { useCachedMedia, fetchWithProgress } from "@/lib/mediaCache";
import { mediaTypeOf } from "@/lib/mediaUpload";
import { uploadMedia } from "@/lib/uploadMedia";
import { CachedImg } from "@/components/chat/CachedImg";
import { dragOutProps, copyFile, copyLink, canCopyFile, downloadMedia } from "@/lib/mediaDrag";
import type { StickerItem } from "@/lib/chat";
import { MSG_PAGE } from "@/lib/types";
import { fetchLinkMeta, type LinkMeta } from "@/app/(app)/chat/link-actions";

/** Render text with clickable URLs. */
export function linkify(text: string): React.ReactNode {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", wordBreak: "break-all" }} onClick={(e) => e.stopPropagation()}>{p}</a>
      : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}
export const firstUrl = (text: string) => text.match(/https?:\/\/[^\s]+/)?.[0] ?? null;

// Stable color per group participant, hashed from their JID/name. Mid-tone hues stay legible on
// both light and dark message bubbles.
const SENDER_COLORS = ["#EA580C", "#0891B2", "#8B5CF6", "#E11D48", "#16A34A", "#2563EB", "#CA8A04", "#A855F7", "#DC2626", "#059669", "#6366F1", "#0D9488"];
function senderColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}

/** A message's stored @mentions ({jid,name}), if any (group outbound). */
function metaMentions(m: ChatMessage): { jid: string; name: string }[] {
  const mn = (m.meta as { mentions?: { jid: string; name: string }[] } | null)?.mentions;
  return Array.isArray(mn) ? mn : [];
}

/** Render group text: clickable URLs + @<number> mentions resolved to participant names. */
function renderRichText(text: string, nameForNum: (num: string) => string | undefined): React.ReactNode {
  return text.split(/(https?:\/\/[^\s]+|@\d{5,})/g).map((p, i) => {
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", wordBreak: "break-all" }} onClick={(e) => e.stopPropagation()}>{p}</a>;
    if (/^@\d{5,}$/.test(p)) { const num = p.slice(1); return <span key={i} className="mention">@{nameForNum(num) ?? num}</span>; }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

// Session cache of opened conversation details, so switching chats can render instantly while
// fresh data loads in the background. Populated on open + on hover-prefetch.
const _detailCache = new Map<string, ConvDetail>();
const _prefetching = new Set<string>();

/** Minimal detail from a list item — shows the header instantly before the full detail loads. */
function skeletonDetail(c: ConvListItem): ConvDetail {
  return {
    id: c.id, status: c.status, assignee_id: c.assignee_id, locked_to: c.locked_to, unread: c.unread,
    hidden: c.hidden, snoozed_until: c.snoozed_until, area: c.area,
    contact: c.contact
      ? { id: c.contact.id, name: c.contact.name, phone: c.contact.phone, tags: c.contact.tags ?? [], avatar_url: c.contact.avatar_url, created_at: null }
      : null,
    typing_until: c.typing_until,
    is_group: c.is_group,
    muted: c.muted,
    // Optimista: mientras carga el detalle real, asumimos ventana abierta (el último mensaje pudo
    // ser entrante); el fetch la corrige en cuanto llega.
    last_inbound_at: c.last_message_at,
    wa_official: false,
    messages: [], notes: [], events: [], orders: [],
  };
}

/** True while the customer is typing (server stamps an 8s window; nil/expired → not typing). */
const isTyping = (until: string | null | undefined) => !!until && Date.parse(until) > Date.now();

/** Union two message lists by id (later list wins for updated state), sorted oldest→newest. */
function mergeMsgs(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
}

const _metaCache = new Map<string, LinkMeta>();
/** Open-Graph preview card for the first link in a message. onReady fires when the card (or its
 *  image) appears so the thread can stay pinned to the bottom instead of "popping". */
export function LinkPreview({ url, onReady }: { url: string; onReady?: () => void }) {
  const [meta, setMeta] = useState<LinkMeta | null>(_metaCache.get(url) ?? null);
  useEffect(() => {
    if (_metaCache.has(url)) { setMeta(_metaCache.get(url)!); return; }
    let alive = true;
    fetchLinkMeta(url).then((m) => { _metaCache.set(url, m); if (alive) setMeta(m); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  const hasCard = !!(meta && (meta.title || meta.image));
  useEffect(() => { if (hasCard) onReady?.(); /* eslint-disable-next-line */ }, [hasCard]);
  if (!hasCard) return null;
  let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  return (
    <a href={url} target="_blank" rel="noreferrer" className="link-preview" onClick={(e) => e.stopPropagation()}>
      {meta!.image && <img src={meta!.image} alt="" className="lp-img" onLoad={() => onReady?.()} />}
      <div className="lp-body">
        {meta!.title && <div className="lp-title">{meta!.title}</div>}
        {meta!.description && <div className="lp-desc">{meta!.description}</div>}
        <div className="lp-host">{host}</div>
      </div>
    </a>
  );
}

/** Targeted refresh for chat mutations — refetches the open conversation + list instead of the
 *  whole route. Provided by ChatScreen; falls back to refresh() outside it (e.g. the
 *  order-drawer's floating Thread). */
const ChatRefreshContext = createContext<(() => void) | null>(null);
export function useChatRefresh() {
  const ctx = useContext(ChatRefreshContext);
  const router = useRouter();
  return ctx ?? (() => router.refresh());
}

/**
 * Refresco ligero: solo el encabezado de la conversación (estado, asignado, área, candado) más la
 * lista. Es lo único que cambia al aceptar, resolver, transferir, silenciar o poner el candado.
 *
 * El refresco completo vuelve a traer TODOS los mensajes, notas, eventos y pedidos, y vuelve a
 * firmar cada archivo —- y luego React repinta ese árbol entero. Medido: la acción responde en
 * ~283 ms y React no se queda ni un milisegundo, así que los segundos que se sienten después venían
 * de aquí, no del servidor ni de la base. Para un cambio de estado, traer el hilo completo es
 * trabajo tirado.
 *
 * El completo se sigue usando donde de verdad hace falta: notas y pedidos no viajan por realtime.
 */
const ChatHeaderRefreshContext = createContext<(() => void) | null>(null);
function useChatHeaderRefresh() {
  const ctx = useContext(ChatHeaderRefreshContext);
  const full = useChatRefresh();
  return ctx ?? full;
}
// Optimistically patch the open conversation's detail (instant feedback before the action resolves).
const ChatPatchContext = createContext<((patch: Partial<ConvDetail>) => void) | null>(null);
function useChatPatch() { return useContext(ChatPatchContext) ?? (() => {}); }

function LocationBlock({ m }: { m: ChatMessage }) {
  const meta = (m.meta ?? {}) as { lat?: number; lng?: number; name?: string; address?: string };
  if (meta.lat == null || meta.lng == null) return <div className="row gap-1"><Icon name="pin" size={13} />{m.body || "Ubicación"}</div>;
  const g = `https://www.google.com/maps?q=${meta.lat},${meta.lng}`;
  const img = `https://staticmap.openstreetmap.de/staticmap.php?center=${meta.lat},${meta.lng}&zoom=15&size=240x120&markers=${meta.lat},${meta.lng},red-pushpin`;
  return (
    <a href={g} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none", display: "block" }}>
      <img src={img} alt="mapa" style={{ width: 240, height: 120, borderRadius: 8, display: "block", objectFit: "cover", background: "var(--surface-2)" }} />
      <div className="row gap-1" style={{ marginTop: 4 }}><Icon name="pin" size={13} /><span style={{ fontWeight: 600 }}>{meta.name || meta.address || "Ubicación"}</span></div>
      {meta.address && meta.name && <div className="t-xs muted">{meta.address}</div>}
    </a>
  );
}

function ContactBlock({ m }: { m: ChatMessage }) {
  const meta = (m.meta ?? {}) as { name?: string; vcard?: string };
  const name = meta.name || m.body || "Contacto";
  const phone = meta.vcard ? (meta.vcard.match(/TEL[^:]*:([+\d\s()-]+)/)?.[1]?.trim() ?? "") : "";
  return (
    <div className="row gap-2" style={{ padding: "2px 0" }}>
      <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="user" size={17} /></span>
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }} className="truncate">{name}</div>{phone && <div className="t-xs muted mono">{phone}</div>}</div>
    </div>
  );
}

/** Popover whose menu is fixed-positioned from the trigger rect, so it never gets clipped
 *  by a scrolling/overflow ancestor.
 *
 *  Ojo con el disparador: NO se deshabilita mientras corre una transición. Abrir un menú no muta
 *  nada, y tenerlo bloqueado hasta que el servidor contestara hacía que después de transferir el
 *  botón dejara de responder —- se veía como que la app se había trabado. Lo mismo aplica a
 *  cualquier botón que ya aplique su cambio de forma optimista. */
function usePopover() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => { if (!open && ref.current) setRect(ref.current.getBoundingClientRect()); setOpen((o) => !o); };
  return { ref, open, rect, toggle, close: () => setOpen(false) };
}

/** Reserve the exact display box (from stored w/h, or a default) so media never reflows the
 *  thread when it finishes loading — no "pop", and the scroll-to-bottom stays accurate. */
/** La miniatura JPEG (data URI, unos KB): la que manda WhatsApp dentro del mensaje o la que genera
 *  el worker. Vive en `meta.thumb`. Los mensajes anteriores a esa función no la traen. */
const thumbOf = (m: ChatMessage): string | undefined => ((m.meta ?? {}) as { thumb?: string }).thumb;

/**
 * El momento exacto en que las miniaturas empezaron a existir en los TRES caminos: las que manda
 * WhatsApp, las que calcula el worker de Go al recibir, y las que genera el navegador al subir.
 *
 * Es un instante, no un día. El primer intento usó medianoche UTC del 29 de julio, que en el huso
 * del equipo (MST) cae a las 5 de la tarde del 28 —- así que una foto mandada a las 2:31 p.m. del 29
 * quedaba clasificada como "nueva" y la burbuja intentaba cargar sus 16 MB. De ahí el corte al
 * despliegue real.
 *
 * Antes de este instante no hay nada que pintar sin bajar el original, y bajarlo es lo que traba la
 * pestaña: se pide un clic y el visor lo baja con barra de progreso. Después, todo lo que entra o
 * sale trae miniatura.
 *
 * El rescate del historial (THUMB_BACKFILL en el worker) le pone miniatura a las de antes, y en
 * cuanto la tienen dejan de necesitar el clic.
 */
const THUMBS_SINCE = new Date("2026-07-30T00:00:00Z"); // 29 jul 2026, 17:00 MST

function mediaBox(m: ChatMessage, maxW: number, maxH: number, defW: number, defH: number) {
  const meta = (m.meta ?? {}) as { w?: number; h?: number };
  if (meta.w && meta.h && meta.w > 0 && meta.h > 0) {
    const s = Math.min(maxW / meta.w, maxH / meta.h, 1);
    return { width: Math.max(60, Math.round(meta.w * s)), height: Math.max(60, Math.round(meta.h * s)) };
  }
  return { width: defW, height: defH };
}

function MediaImage({ m, url, onImage }: { m: ChatMessage; url: string; onImage?: (id: string) => void }) {
  const { lang } = useApp();
  const [loaded, setLoaded] = useState(false);
  const isSticker = m.type === "sticker";
  const box = isSticker ? mediaBox(m, 130, 130, 130, 130) : mediaBox(m, 240, 300, 220, 165);
  const thumb = thumbOf(m);
  // El original se pone en un <img> solo cuando corresponde. Decidirlo por PESO no podía funcionar:
  // cuando el worker aprende del Content-Length que la foto son 16 MB, el <img> ya lleva rato
  // bajándolos —- el worker cancela su propia petición, no la del <img>. La única forma de no bajar
  // algo es no ponerlo en un <img>. Así que se decide por fecha (ver THUMBS_SINCE).
  //
  // Los stickers van siempre enteros: pesan unos KB y son el contenido mismo del mensaje. Un
  // sticker detrás de un "Ver" no sería un mensaje, sería un acertijo.
  const preThumbs = !isSticker && !thumb && new Date(m.created_at) < THUMBS_SINCE;
  const size = Math.max(m.media_size ?? 0, 0);
  // Chica y de tamaño conocido → se carga completa y se ve nítida de entrada, con o sin miniatura.
  // Es la auto-descarga de WhatsApp: reservar el clic del visor para 300 KB sería pura burocracia.
  // También rescata fotos viejas chicas cuando el backfill les llena media_size.
  const smallAuto = !isSticker && size > 0 && size < 300 * 1024;
  const loadFull = isSticker || smallAuto || (!thumb && !preThumbs);
  // Cuando no toca bajar, se MIRA el caché igual: si esta foto ya se abrió una vez, sus bytes están
  // en el dispositivo y se muestra nítida en el hilo, sin pedir nada. Es lo que hace WhatsApp —- una
  // vez descargada, deja de verse la versión pobre.
  const { src: fullSrc } = useCachedMedia(m.media_path, loadFull ? url : null, loadFull ? "warm" : "peek");
  const src = fullSrc ?? thumb;
  // La miniatura es el contenido definitivo (no hay nada mejor en camino): no se desenfoca ni se
  // difiere su carga.
  const thumbIsContent = !!thumb && src === thumb;
  return (
    // El <a> conserva el menú nativo del navegador (Guardar imagen como…, Copiar imagen) y
    // dragOutProps permite arrastrar el archivo real a otra app o página sin descargarlo antes.
    <a href={url} target="_blank" rel="noreferrer" className="media-frame" style={{ ...box, cursor: "zoom-in" }}
            // Un sticker no entra a la galería (ver imageMsgs), así que tampoco abre el visor: sin él en
      // la lista, el índice saldría -1 y se abriría en una foto que no tiene nada que ver.
      onClick={(e) => { if (onImage && !isSticker) { e.preventDefault(); onImage(m.id); } }}
      {...dragOutProps(url, m.media_mime, m.media_name)}>
      {src ? (
        <>
          {/* El relleno desenfocado solo tiene sentido cuando viene una imagen MEJOR en camino. Si la
              miniatura ya es el contenido definitivo, desenfocarla es degradarla a propósito —- y era
              justo lo que se veía: el <img> de contenido lleva loading="lazy", el navegador lo
              diferÍa, onLoad nunca disparaba, se quedaba en opacity 0, y lo único visible era esta
              copia borrosa. */}
          {!loaded && !thumbIsContent && (thumb
            ? <img src={thumb} alt="" aria-hidden className="media-el" style={{ objectFit: isSticker ? "contain" : "cover", filter: "blur(6px)", transform: "scale(1.06)" }} />
            : <span className="media-skeleton" />)}
          {/* decoding="async" mantiene la decodificación fuera del hilo principal. El lazy solo se
              aplica a los archivos grandes: en una miniatura de unos KB no ahorra nada y sí puede
              dejarla sin pintar. */}
          <img src={src} alt="" onLoad={() => setLoaded(true)} className="media-el" draggable={false}
            decoding="async" loading={thumbIsContent ? undefined : "lazy"}
            style={{ objectFit: isSticker ? "contain" : "cover", opacity: thumbIsContent || loaded ? 1 : 0 }} />
        </>
      ) : (
        // Sin miniatura (mensajes anteriores a que se guardaran, o formatos que no sabemos leer):
        // se ofrece abrirla, que es donde sí hay barra de progreso. El rescate del historial
        // (THUMB_BACKFILL) le pone miniatura a estas y dejan de necesitar el clic.
        <span className="media-tap"><Icon name="download" size={18} />{lang === "es" ? "Ver foto" : "View photo"}</span>
      )}
      {!src && size > 0 && <span className="media-heavy">{fmtBytes(size)}</span>}
    </a>
  );
}

/** Full-screen photo viewer with prev/next + per-photo download/forward/delete. */
export function Lightbox({ items, index, onClose, onForward, onDelete }: { items: ChatMessage[]; index: number; onClose: () => void; onForward: (m: ChatMessage) => void; onDelete: (m: ChatMessage) => void }) {
  const { lang } = useApp();
  const [i, setI] = useState(index);
  const prev = useCallback(() => setI((x) => (x - 1 + items.length) % items.length), [items.length]);
  const next = useCallback(() => setI((x) => (x + 1) % items.length), [items.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowLeft") prev(); else if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose]);
  const m = items[Math.min(i, items.length - 1)];
  const url = m?.media_url ?? "";
  const thumb = thumbOf(m);

  // El visor pide el archivo él mismo en lugar de dejárselo al <img>, por una sola razón: es la
  // única forma de saber cuánto lleva bajado. El navegador no expone el avance de una imagen.
  // Mientras llega se muestra la miniatura ampliada, así que nunca hay pantalla negra.
  const [full, setFull] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let objectUrl: string | null = null;
    setFull(null); setPct(null); setFailed(false);
    fetchWithProgress(m?.media_path, url, (p) => { if (alive) setPct(p); }).then((u) => {
      if (!alive) { if (u) URL.revokeObjectURL(u); return; }
      if (u) { objectUrl = u; setFull(u); } else setFailed(true);
    });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, m?.media_path]);
  // Mientras el worker baja, el <img> lleva la miniatura o NADA —- nunca la URL firmada: ponerla
  // arrancaba una segunda descarga del archivo completo en paralelo con la del worker. La URL solo
  // entra si la descarga falló: que el <img> lo intente a su manera es mejor que un error.
  const src = full ?? (failed ? url : thumb);
  // Unificado con el resto: Storage responde a ?download=<nombre>, así que no hace falta traer el
  // archivo entero a memoria. El fallback a blob sigue dentro de downloadMedia.
  const download = () => {
    downloadMedia(url, m.media_name || (m.type === "sticker" ? "sticker.webp" : "foto.jpg"), m.media_mime);
  };
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={download} title={lang === "es" ? "Descargar" : "Download"}><Icon name="download" size={20} /></button>
        <button onClick={() => onForward(m)} title={lang === "es" ? "Reenviar" : "Forward"}><Icon name="forward" size={20} /></button>
        {m?.direction === "out" && <button onClick={() => onDelete(m)} title={lang === "es" ? "Eliminar" : "Delete"}><Icon name="trash" size={20} /></button>}
        <button onClick={onClose} title={lang === "es" ? "Cerrar" : "Close"}><Icon name="x" size={20} /></button>
      </div>
      {items.length > 1 && <button className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="prev"><span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><Icon name="chevd" size={26} /></span></button>}
      <img src={src} alt="" className="lb-img" decoding="async" onClick={(e) => e.stopPropagation()}
        style={!full && thumb ? { filter: "blur(10px)" } : undefined} />
      {!full && !failed && (
        <div className="lb-progress" onClick={(e) => e.stopPropagation()}>
          <div className="lb-progress-bar"><i style={{ width: (pct ?? 8) + "%" }} /></div>
          <span>{pct == null ? (lang === "es" ? "Cargando…" : "Loading…") : `${pct}%`}</span>
        </div>
      )}
      {items.length > 1 && <button className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="next"><span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon name="chevd" size={26} /></span></button>}
      {items.length > 1 && <div className="lb-count">{i + 1} / {items.length}</div>}
    </div>
  );
}

const fmtTime = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

// One shared AudioContext for decoding durations (browsers cap concurrent contexts; decodeAudioData
// works fine on a suspended one, so we never need to start or close it).
let _decodeCtx: AudioContext | null = null;
async function decodeDuration(buf: ArrayBuffer): Promise<number> {
  const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return 0;
  if (!_decodeCtx) _decodeCtx = new AC();
  const decoded = await _decodeCtx.decodeAudioData(buf);
  return isFinite(decoded.duration) && decoded.duration > 0 ? decoded.duration : 0;
}

/** Voice-note / audio player. WhatsApp ships OGG/Opus voice notes whose container duration Chrome
 *  miscomputes (often ~half, or Infinity) and whose streaming over a signed URL can stall mid-clip.
 *  We sidestep both: fetch the whole file into a local blob (fully seekable, no range-request
 *  stalls) and read the TRUE duration via Web Audio decodeAudioData (exact sample count, ignores
 *  the broken container metadata). Falls back to the direct URL + a seek-to-end scan if any of that
 *  isn't available (e.g. Safari can't decode Opus, or CORS blocks the fetch). */
function AudioPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fixing = useRef(false);

  useEffect(() => {
    let cancelled = false; let obj: string | null = null;
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const ct = res.headers.get("Content-Type") || "audio/ogg";
        obj = URL.createObjectURL(new Blob([buf], { type: ct })); // local copy → reliable seeking, no network stalls
        if (!cancelled) setSrc(obj);
        try { // exact duration, independent of the OGG/Opus container headers
          const d = await decodeDuration(buf.slice(0));
          if (!cancelled && d > 0) setDur(d);
        } catch { /* codec not decodable here → fall back to the element's own duration */ }
      } catch { if (!cancelled) setSrc(url); } // CORS / network → play the URL directly
    })();
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);

  // Fallback when decodeAudioData didn't give us a duration: accept a finite one, else seek-to-end scan.
  const settle = () => {
    const a = ref.current; if (!a || dur > 0) return;
    const d = a.duration;
    if (isFinite(d) && d > 0) {
      setDur(d);
      if (fixing.current) { fixing.current = false; try { a.currentTime = 0; } catch {} setCur(0); }
    } else if (!fixing.current) { fixing.current = true; try { a.currentTime = 1e101; } catch {} }
  };
  const onTimeUpdate = () => {
    const a = ref.current; if (!a) return;
    if (fixing.current) {
      if (isFinite(a.duration) && a.duration > 0 && dur === 0) setDur(a.duration);
      fixing.current = false; try { a.currentTime = 0; } catch {} setCur(0);
      return;
    }
    setCur(a.currentTime);
  };
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) a.play().catch(() => {}); else a.pause(); };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => { const a = ref.current; if (!a || !dur) return; const v = Number(e.target.value); a.currentTime = v; setCur(v); };

  return (
    <div className="aud">
      <audio ref={ref} src={src ?? undefined} preload="metadata"
        onLoadedMetadata={settle} onDurationChange={settle} onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCur(0); }} />
      <button className="aud-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={!src}>
        {playing
          ? <svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>}
      </button>
      <input className="aud-range" type="range" min={0} max={dur || 0} step="0.01" value={Math.min(cur, dur || 0)} onChange={seek} disabled={!dur} />
      <span className="aud-time mono">{fmtTime(cur)} / {dur ? fmtTime(dur) : "–:––"}</span>
    </div>
  );
}

/** One sticker in the send tray: click to send, star toggles favorite, name shown under favorites. */
/** Favorite editor shown in the tray: name + tag chips (add/remove), and remove-from-favorites. */
function SaveFavoriteForm({ s, lang, onSave, onRemove, onCancel }: { s: StickerItem; lang: "es" | "en"; onSave: (name: string, tags: string[]) => void; onRemove?: () => void; onCancel: () => void }) {
  const [name, setName] = useState(s.name ?? "");
  const [tags, setTags] = useState<string[]>(s.tags ?? []);
  const [input, setInput] = useState("");
  const addTag = (raw: string) => { const t = raw.trim().toLowerCase(); if (t && !tags.includes(t)) setTags((ts) => [...ts, t]); setInput(""); };
  const removeTag = (t: string) => setTags((ts) => ts.filter((x) => x !== t));
  const onTagKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (input.trim()) addTag(input); else onSave(name.trim(), tags); }
    else if (e.key === "Backspace" && !input && tags.length) removeTag(tags[tags.length - 1]);
  };
  return (
    <div className="col gap-2 scroll" style={{ padding: 2, overflowY: "auto" }}>
      <div className="row gap-2" style={{ alignItems: "center" }}>
        <span className="sticker-pick" style={{ width: 44, height: 44, flex: "none", padding: 4 }}><CachedImg path={s.path} url={s.url} alt="" /></span>
        <span className="grow" style={{ fontWeight: 700, fontSize: 13 }}>{s.fav ? (lang === "es" ? "Editar favorito" : "Edit favorite") : (lang === "es" ? "Guardar en favoritos" : "Save to favorites")}</span>
      </div>
      <div className="field field-sm field-filled">
        <input autoFocus placeholder={lang === "es" ? "Nombre (ej. perro lentes)" : "Name (e.g. dog glasses)"} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSave(name.trim(), tags); }} />
      </div>
      <div>
        <div className="lbl" style={{ marginBottom: 4 }}><Icon name="tag" size={12} /> Tags</div>
        {tags.length > 0 && (
          <div className="row gap-1" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            {tags.map((t) => (
              <span key={t} className="pill pill-brand" style={{ gap: 4 }}>{t}<button onClick={() => removeTag(t)} title={lang === "es" ? "Quitar" : "Remove"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", display: "inline-flex", padding: 0 }}><Icon name="x" size={11} /></button></span>
            ))}
          </div>
        )}
        <div className="field field-sm field-filled">
          <input placeholder={lang === "es" ? "Agregar tag y Enter" : "Add tag, press Enter"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onTagKey} onBlur={() => { if (input.trim()) addTag(input); }} />
        </div>
      </div>
      <div className="row gap-2">
        <button className="btn btn-sm btn-outline grow" onClick={onCancel}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
        <button className="btn btn-sm btn-primary grow" onClick={() => onSave(name.trim(), tags)}><Icon name="check" size={14} />{lang === "es" ? "Guardar" : "Save"}</button>
      </div>
      {onRemove && <button className="btn btn-sm btn-danger btn-block" onClick={onRemove}><Icon name="trash" size={14} />{lang === "es" ? "Quitar de favoritos" : "Remove from favorites"}</button>}
    </div>
  );
}

/** Una plantilla del negocio. Puede llevar archivo: `media_url` es la ruta en Storage (ver 0090). */
type CannedItem = {
  id: string; title: string; body: string; shortcut: string | null;
  media_url: string | null; media_mime: string | null; media_name: string | null;
  media_size: number | null; media_thumb: string | null;
};

export function MediaBlock({ m, onImage }: { m: ChatMessage; onImage?: (id: string) => void }) {
  // Llamada: no hay archivo, es un aviso. Amarillo mientras suena, rojo si quedó perdida.
  if (m.type === "call") {
    const ringing = m.state === "ringing";
    return (
      <span className="row gap-2" style={{ alignItems: "center", padding: "4px 2px", color: ringing ? "var(--amber)" : "var(--red)", fontWeight: 600, fontSize: 13 }}>
        <span style={{ fontSize: 15 }}>📞</span>
        {ringing ? "Llamada entrante" : "Llamada perdida"}
      </span>
    );
  }
  // Purgado por antigüedad: el mensaje se conserva para no perder el rastro de que hubo un
  // archivo, pero el archivo ya no está. Se dice explícito en vez de dejar un hueco.
  if ((m as unknown as { media_purged_at?: string | null }).media_purged_at) {
    return (
      <span className="row gap-2" style={{ alignItems: "center", padding: "6px 4px", color: "var(--text-faint)", fontSize: 12.5 }}>
        <Icon name="file" size={15} />
        <span>{m.media_name || "Archivo"} · ya no disponible, pídelo de nuevo</span>
      </span>
    );
  }
  // Pesado y aún sin bajar: se muestra el archivo con su tamaño y un botón. Se materializa la
  // primera vez que alguien lo pide; el que nadie abre nunca ocupa storage.
  if (m.media_pending || m.media_fetch_error) return <PendingMedia m={m} />;
  const url = m.media_url ?? undefined;
  if (!url) return null;
  if (m.type === "image" || m.type === "sticker") return <MediaImage m={m} url={url} onImage={onImage} />;
  if (m.type === "video") {
    const box = mediaBox(m, 260, 320, 260, 180);
    return <div className="media-frame" style={box} {...dragOutProps(url, m.media_mime, m.media_name)}><video src={url} controls className="media-el" style={{ objectFit: "cover" }} /></div>;
  }
  if (m.type === "audio") return <AudioPlayer url={url} />;
  // document / other
  return (
    <span className="row gap-2" style={{ padding: "6px 4px", alignItems: "center" }}>
      {/* La tarjeta sigue abriendo el archivo (a veces quieres verlo); el botón lo BAJA directo,
          sin pasar por una pestaña nueva. */}
      <a href={url} target="_blank" rel="noreferrer" className="row gap-2 grow" style={{ minWidth: 0, textDecoration: "none", color: "inherit" }}
        {...dragOutProps(url, m.media_mime, m.media_name)}>
        <span className="doc-ic" style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="file" size={17} /></span>
        <span style={{ minWidth: 0 }}><span style={{ fontWeight: 600, fontSize: 12.5, display: "block" }} className="truncate">{m.media_name || "Archivo"}</span><span className="t-xs muted">{(m.media_mime || "").split("/").pop()}</span></span>
      </a>
      <button className="iconbtn sm" title="Descargar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadMedia(url, m.media_name, m.media_mime); }}><Icon name="download" size={15} /></button>
    </span>
  );
}

/** Conversation-list preview: caption/body, else a label for the media type (or "deleted"). */
function msgPreview(c: ConvListItem, lang: "es" | "en"): string {
  if (c.lastDeleted) return lang === "es" ? "🚫 Mensaje eliminado" : "🚫 Message deleted";
  if (c.preview) return c.preview;
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  switch (c.lastType) {
    case "image": return L("📷 Foto", "📷 Photo");
    case "sticker": return L("🩷 Sticker", "🩷 Sticker");
    case "call": return L("📞 Llamada perdida", "📞 Missed call");
    case "audio": return L("🎤 Audio", "🎤 Audio");
    case "video": return L("🎥 Video", "🎥 Video");
    case "document": return L("📄 Documento", "📄 Document");
    case "location": return L("📍 Ubicación", "📍 Location");
    case "contact": return L("👤 Contacto", "👤 Contact");
    default: return "";
  }
}

function Tick({ state }: { state: string | null }) {
  if (state === "read") return <span className="tick" style={{ color: "var(--blue)", display: "inline-flex" }}><Icon name="checks" size={16} /></span>;
  if (state === "delivered") return <span className="tick" style={{ display: "inline-flex", opacity: 0.6 }}><Icon name="checks" size={16} /></span>;
  if (state === "sent") return <span className="tick" style={{ display: "inline-flex", opacity: 0.6 }}><Icon name="check" size={14} /></span>;
  if (state === "failed") return <span style={{ color: "var(--red)", display: "inline-flex" }} title="No se pudo enviar"><Icon name="x" size={12} /></span>;
  return <span style={{ display: "inline-flex", opacity: 0.5 }}><Icon name="clock" size={11} /></span>;
}

/** Scroll the original message into view and flash it (if it's loaded in the thread). */
function jumpToMessage(id: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("m-" + id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-flash");
  window.setTimeout(() => el.classList.remove("msg-flash"), 1500);
}

function QuotedBlock({ m }: { m: ChatMessage }) {
  const { lang } = useApp();
  const label = m.deleted ? "…" : (m.body || (m.type !== "text" ? "📎 " + m.type : ""));
  return <div className="truncate" title={lang === "es" ? "Ir al mensaje" : "Go to message"} onClick={(e) => { e.stopPropagation(); jumpToMessage(m.id); }} style={{ borderLeft: "3px solid var(--brand)", padding: "3px 8px", marginBottom: 4, background: "rgba(0,0,0,.05)", borderRadius: 6, fontSize: 12, maxWidth: 240, cursor: "pointer" }}>{label}</div>;
}

/** La historia (status) a la que contesta el mensaje, si el worker la guardó (ver `withStoryJSON`). */
function storyOf(m: ChatMessage): StoryQuote | null {
  const st = (m.meta as { story?: StoryQuote } | null)?.story;
  return st && typeof st === "object" && typeof st.type === "string" ? st : null;
}

/**
 * Cita de una respuesta a HISTORIA.
 *
 * Una historia no es un mensaje del hilo —- WhatsApp no las manda al chat y nosotros no las
 * guardamos —- así que no hay a qué saltar: esta cita no navega, muestra. Sin ella el agente leía
 * "me encanta 😍" sin la menor idea de a qué le estaban contestando.
 *
 * La miniatura viene en el propio meta (data URI), así que se pinta aunque la historia ya haya
 * caducado en WhatsApp. La copia completa solo existe si se alcanzó a bajar dentro de las 24 h.
 */
function StoryQuoteBlock({ s, out }: { s: StoryQuote; out: boolean }) {
  const { lang } = useApp();
  const title = out
    ? (lang === "es" ? "Respondiste a su historia" : "You replied to their story")
    : (lang === "es" ? "Respondió a tu historia" : "Replied to your story");
  const preview = s.thumb || s.url || null;
  const inner = (
    <>
      {preview && s.type !== "text" && (
        <span style={{ width: 38, height: 50, borderRadius: 5, overflow: "hidden", flex: "none", background: "rgba(0,0,0,.12)", display: "block" }}>
          <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </span>
      )}
      <span style={{ minWidth: 0 }}>
        <span className="row gap-1" style={{ alignItems: "center", fontWeight: 700, fontSize: 11.5, color: "var(--brand-700)" }}>
          <Icon name="sparkles" size={11} />{title}
        </span>
        <span className="truncate" style={{ display: "block", fontSize: 12, opacity: 0.85 }}>
          {s.caption || (s.type === "image" ? (lang === "es" ? "Foto" : "Photo") : s.type === "video" ? (lang === "es" ? "Video" : "Video") : "—")}
        </span>
        {s.type !== "text" && !s.url && (
          <span className="t-xs muted" style={{ display: "block" }}>{lang === "es" ? "La historia ya no está disponible" : "The story is no longer available"}</span>
        )}
      </span>
    </>
  );
  const style: React.CSSProperties = { borderLeft: "3px solid var(--brand)", padding: "4px 8px", marginBottom: 4, background: "rgba(0,0,0,.05)", borderRadius: 6, maxWidth: 240, display: "flex", gap: 8, alignItems: "center", textDecoration: "none", color: "inherit" };
  // Con copia completa se abre en pestaña nueva; sin ella no hay nada que abrir y no se finge un
  // clic que no lleva a ningún lado.
  return s.url
    ? <a href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={lang === "es" ? "Ver la historia" : "Open the story"} style={{ ...style, cursor: "zoom-in" }}>{inner}</a>
    : <div style={style}>{inner}</div>;
}

function MsgMenu({ m, out, onReply, onEdit, onDelete, onReact, onForward, onCopied }: { m: ChatMessage; out: boolean; onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (rect: DOMRect) => void; onForward: () => void; onCopied?: (r: "file" | "link" | null) => void }) {
  const { lang } = useApp();
  const { ref, open, rect, toggle, close } = usePopover();
  return (
    <span className={"msg-menu" + (open ? " open" : "")} style={{ position: "absolute", top: 3, [out ? "right" : "left"]: 4 }}>
      <button ref={ref} className="msg-menu-btn" onClick={toggle} aria-label="Menu"><Icon name="dots" size={14} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={menuStyle(rect, { width: 160, height: 240, align: out ? "right" : "left" })}>
            <button className="menu-item" onClick={() => { const r = rect; close(); onReact(r); }}><span style={{ fontSize: 15, width: 15, display: "inline-flex", justifyContent: "center" }}>😊</span>{lang === "es" ? "Reaccionar" : "React"}</button>
            <button className="menu-item" onClick={() => { close(); onReply(); }}><Icon name="swap" size={15} />{lang === "es" ? "Responder" : "Reply"}</button>
            {!m.deleted && (m.type === "text" || !!m.media_url) && <button className="menu-item" onClick={() => { close(); onForward(); }}><Icon name="forward" size={15} />{lang === "es" ? "Reenviar" : "Forward"}</button>}
            {/* Dos acciones separadas: copiar el ARCHIVO (solo imágenes — el portapapeles web no
                admite otros tipos) y copiar su enlace. Antes una sola decidía por ti. */}
            {!m.deleted && !!m.media_url && canCopyFile(m.media_mime) && (
              <button className="menu-item" onClick={async () => { close(); onCopied?.(await copyFile(m.media_url!, m.media_mime) ? "file" : null); }}>
                <Icon name="file" size={15} />{lang === "es" ? "Copiar archivo" : "Copy file"}
              </button>
            )}
            {!m.deleted && !!m.media_url && (
              <button className="menu-item" onClick={() => { close(); downloadMedia(m.media_url!, m.media_name, m.media_mime); }}>
                <Icon name="download" size={15} />{lang === "es" ? "Descargar" : "Download"}
              </button>
            )}
            {!m.deleted && !!m.media_url && (
              <button className="menu-item" onClick={async () => { close(); onCopied?.(await copyLink(m.media_url!) ? "link" : null); }}>
                <Icon name="paperclip" size={15} />{lang === "es" ? "Copiar enlace" : "Copy link"}
              </button>
            )}
            {out && m.type === "text" && <button className="menu-item" onClick={() => { close(); onEdit(); }}><Icon name="edit" size={15} />{lang === "es" ? "Editar" : "Edit"}</button>}
            {out && <button className="menu-item danger" onClick={() => { close(); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar" : "Delete"}</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** Options menu for a grouped-photo album (forward / delete all). */
function AlbumMenu({ out, onForward, onDelete }: { out: boolean; onForward: () => void; onDelete?: () => void }) {
  const { lang } = useApp();
  const { ref, open, rect, toggle, close } = usePopover();
  return (
    <span className="msg-menu" style={{ position: "absolute", top: 6, [out ? "right" : "left"]: 6, zIndex: 4 }}>
      <button ref={ref} className="msg-menu-btn" onClick={toggle} aria-label="Menu" style={{ background: "rgba(0,0,0,.5)", color: "#fff" }}><Icon name="dots" size={14} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={menuStyle(rect, { width: 180, height: 180, align: out ? "right" : "left" })}>
            <button className="menu-item" onClick={() => { close(); onForward(); }}><Icon name="forward" size={15} />{lang === "es" ? "Reenviar todas" : "Forward all"}</button>
            {onDelete && <button className="menu-item danger" onClick={() => { close(); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar todas" : "Delete all"}</button>}
          </div>
        </>
      )}
    </span>
  );
}

// "Archivado" (hidden/snoozed) and "papelera" (no activity in 90+ days) are decided in SQL now —
// see getConversationListPage and the chat_list_counts RPC (0062).

function snoozeShortcuts(lang: "es" | "en"): { label: string; iso: string }[] {
  const mk = (fn: (d: Date) => void) => { const d = new Date(); fn(d); return d.toISOString(); };
  return [
    { label: lang === "es" ? "En 1 hora" : "In 1 hour", iso: mk((d) => d.setHours(d.getHours() + 1)) },
    { label: lang === "es" ? "En 3 horas" : "In 3 hours", iso: mk((d) => d.setHours(d.getHours() + 3)) },
    { label: lang === "es" ? "Esta tarde (18:00)" : "This evening (6pm)", iso: mk((d) => d.setHours(18, 0, 0, 0)) },
    { label: lang === "es" ? "Mañana 9:00" : "Tomorrow 9am", iso: mk((d) => { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }) },
    { label: lang === "es" ? "Próxima semana" : "Next week", iso: mk((d) => { d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); }) },
  ];
}

const STATUS_COLOR: Record<string, PillColor> = { open: "blue", pending: "amber", resolved: "green" };
const STATUS_LABEL: Record<string, { es: string; en: string }> = {
  open: { es: "Abierto", en: "Open" },
  pending: { es: "Pendiente", en: "Pending" },
  resolved: { es: "Resuelto", en: "Resolved" },
};

/** Custom-confirm options shown before a reassignment that would release a "mantener conmigo" lock. */
function lockConfirmOpts(agentName: string, lang: "es" | "en"): ConfirmOpts {
  return {
    icon: "lock", danger: true,
    title: lang === "es" ? "Cliente mantenido" : "Pinned client",
    message: lang === "es"
      ? `Este cliente está mantenido con ${agentName}. Transferirlo soltará el candado. ¿Transferir de todos modos?`
      : `This client is kept with ${agentName}. Transferring will release the pin. Transfer anyway?`,
    confirmLabel: lang === "es" ? "Transferir" : "Transfer",
    cancelLabel: lang === "es" ? "Mantener" : "Keep",
  };
}

export function ChatScreen({
  list: listProp, detail: detailProp, selectedId, agents, areas, stages, products, meId, businessId, connected, invoice, shipping, invoicing, initialCounts, doneFromStageId = null, manualMarginPct = 50,
}: {
  list: ConvListItem[];
  initialCounts?: ChatListCounts;
  /** Umbral de "terminado" del negocio (0072) — para el conteo de abiertos del cliente 360. */
  doneFromStageId?: string | null;
  manualMarginPct?: number;
  detail: ConvDetail | null;
  selectedId: string | null;
  agents: Agent[];
  areas: Area[];
  stages: Stage[];
  products: Product[];
  meId: string;
  businessId: string;
  connected: boolean;
  invoice?: { add: boolean; rate: number };
  shipping?: string | null;
  invoicing?: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const ask = useConfirm();
  const [show360, setShow360] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [tab, setTab] = useState<"mine" | "unassigned" | "all">("mine");

  // The list window is owned by the client from here on (the server only seeds the first page), so
  // it is NOT re-seeded from listProp — that would replace a filtered window with the default one.
  const [list, setList] = useState(listProp);
  // Se leen dentro de patchDetail. Con reactStrictMode encendido React invoca los updaters DOS veces
  // en desarrollo, así que calcular a partir de refs (y no anidando setters) evita descontar doble.
  const listRef = useRef(listProp);
  listRef.current = list;
  const listQueryRef = useRef<ConvQuery>({});
  const [detail, setDetail] = useState(detailProp);
  useEffect(() => { setDetail(detailProp); }, [detailProp]);
  const detailIdRef = useRef<string | null>(null);
  detailIdRef.current = detail?.id ?? null;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  // Refetches the list window with whatever filters are active. Held in a ref because the realtime
  // handlers below are defined before the window state exists.
  const refetchListRef = useRef<() => void>(() => {});
  // Realtime health (channel SUBSCRIBED?) + a handle to the resync fn, shared between the realtime
  // subscription and the adaptive poll below.
  const realtimeHealthyRef = useRef(false);
  const resyncRef = useRef<() => void>(() => {});
  const [realtimeDown, setRealtimeDown] = useState(false); // realtime channel dropped → show a reload banner
  /**
   * Aplica un cambio a la conversación abierta Y a la lista Y a los contadores, todo de inmediato.
   *
   * Antes solo tocaba el encabezado. El tag cambiaba al instante pero la lista y los chips esperaban
   * al servidor, así que uno o dos segundos después la fila se movía y los números saltaban —- justo
   * eso es lo que hace sentir la app lenta aunque la acción ya haya respondido.
   *
   * El refetch sigue llegando después y reconcilia; esto solo adelanta lo que ya sabemos sin
   * preguntar. Si algo no cuadra, el servidor gana.
   */
  const patchDetail = useCallback((patch: Partial<ConvDetail>) => {
    setDetail((c) => (c ? { ...c, ...patch } : c));
    const id = detailIdRef.current;
    if (!id) return;
    const row = listRef.current.find((r) => r.id === id);
    // Sin fila NO se abandona: la fila se fue de la lista justo cuando el chat salió de la vista
    // (p.ej. se resolvió mirando "Activos"), y REABRIRLO después es exactamente el caso que dolía
    // —- el chip Activos se quedaba esperando al servidor 3+ segundos porque aquí nos rendíamos.
    // El chat abierto conserva los valores anteriores, así que la resta/suma sale de él.
    const d0 = detailRef.current;
    const prev = row ?? (d0 && d0.id === id ? { status: d0.status, assignee_id: d0.assignee_id } : null);
    if (!prev) return;
    const next = { ...prev, ...(patch as Partial<ConvListItem>) };

    // Los contadores se mueven por la DIFERENCIA respecto a lo que había, no por el valor nuevo:
    // sin comparar contra el estado anterior, dos clics seguidos descontarían dos veces.
    // Va por ref y no por updater para poder guardar el resultado en el caché de la vista (con
    // strict mode los updaters corren dos veces y un efecto adentro descontaría doble).
    {
      const d = { ...countsRef.current };
      if (patch.status !== undefined && patch.status !== prev.status) {
        const bucket = (st: string) => (st === "open" || st === "pending" || st === "resolved" ? (st as "open" | "pending" | "resolved") : null);
        const from = bucket(prev.status), to = bucket(next.status);
        if (from) d[from] = Math.max(0, d[from] - 1);
        if (to) d[to] = d[to] + 1;
        // "Activos" = abierto + pendiente. Resolver saca de ahí; reabrir vuelve a meter.
        const wasActive = prev.status !== "resolved", isActive = next.status !== "resolved";
        if (wasActive && !isActive) d.active = Math.max(0, d.active - 1);
        if (!wasActive && isActive) d.active = d.active + 1;
      }
      if (patch.assignee_id !== undefined && patch.assignee_id !== prev.assignee_id) {
        const wasMine = prev.assignee_id === meId, isMine = next.assignee_id === meId;
        if (wasMine && !isMine) d.mine = Math.max(0, d.mine - 1);
        if (!wasMine && isMine) d.mine = d.mine + 1;
        const wasFree = !prev.assignee_id, isFree = !next.assignee_id;
        if (wasFree && !isFree) d.unassigned = Math.max(0, d.unassigned - 1);
        if (!wasFree && isFree) d.unassigned = d.unassigned + 1;
      }
      setCounts(d);
      countsCacheRef.current.set(countsKeyRef.current, d);
    }

    // La cirugía de la lista solo aplica si la fila está en la ventana actual.
    if (!row) return;
    // Si con el cambio la fila deja de pertenecer a la vista actual, se va ya: verla desaparecer dos
    // segundos después es peor que verla desaparecer al instante.
    const q = listQueryRef.current;
    const rowNext = { ...row, ...(patch as Partial<ConvListItem>) };
    const gone =
      (q.tab === "unassigned" && !!rowNext.assignee_id) ||
      (q.tab === "mine" && rowNext.assignee_id !== meId) ||
      (q.status === "active" && rowNext.status === "resolved") ||
      (!!q.status && q.status !== "active" && q.status !== "trash" && rowNext.status !== q.status);
    if (gone) {
      setListTotal((t) => Math.max(0, t - 1));
      setList((rows) => rows.filter((r) => r.id !== id));
    } else {
      setList((rows) => rows.map((r) => (r.id === id ? rowNext : r)));
    }
  }, [meId]);

  // Re-render periodically so typing indicators expire on their own (no "paused" event needed).
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const anyTyping = isTyping(detail?.typing_until) || list.some((c) => isTyping(c.typing_until));
    if (!anyTyping) return;
    const i = setInterval(() => setNowTick((t) => t + 1), 1500);
    return () => clearInterval(i);
  });

  // Speed: cache each opened detail, prefetch on hover, and open instantly from cache/skeleton
  // (the URL navigation still refetches fresh data in the background).
  useEffect(() => { if (detail) _detailCache.set(detail.id, detail); }, [detail]);
  const prefetchDetail = useCallback((id: string) => {
    if (_detailCache.has(id) || _prefetching.has(id)) return;
    _prefetching.add(id);
    liveDetail(id).then((d) => { if (d) _detailCache.set(id, d); }).catch(() => {}).finally(() => _prefetching.delete(id));
  }, []);
  /** Loads just the detail for `id` into view (cache first, then fresh). */
  const showConv = useCallback((id: string, seed?: ConvDetail) => {
    if (seed) setDetail(seed);
    liveDetail(id).then((d) => {
      if (!d) return;
      _detailCache.set(id, d);
      setDetail((cur) => (cur && cur.id === id ? d : cur));
    }).catch(() => {});
  }, []);

  const openConv = useCallback((c: ConvListItem) => {
    setDetail(_detailCache.get(c.id) ?? skeletonDetail(c));
    // Persist immediately on the explicit click (the URL lags behind the optimistic open, so the
    // URL-guarded effect below can miss it and the "last chat" cookie would get stuck).
    try { document.cookie = `ht_lastChat_${businessId}=${c.id}; path=/; max-age=2592000; SameSite=Lax`; } catch {}
    // history.pushState instead of router.push: opening a chat only changes the DETAIL, but a
    // router navigation re-runs the whole /chat server component — list, agents, areas, stages,
    // sessions, products, integrations — on every click, and the route is force-dynamic so nothing
    // is cached. Next syncs its router state from pushState, so ?c= deep links keep working.
    try { window.history.pushState(null, "", `/chat?c=${c.id}`); } catch {}
    showConv(c.id);
  }, [showConv]);

  /** Volver a la lista (móvil). Se empuja `/chat` en el historial en vez de hacer `history.back()`
   *  a ciegas: si alguien entró directo a `/chat?c=X` desde una notificación, un back lo sacaría
   *  de la app en lugar de enseñarle la lista. */
  const closeConv = useCallback(() => {
    setDetail(null);
    try { window.history.pushState(null, "", "/chat"); } catch {}
  }, []);

  // Back/forward has to move between chats now that opening one isn't a route navigation.
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get("c");
      // Sin `?c=` estamos de vuelta en la lista pelada. Antes esto no hacía nada y el chat se
      // quedaba abierto; en un teléfono eso significaba que el botón atrás de Android no cerraba
      // el hilo y parecía que la app se había trabado.
      if (id) showConv(id, _detailCache.get(id));
      else setDetail(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [showConv]);

  // Background backfill of the local search cache (WhatsApp Web model): walk recent conversations
  // and page their history (up to ~90 days) into IndexedDB, throttled, resumable across sessions
  // via a per-conversation cursor. Uses the /chat/backfill ROUTE (plain fetch) — NOT server actions:
  // React serializes actions per client, so backfill-on-actions queued ahead of the realtime
  // refetches and froze new-message/read/preview updates while a chat was open.
  useEffect(() => {
    let stop = false;
    const CUTOFF = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    type BfPage = { messages: { id: string; body: string; senderName: string | null; dir: "in" | "out"; ts: string }[]; pageSize: number; oldest: string | null };
    const fetchPage = async (convId: string, before: string | null): Promise<BfPage> => {
      const u = `/chat/backfill?conv=${convId}` + (before ? `&before=${encodeURIComponent(before)}` : "");
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) throw new Error("backfill");
      return (await r.json()) as BfPage;
    };
    const persist = (convId: string, p: BfPage) =>
      putMessages(p.messages.map((m) => ({ businessId, kind: "wa" as const, threadId: convId, msgId: m.id, body: m.body, senderName: m.senderName, dir: m.dir, ts: m.ts })));
    const run = async () => {
      await sleep(10000); // let the app settle first
      // Su propia lista, no la ventana visible: el caché respalda la búsqueda por texto y su
      // cobertura no debe depender de los filtros que el agente tenga puestos. Pero ACOTADA: era
      // la lista completa sin límite —- una consulta pesada 10 s después de CADA entrada al chat,
      // incluso cuando ya no quedaba nada por sembrar. 300 por recencia cubre de sobra los 90 días
      // que el caché guarda.
      const recent = (await liveListPage(businessId, { scope: "all", limit: 300 }).catch(() => null))?.rows ?? [];
      for (const c of recent) {
        if (stop) return;
        if ((c.last_message_at ?? "") < CUTOFF) continue;
        const key = `bf:${businessId}:${c.id}`;
        const cur = (await getMeta(key)) as string | null; // "done" | oldest-cursor | null
        if (cur === "done") continue;
        try {
          let cursor: string | null = cur;
          for (let i = 0; i < 25 && !stop; i++) { // hard cap per conv per session
            const p = await fetchPage(c.id, cursor);
            if (stop) return;
            await persist(c.id, p);
            if (p.pageSize < 50 || !p.oldest || p.oldest < CUTOFF) { await setMeta(key, "done"); break; }
            cursor = p.oldest;
            await setMeta(key, cursor);
            await sleep(2500);
          }
        } catch { /* offline / auth hiccup — retry next session */ }
        await sleep(2500);
      }
    };
    run();
    return () => { stop = true; };
    // Deliberately keyed on businessId only: one sweep per mount over the initial list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  // Targeted refresh used by click handlers instead of refresh(): refetches the open
  // conversation (incl. notes/orders, which aren't realtime-published) + the list — not the route.
  const softRefresh = useCallback(() => {
    const id = detailIdRef.current;
    if (id) liveDetail(id).then((d) => { if (d) setDetail((c) => (c && c.id === d.id ? d : c)); }).catch(() => {});
    refetchListRef.current();
  }, []);

  // Solo el encabezado + la lista. Ver ChatHeaderRefreshContext: para un cambio de estado o de
  // asignado, volver a traer el hilo completo y repintarlo es trabajo tirado.
  const headerRefresh = useCallback(() => {
    const id = detailIdRef.current;
    if (id) liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {});
    refetchListRef.current();
  }, []);

  // Live updates via targeted refetches (no full route refresh — only what changed).
  useEffect(() => {
    const supabase = createClient();
    let tl: ReturnType<typeof setTimeout>, tm: ReturnType<typeof setTimeout>, th: ReturnType<typeof setTimeout>, down: ReturnType<typeof setTimeout>;
    const softList = () => { clearTimeout(tl); tl = setTimeout(() => { refetchListRef.current(); }, 250); };
    const softMsgs = () => { const id = detailIdRef.current; if (!id) return; clearTimeout(tm); tm = setTimeout(() => { liveMessages(id).then((ms) => setDetail((c) => (c && c.id === id ? { ...c, messages: mergeMsgs(c.messages, ms) } : c))).catch(() => {}); }, 120); };
    const softHeader = () => { const id = detailIdRef.current; if (!id) return; clearTimeout(th); th = setTimeout(() => { liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {}); }, 250); };
    let lastCatchUp = 0;
    const stop = keepSubscribed(supabase, `chat-${businessId}`, (ch) => ch
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, (p) => {
        const cid = (p.new as { conversation_id?: string })?.conversation_id ?? (p.old as { conversation_id?: string })?.conversation_id;
        if (cid && cid === detailIdRef.current) softMsgs();
        softList();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, (p) => {
        const cid = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (cid && cid === detailIdRef.current) softHeader();
        softList();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `business_id=eq.${businessId}` }, () => { softHeader(); softList(); })
      , {
      // El canal ahora se reconecta solo (backoff + re-auth del socket). El banner deja de ser la
      // única salida: solo avisa mientras dura la caída, y al volver se pone al día en vez de
      // exigir recargar. Antes, un socket muerto se quedaba muerto hasta que el agente recargaba.
      onHealthy: (reconnected) => {
        realtimeHealthyRef.current = true;
        clearTimeout(down); // un parpadeo más corto que el debounce nunca enciende el banner
        setRealtimeDown(false);
        // Ponerse al día cuesta media docena de lecturas. Con una conexión que va y viene —- un
        // teléfono cambiando de antena —- eso se dispara una y otra vez sin traer nada nuevo, así
        // que se pone un mínimo de 5 s entre puestas al día. La primera de una caída real entra
        // siempre; las repeticiones de un parpadeo, no.
        if (reconnected && Date.now() - lastCatchUp > 5000) {
          lastCatchUp = Date.now();
          refetchListRef.current(); softMsgs(); softHeader(); resyncRef.current?.();
        }
      },
      onDown: () => {
        realtimeHealthyRef.current = false;
        clearTimeout(down); down = setTimeout(() => setRealtimeDown(true), 6000);
      },
    });
    return () => { clearTimeout(tl); clearTimeout(tm); clearTimeout(th); clearTimeout(down); stop(); };
  }, [businessId]);

  // Resync al recuperar el foco: una pestaña dormida puede perder eventos aunque el canal siga
  // "vivo" (los navegadores estrangulan sockets y timers en segundo plano) — y entonces los chats
  // nuevos "aparecen horas después" al primer refetch casual. Umbral de 30 s para que alt-tabear
  // no dispare nada, y debounce por si visibilitychange parpadea. Costo: una pasada de lista +
  // mensajes por regreso real a la pestaña — lo mismo que UN evento realtime.
  useEffect(() => {
    let hiddenAt = 0;
    let t: ReturnType<typeof setTimeout>;
    const onVis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 30_000) return;
      hiddenAt = 0;
      clearTimeout(t);
      t = setTimeout(() => {
        if (isBuildStale()) return; // BuildSkewGuard recarga; sondear un build viejo solo quema servidor
        refetchListRef.current();
        const id = detailIdRef.current;
        if (id) {
          liveMessages(id).then((ms) => setDetail((c) => (c && c.id === id ? { ...c, messages: mergeMsgs(c.messages, ms) } : c))).catch(() => {});
          liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {});
        }
      }, 400);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [businessId]);

  /**
   * Red de seguridad: sondeo mientras el realtime está caído. ENCENDIDO.
   *
   * Estuvo apagado a propósito —- con el canal sano sondear es gasto puro, y para la caída bastaba
   * el aviso de "recarga". En un teléfono ese trato no sale a cuenta: la app instalada se congela
   * en segundo plano, el socket se muere sin avisar, y al volver lo que había era una lista
   * detenida y un cartel pidiendo recargar. Pedirle a alguien que recargue una app es admitir que
   * no funciona.
   *
   * Sigue sin ser un sondeo constante: solo pide mientras el canal NO está sano y solo con la
   * pantalla a la vista; con el canal bien, un repaso cada 30 s. Y ahora es barato de verdad,
   * porque estas lecturas ya no van por la cola de acciones de servidor (ver src/lib/chatLive.ts).
   */
  const ENABLE_SAFETY_POLL = true;
  useEffect(() => {
    if (!ENABLE_SAFETY_POLL) return;
    let last = 0;
    const resync = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      last = Date.now();
      const id = detailIdRef.current;
      if (id) {
        liveMessages(id).then((ms) => setDetail((c) => (c && c.id === id ? { ...c, messages: mergeMsgs(c.messages, ms) } : c))).catch(() => {});
        liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {});
      }
      refetchListRef.current();
    };
    resyncRef.current = resync;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // Con el build viejo las actions ya no existen: seguir sondeando solo gasta servidor y los
      // errores acabarían en un catch vacío. BuildSkewGuard se encarga de recargar.
      if (isBuildStale()) return;
      if (!realtimeHealthyRef.current || Date.now() - last >= 30000) resync(); // poll only while down; 30s backstop
    };
    const i = setInterval(tick, 4000);
    const onFocus = () => resync();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(i); resyncRef.current = () => {}; document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [businessId]);

  // Mark a conversation read when it's open and it has unread (incl. messages that arrive while open).
  useEffect(() => {
    if (detail && detail.unread > 0) { markConvRead(detail.id); setDetail((c) => (c ? { ...c, unread: 0 } : c)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detail?.unread]);

  /**
   * Retirar de la bandeja del sistema lo que ya se leyó.
   *
   * El aviso está para decir que hay algo sin leer; leído, sobra. Se hace en dos momentos: al abrir
   * un chat (el suyo) y al volver a la app (todos los que la lista da ya por leídos —- así se limpia
   * también lo que se leyó desde la computadora). Los chats que NO has mirado se quedan: barrerlo
   * todo al abrir la app convertiría abrirla en una forma de perder recados.
   */
  useEffect(() => {
    const sweep = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const leidos = listRef.current.filter((c) => !c.unread).map((c) => c.id);
      const abierto = detailIdRef.current;
      if (abierto) leidos.push(abierto);
      void clearNotificationsFor(leidos);
    };
    sweep();
    document.addEventListener("visibilitychange", sweep);
    window.addEventListener("focus", sweep);
    return () => { document.removeEventListener("visibilitychange", sweep); window.removeEventListener("focus", sweep); };
  }, [detail?.id, list]);

  // Remember the last chat the agent actually opened (cookie → the server page reopens it
  // when returning to /chat without an explicit ?c). Only persist when the chat was opened
  // via the URL, so the most-recent default doesn't overwrite it.
  useEffect(() => {
    if (detail && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("c") === detail.id) {
      document.cookie = `ht_lastChat_${businessId}=${detail.id}; path=/; max-age=2592000; SameSite=Lax`;
    }
  }, [detail?.id]);

  // Deep link (?c= — global search, Clientes, notifications): make sure the opened chat is actually
  // visible. If it doesn't belong to the current tab (e.g. assigned to someone else while on
  // "Míos"), switch to the tab that contains it instead of showing "pick a conversation".
  useEffect(() => {
    if (!selectedId || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("c") !== selectedId) return;
    const assignee = list.find((c) => c.id === selectedId)?.assignee_id ?? detailProp?.assignee_id ?? null;
    setTab((t) => {
      if (t === "all") return t;
      if (t === "mine" && assignee === meId) return t;
      if (t === "unassigned" && assignee == null) return t;
      return assignee === meId ? "mine" : "all";
    });
    // Keyed on the deep-linked chat only — list/detailProp are read once at open time so live
    // reassignments don't yank the tab from under the agent later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Center column: show/hide + drag-resize (persisted).
  // El LAYOUT móvil lo resuelve todo el CSS (ver `--chat-cols` y `hide-mobile`), a propósito: si
  // dependiera de esto, cada carga en un teléfono pintaría un cuadro con el layout de escritorio
  // antes de que JS alcance a medir la ventana. Esto queda solo para una decisión de COMPORTAMIENTO
  // que el CSS no puede tomar: en móvil el botón del panel del cliente abre el 360 a pantalla
  // completa en vez de mostrar una columna que no cabe.
  const isMobile = useIsMobile();
  const [ctxVisible, setCtxVisible] = useState(true);
  // El panel del cliente como hoja a pantalla completa en móvil. Antes ese botón abría el 360, y
  // eso RECORTABA opciones: el 360 es "Historial completo" —- pedidos, historial y notas en
  // pestañas —- mientras que el panel central trae además el menú de Acciones (transferir, cambiar
  // estado, etiquetar, crear pedido) y es desde donde se abre el propio 360. En el teléfono hay que
  // poder hacer lo mismo que en escritorio, no menos.
  const [wsSheet, setWsSheet] = useState(false);
  useEffect(() => { setWsSheet(false); }, [detail?.id]);
  const [ctxW, setCtxW] = useState(360);
  const [listW, setListW] = useState(300);
  useEffect(() => {
    try {
      const v = localStorage.getItem("ht_ctxVisible");
      const w = localStorage.getItem("ht_ctxW");
      const lw = localStorage.getItem("ht_listW");
      if (v != null) setCtxVisible(v === "true");
      if (w != null) setCtxW(Math.max(280, Math.min(680, Number(w) || 360)));
      if (lw != null) setListW(Math.max(240, Math.min(480, Number(lw) || 300)));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("ht_ctxVisible", String(ctxVisible)); } catch {} }, [ctxVisible]);
  useEffect(() => { try { localStorage.setItem("ht_ctxW", String(ctxW)); } catch {} }, [ctxW]);
  useEffect(() => { try { localStorage.setItem("ht_listW", String(listW)); } catch {} }, [listW]);

  const startListResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const listEl = (e.currentTarget as HTMLElement).parentElement;
    if (!listEl) return;
    const left = listEl.getBoundingClientRect().left;
    const onMove = (ev: PointerEvent) => setListW(Math.max(240, Math.min(480, ev.clientX - left)));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const ctxEl = (e.currentTarget as HTMLElement).parentElement;
    if (!ctxEl) return;
    const left = ctxEl.getBoundingClientRect().left;
    const onMove = (ev: PointerEvent) => setCtxW(Math.max(280, Math.min(680, ev.clientX - left)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string | null>("active"); // default: open + pending
  const [showArchived, setShowArchived] = useState(false);
  const [purging, setPurging] = useState(false);
  const [areaF, setAreaF] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Multi-select (long-press to start): bulk status / assign / delete on the chat list.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMenu, setBulkMenu] = useState<{ kind: "status" | "agent"; rect: DOMRect } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const justLongPressed = useRef(false);
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); setBulkMenu(null); };
  const startPress = (id: string) => { clearTimeout(pressTimer.current); pressTimer.current = setTimeout(() => { justLongPressed.current = true; setSelectMode(true); setSelected((s) => new Set(s).add(id)); }, 450); };
  const cancelPress = () => clearTimeout(pressTimer.current);
  const convClick = (e: React.MouseEvent, c: ConvListItem) => {
    if (justLongPressed.current) { justLongPressed.current = false; e.preventDefault(); return; }
    if (selectMode) { e.preventDefault(); toggleSel(c.id); return; }
    // Modifier clicks keep the browser's own behaviour (new tab/window) — the href is real.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); // no route navigation: openConv swaps the detail and rewrites the URL
    openConv(c);
  };
  const runBulk = (fn: () => Promise<void>) => { if (!selected.size) return; setBulkMenu(null); (async () => { await fn(); refetchListRef.current(); exitSelect(); })(); };
  // Bulk reassign: warn if any selected chat is pinned ("mantener conmigo") — reassigning releases it.
  const runBulkAssign = async (agentId: string | null) => {
    setBulkMenu(null);
    const lockedN = [...selected].filter((id) => list.find((c) => c.id === id)?.locked_to).length;
    if (lockedN) {
      const ok = await ask({
        icon: "lock", danger: true,
        title: lang === "es" ? "Clientes mantenidos" : "Pinned clients",
        message: lang === "es"
          ? `${lockedN} chat(s) están mantenidos con un agente. Reasignarlos soltará el candado. ¿Continuar?`
          : `${lockedN} chat(s) are pinned to an agent. Reassigning will release the pin. Continue?`,
        confirmLabel: lang === "es" ? "Reasignar" : "Reassign",
        cancelLabel: lang === "es" ? "Mantener" : "Keep",
      });
      if (!ok) return;
    }
    runBulk(() => bulkAssign([...selected], agentId));
  };

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const trashView = statusF === "trash";

  // --- server-side list window -------------------------------------------------------------
  // Filtering, ordering and every counter run in Postgres now; the client holds a window from the
  // top of the list instead of every conversation the business has.
  const LIST_PAGE = 40;
  const [pages, setPages] = useState(1);
  const [listTotal, setListTotal] = useState(listProp.length);
  // Sembrados por el servidor: los chips salen con su número en el primer pintado.
  const [counts, setCounts] = useState<ChatListCounts>(initialCounts ?? EMPTY_CHAT_COUNTS);
  const countsRef = useRef(counts);
  countsRef.current = counts;

  // Lo último conocido de CADA vista, para que cambiar de pestaña pinte al instante y el servidor
  // solo reconcilie. Antes, cada cambio de pestaña dejaba los números y la lista de la vista
  // ANTERIOR en pantalla hasta que llegara el servidor (~0.4-1 s, o varios tras un deploy): se veía
  // como "tarda en actualizar el total". El caché muestra los valores de la última visita —- casi
  // siempre de hace segundos —- y el refetch corrige si algo cambió.
  const countsCacheRef = useRef<Map<string, ChatListCounts>>(new Map());
  const listCacheRef = useRef<Map<string, { rows: ConvListItem[]; total: number }>>(new Map());
  const listKeyOf = (q: ConvQuery, howMany: number) =>
    JSON.stringify([q.tab, q.status, q.areaId, q.unreadOnly, q.archived, q.q, q.extraIds, howMany]);
  // Fila recién aceptada: se mantiene visible en "Míos" aunque un refetch lanzado ANTES del commit
  // del servidor regrese sin ella —- sin esto, la fila aparecía, desaparecía y volvía a aparecer.
  const stickyMineRef = useRef<{ row: ConvListItem; until: number } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  // Una lectura que falla ya no es invisible: la lista se queda con lo que tenía y esto lo dice.
  const [listError, setListError] = useState(false);
  // The typed search, debounced, together with the conversation ids its message text matched in
  // this device's cache. They move as one value so a search costs a single list fetch: last_body is
  // encrypted at rest, so SQL matches the contact name and the local hits are ORed in server-side.
  const [search, setSearch] = useState<{ q: string; ids: string[] }>({ q: "", ids: [] });
  useEffect(() => {
    const needle = q.trim();
    const t = setTimeout(async () => {
      if (!needle) { setSearch({ q: "", ids: [] }); return; }
      const hits = await searchLocal(businessId, needle, 200).catch(() => []);
      setSearch({ q: needle, ids: [...new Set(hits.filter((h) => h.kind === "wa").map((h) => h.threadId))] });
    }, 250);
    return () => clearTimeout(t);
  }, [q, businessId]);

  const listQuery: ConvQuery = useMemo(() => ({
    tab, meId,
    areaId: areaF ?? undefined,
    status: (trashView ? "trash" : (statusF ?? "")) as ConvQuery["status"],
    unreadOnly,
    archived: showArchived,
    q: search.q,
    extraIds: search.ids,
  }), [tab, meId, areaF, statusF, trashView, unreadOnly, showArchived, search]);

  // Any filter change resets the window back to one page.
  listQueryRef.current = listQuery;
  useEffect(() => { setPages(1); }, [listQuery]);

  // Only the newest response may land: a filter change fires a fetch and a page reset, so two can
  // be in flight, and letting a slower stale one win would leave the window out of sync with `pages`.
  const listSeq = useRef(0);
  const fetchList = useCallback(async (query: ConvQuery, howMany: number) => {
    const seq = ++listSeq.current;
    setListLoading(true);
    try {
      const page = await liveListPage(businessId, { ...query, limit: howMany * LIST_PAGE });
      if (seq !== listSeq.current) return;
      let rows = page.rows;
      let total = page.total;
      // El refetch pudo salir antes de que el servidor confirmara el Aceptar: la fila recién
      // aceptada se conserva hasta que el servidor ya la incluya (o pasen unos segundos).
      const sticky = stickyMineRef.current;
      if (sticky && query.tab === "mine") {
        if (rows.some((r) => r.id === sticky.row.id) || Date.now() > sticky.until) stickyMineRef.current = null;
        else { rows = [sticky.row, ...rows]; total += 1; }
      }
      setList(rows);
      setListTotal(total);
      setListError(false);
      listCacheRef.current.set(listKeyOf(query, howMany), { rows, total });
    } catch { if (seq === listSeq.current) setListError(true); /* keep the previous window */ }
    finally { if (seq === listSeq.current) setListLoading(false); }
  }, [businessId]);

  // El servidor ya mandó la primera página con los filtros por defecto: pedirla otra vez al montar
  // es un viaje redundante en el momento más sensible, justo cuando la pantalla acaba de abrir.
  const listMounted = useRef(false);
  useEffect(() => {
    if (!listMounted.current) { listMounted.current = true; return; }
    const hit = listCacheRef.current.get(listKeyOf(listQuery, pages));
    if (hit) {
      // La fila pegajosa aplica también al caché: la vista de "Míos" guardada puede ser anterior
      // al Aceptar que nos trajo aquí.
      const sticky = stickyMineRef.current;
      const rows = sticky && listQuery.tab === "mine" && !hit.rows.some((r) => r.id === sticky.row.id)
        ? [sticky.row, ...hit.rows] : hit.rows;
      setList(rows);
      setListTotal(rows.length > hit.total ? hit.total + 1 : hit.total);
    }
    fetchList(listQuery, pages);
  }, [fetchList, listQuery, pages]);

  // Los contadores solo dependen de área/archivados/pestaña. Iban pegados al fetch de la lista, así
  // que cada tecla del buscador y cada clic en un chip los volvía a pedir sin que pudieran cambiar.
  const countsKey = `${listQuery.tab}|${listQuery.areaId ?? ""}|${listQuery.archived ? 1 : 0}`;
  const countsSeq = useRef(0);
  const countsKeyRef = useRef(countsKey);
  countsKeyRef.current = countsKey;
  const refreshCounts = useCallback(async () => {
    const seq = ++countsSeq.current;
    const [tab, areaId, archived] = countsKey.split("|");
    try {
      const c = await liveChatCounts(businessId, { tab: tab as ConvQuery["tab"], areaId: areaId || undefined, archived: archived === "1" });
      countsCacheRef.current.set(countsKey, c);
      if (seq === countsSeq.current) setCounts(c);
    } catch { /* se conservan los anteriores */ }
  }, [businessId, countsKey]);
  const countsMounted = useRef(false);
  useEffect(() => {
    if (!countsMounted.current && initialCounts) {
      // initialCounts ya trae los de la pestaña con la que abre — y siembra el caché de esa vista.
      countsCacheRef.current.set(countsKeyRef.current, initialCounts);
      countsMounted.current = true;
      return;
    }
    countsMounted.current = true;
    // Del caché primero: los números de la última visita a esta vista salen al instante en vez de
    // dejar los de la vista anterior congelados mientras contesta el servidor.
    const hit = countsCacheRef.current.get(countsKeyRef.current);
    if (hit) setCounts(hit);
    refreshCounts();
  }, [refreshCounts, initialCounts]);
  useEffect(() => {
    refetchListRef.current = () => {
      void fetchList(listQuery, pages);
      void refreshCounts();
      // Lo que mueve la lista mueve también los números de la barra de arriba (no leídos, campana).
      // El Shell escucha esto para adelantarse a su propio realtime: al marcar leído, la campana
      // baja al instante en vez de esperar a que el aviso dé la vuelta por el servidor.
      try { window.dispatchEvent(new Event("ht:badges")); } catch { /* SSR */ }
    };
  }, [fetchList, listQuery, pages, refreshCounts]);

  const filtered = list;
  const chipCounts = counts;
  const archivedN = counts.archived;
  const mineN = counts.mine;
  const unN = counts.unassigned;
  const hasMore = list.length < listTotal;

  // The open chat belongs to the current tab only if its (live) assignment matches it. This keeps
  // a leftover/default-open chat from another tab (e.g. an unassigned one while on "Míos") from
  // showing — we surface the "pick a conversation" indicator instead.
  // Un chat que pasa a ser mío: la lista salta a "Míos" y el hilo abierto se queda donde está.
  // Lo usan Aceptar y los dos Transferir (encabezado y panel), para que se comporten igual.
  const acceptedToMine = useCallback((id: string) => {
    // La fila del chat aceptado viaja con nosotros: al aterrizar en "Míos" ya está ahí, en vez de
    // esperar al servidor —- que era el "tarda la lista en moverse a Míos". El refetch que sale al
    // cambiar de pestaña puede ganarle al commit del Aceptar, así que la fila queda pegajosa unos
    // segundos hasta que el servidor ya la traiga por su cuenta.
    const row = listRef.current.find((c) => c.id === id);
    if (row) stickyMineRef.current = { row: { ...row, assignee_id: meId }, until: Date.now() + 8000 };
    setTab("mine");
    setDetail((d) => (d && d.id === id ? { ...d, assignee_id: meId } : d));
    setList((l) => l.map((c) => (c.id === id ? { ...c, assignee_id: meId } : c)));
  }, [meId]);

  const detailInView = useMemo(() => {
    if (!detail) return false;
    const assignee = (list.find((c) => c.id === detail.id)?.assignee_id) ?? detail.assignee_id;
    if (tab === "mine") return assignee === meId;
    if (tab === "unassigned") return assignee == null;
    return true;
  }, [detail, list, tab, meId]);

  async function emptyTrash() {
    const ok = await ask({
      icon: "trash", danger: true,
      title: lang === "es" ? "Vaciar papelera" : "Empty trash",
      message: lang === "es"
        ? `Se eliminan ${chipCounts.trash} chat(s) sin actividad en 90+ días y TODOS sus mensajes. No se puede deshacer.`
        : `${chipCounts.trash} chat(s) inactive for 90+ days and ALL their messages will be deleted. This can't be undone.`,
      confirmLabel: lang === "es" ? "Eliminar todos" : "Delete all",
      cancelLabel: lang === "es" ? "Volver" : "Back",
    });
    if (!ok) return;
    setPurging(true);
    try { await emptyChatTrash(businessId); refetchListRef.current(); }
    catch { alert(lang === "es" ? "No se pudo vaciar la papelera." : "Couldn't empty the trash."); }
    setPurging(false);
  }

  return (
    <ChatRefreshContext.Provider value={softRefresh}>
    <ChatHeaderRefreshContext.Provider value={headerRefresh}>
    <ChatPatchContext.Provider value={patchDetail}>
    <div
      className="chat"
      style={{
        position: "relative",
        // Se escribe una VARIABLE, no `grid-template-columns`. Un valor inline le gana a cualquier
        // @media —- por eso la regla de una columna llevaba tiempo sin aplicarse nunca —- pero una
        // variable no: la media query redefine la propiedad y el ancho de escritorio se ignora
        // solo. Así el layout móvil sale bien desde el PRIMER pintado, sin esperar a que JS mida
        // la ventana. Ver `.chat` en views.css.
        ["--chat-cols" as string]: detail && detailInView && ctxVisible
          ? `${listW}px ${ctxW}px minmax(300px,1fr)`
          : `${listW}px minmax(300px,1fr)`,
      } as React.CSSProperties}
    >
      {realtimeDown && (
        <div className="rt-banner">
          <Icon name="wifioff" size={15} />
          {/* Ya no es "recarga o no te enteras": mientras el canal está caído, el sondeo de arriba
              mantiene la lista al día. El aviso explica por qué va más lento, y recargar queda
              como atajo, no como única salida. */}
          <span className="grow">{lang === "es" ? "Sin conexión en vivo: actualizando cada pocos segundos." : "No live connection: refreshing every few seconds."}</span>
          <button className="btn btn-sm btn-dark" onClick={() => window.location.reload()}><Icon name="refresh" size={13} />{lang === "es" ? "Recargar" : "Reload"}</button>
          <button className="rt-banner-x" onClick={() => setRealtimeDown(false)} aria-label={lang === "es" ? "Descartar" : "Dismiss"}><Icon name="x" size={14} /></button>
        </div>
      )}
      {/* list column */}
      {/* `hide-mobile` por fin se usa: la clase existía en views.css desde hace mucho y no la ponía
          nadie, así que en un teléfono salían lista e hilo aplastados uno junto al otro. No se
          consulta `isMobile` a propósito —- la clase solo hace algo dentro de la media query, y
          preguntarle a JS habría dejado un cuadro con las dos columnas en cada carga. */}
      <div className={"chatcol list" + (detail && detailInView ? " hide-mobile" : "")} style={{ position: "relative" }}>
        <div className="col-resizer" onPointerDown={startListResize} title="" />
        <div className="col-head">
          <div className="seg" style={{ width: "100%" }}>
            {([["mine", lang === "es" ? "Míos" : "Mine", mineN], ["unassigned", lang === "es" ? "Sin asignar" : "Unassigned", unN], ["all", lang === "es" ? "Todos" : "All", null]] as const).map(([id, lbl, n]) => (
              <button key={id} className={tab === id ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab(id)}>
                {lbl}{n != null && n > 0 && <span className="badge badge-soft">{n}</span>}
              </button>
            ))}
          </div>
          {/* Cambiar de pestaña y que no pase nada era el peor de los dos males: sin error, parecía
              que "Míos" y "Todos" tenían lo mismo. Si la lectura falló, se dice y se ofrece salida. */}
          {listError && (
            <button className="btn btn-sm btn-outline" style={{ width: "100%", color: "var(--red)", borderColor: "var(--red)" }}
              onClick={() => { setListError(false); refetchListRef.current(); }}>
              <Icon name="wifioff" size={13} />{lang === "es" ? "No se pudo actualizar · Reintentar" : "Couldn't refresh · Retry"}
            </button>
          )}
          <div className="row gap-2">
            <div className="field field-sm field-filled grow">
              <Icon name="search" />
              <input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-primary" title={lang === "es" ? "Nueva conversación" : "New conversation"} onClick={() => setShowCompose(true)}><Icon name="plus" size={15} /></button>
          </div>
          <div className="chip-row">
            <button className={"chip" + (statusF === "active" ? " on" : "")} onClick={() => { setStatusF("active"); setUnreadOnly(false); }}>
              {lang === "es" ? "Activos" : "Active"}<span className="chip-n">{chipCounts.active}</span>
            </button>
            <button className={"chip" + (!statusF && !unreadOnly ? " on" : "")} onClick={() => { setStatusF(null); setUnreadOnly(false); }}>
              {lang === "es" ? "Todos" : "All"}<span className="chip-n">{chipCounts.all}</span>
            </button>
            {(["open", "pending", "resolved"] as const).map((s) => (
              <button key={s} className={"chip" + (statusF === s ? " on" : "")} onClick={() => setStatusF(statusF === s ? null : s)}>
                <span className="chip-dot" style={{ background: `var(--${STATUS_COLOR[s]})` }} />{STATUS_LABEL[s][lang]}<span className="chip-n">{chipCounts[s]}</span>
              </button>
            ))}
            <button className={"chip" + (unreadOnly ? " on" : "")} onClick={() => setUnreadOnly((v) => !v)}>
              <span className="chip-dot" style={{ background: "var(--red)" }} />{lang === "es" ? "No leídos" : "Unread"}{chipCounts.unread > 0 && <span className="chip-n">{chipCounts.unread}</span>}
            </button>
            {areas.length > 0 && (
              // By id, not name — the filter runs in SQL now, and the options come from the full
              // area list instead of whatever happens to be inside the loaded window.
              <select className="select select-sm chip-select" value={areaF ?? ""} onChange={(e) => setAreaF(e.target.value || null)}>
                <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <button className={"chip" + (showArchived ? " on" : "")} onClick={() => setShowArchived((v) => !v)} title={lang === "es" ? "Pospuestos/Ocultos" : "Snoozed/Hidden"}>
              <Icon name="clock" size={12} />{lang === "es" ? "Pospuestos" : "Snoozed"}{archivedN > 0 && <span className="chip-n">{archivedN}</span>}
            </button>
            <button className={"chip" + (trashView ? " on" : "")} onClick={() => setStatusF(trashView ? "active" : "trash")} title={lang === "es" ? "Chats sin actividad en 90+ días" : "Chats inactive 90+ days"}>
              <Icon name="trash" size={12} />{lang === "es" ? "Papelera" : "Trash"}{chipCounts.trash > 0 && <span className="chip-n">{chipCounts.trash}</span>}
            </button>
          </div>
          {trashView && (
            <div className="row gap-2" style={{ alignItems: "center", padding: "2px 2px 0" }}>
              <span className="t-xs muted grow">{lang === "es" ? "Chats sin actividad en 90+ días. El contacto se conserva." : "Chats inactive for 90+ days. The contact is kept."}</span>
              <button className="btn btn-sm btn-danger" disabled={purging || chipCounts.trash === 0} onClick={emptyTrash}>{purging ? <Spinner size={14} /> : <Icon name="trash" size={14} />}{lang === "es" ? "Eliminar todos" : "Delete all"}</button>
            </div>
          )}
        </div>
        {selectMode && (
          <div className="row gap-2" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", alignItems: "center", background: "var(--surface-2)", flex: "none" }}>
            <button className="iconbtn sm" onClick={exitSelect} aria-label="cancel"><Icon name="x" size={16} /></button>
            <span className="t-sm" style={{ fontWeight: 700 }}>{selected.size}</span>
            <span className="grow" />
            <button className="btn btn-sm btn-outline" disabled={!selected.size} onClick={(e) => setBulkMenu({ kind: "status", rect: e.currentTarget.getBoundingClientRect() })} title={lang === "es" ? "Estado" : "Status"}><Icon name="dot" size={13} /></button>
            <button className="btn btn-sm btn-outline" disabled={!selected.size} onClick={(e) => setBulkMenu({ kind: "agent", rect: e.currentTarget.getBoundingClientRect() })} title={lang === "es" ? "Asignar" : "Assign"}><Icon name="agents" size={13} /></button>
            <button className="btn btn-sm btn-danger" disabled={!selected.size} onClick={async () => { if (await ask({ icon: "trash", danger: true, title: lang === "es" ? `Eliminar ${selected.size} chat(s)` : `Delete ${selected.size} chat(s)`, message: lang === "es" ? "Se borran también sus mensajes. No se puede deshacer." : "Their messages are deleted too. This can't be undone.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) runBulk(() => bulkDeleteConvs([...selected])); }} title={lang === "es" ? "Eliminar" : "Delete"}><Icon name="trash" size={13} /></button>
          </div>
        )}
        {bulkMenu && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setBulkMenu(null)} />
            <div className="menu scroll" style={menuStyle(bulkMenu.rect, { width: 210, height: 280, align: "right" })}>
              {bulkMenu.kind === "status"
                ? (["open", "pending", "resolved"] as const).map((s) => <button key={s} className="menu-item" onClick={() => runBulk(() => bulkSetStatus([...selected], s))}><Pill color={STATUS_COLOR[s]} dot>{STATUS_LABEL[s][lang]}</Pill></button>)
                : <>
                    <button className="menu-item" onClick={() => runBulkAssign(null)}><Pill color="slate">{lang === "es" ? "Sin asignar" : "Unassigned"}</Pill></button>
                    {agents.filter((a) => a.role !== "viewer").map((a) => <button key={a.id} className="menu-item" onClick={() => runBulkAssign(a.id)}><Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} src={a.avatar_url ?? undefined} size={20} />{a.name}</button>)}
                  </>}
            </div>
          </>
        )}
        <div className="col-scroll scroll">
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "56px 24px" }}>
              <div className="empty-art"><Icon name="chat" /></div>
              <h3>{lang === "es" ? "Sin conversaciones" : "No conversations"}</h3>
              <p className="muted t-sm">{lang === "es" ? "Las conversaciones aparecerán aquí cuando lleguen mensajes." : "Conversations will appear here as messages arrive."}</p>
            </div>
          ) : (
            filtered.map((c) => {
              const a = c.assignee_id ? agentMap.get(c.assignee_id) : null;
              return (
                // Plain <a>, not <Link>: Link would prefetch the RSC payload of the whole /chat
                // route for every visible row. The href stays real so cmd-click still opens a tab.
                <a key={c.id} href={`/chat?c=${c.id}`} onMouseEnter={() => prefetchDetail(c.id)} onClick={(e) => convClick(e, c)}
                  onPointerDown={() => startPress(c.id)} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerMove={cancelPress} onContextMenu={(e) => { if (selectMode) e.preventDefault(); }}
                  className={"conv" + (c.id === (detail?.id ?? selectedId) && !selectMode ? " sel" : "") + (c.unread ? " unread" : "")}
                  style={selectMode && selected.has(c.id) ? { background: "var(--brand-50)" } : undefined}>
                  {selectMode && <span style={{ width: 22, height: 22, borderRadius: "50%", flex: "none", border: "2px solid " + (selected.has(c.id) ? "var(--brand)" : "var(--border-strong)"), background: selected.has(c.id) ? "var(--brand)" : "transparent", color: "var(--on-brand)", display: "flex", alignItems: "center", justifyContent: "center" }}>{selected.has(c.id) && <Icon name="check" size={13} />}</span>}
                  <Avatar name={c.contact?.name} initials={deriveInitials(c.contact?.name || c.contact?.phone || "?")} color={avatarColor(c.contact?.phone)} size={42}
                    badge={a ? { initials: deriveInitials(a.name), color: a.color, src: a.avatar_url, title: (lang === "es" ? "Atiende " : "Handled by ") + a.name } : null} />
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name truncate">{c.is_group && <span style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 4, opacity: 0.6 }} title={lang === "es" ? "Grupo" : "Group"}><Icon name="agents" size={13} /></span>}{c.contact?.name ?? "—"}</span>
                      <span className="conv-time">{relTime(c.last_message_at, lang)}</span>
                    </div>
                    <div className="conv-prev truncate">{isTyping(c.typing_until) ? <span className="typing-ind">{lang === "es" ? "escribiendo…" : "typing…"}</span> : <>{c.lastOut && <span style={{ marginRight: 3, verticalAlign: "middle" }}><Tick state={c.lastState} /></span>}{msgPreview(c, lang)}</>}</div>
                    <div className="conv-meta">
                      {c.snoozed_until && new Date(c.snoozed_until).getTime() > Date.now()
                        ? <Pill color="violet"><Icon name="clock" size={11} />{new Date(c.snoozed_until).toLocaleString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Pill>
                        : <Pill color={STATUS_COLOR[c.status]} dot>{STATUS_LABEL[c.status][lang]}</Pill>}
                      {c.hidden && <Pill color="slate"><Icon name="eye" size={11} /></Pill>}
                      {c.locked_to && <Pill color="amber" title={lang === "es" ? "Mantenido con un agente" : "Pinned to an agent"}><Icon name="lock" size={11} /></Pill>}
                      {c.muted && <Pill color="slate" title={lang === "es" ? "Chat desconectado — no se guardan mensajes" : "Chat disconnected — messages not saved"}><Icon name="wifioff" size={11} /></Pill>}
                      {c.area && <Pill color={c.area.color as PillColor}>{c.area.name}</Pill>}
                      {(c.contact?.tags ?? []).slice(0, 3).map((tg) => <Pill key={tg} color={tagColor(tg)}><Icon name="tag" size={10} />{tg}</Pill>)}
                      <span className="grow" />
                      {/* El asesor vive como insignia sobre el avatar; aquí solo queda la ausencia,
                          que montada no se vería. */}
                      {!a && <Pill color="slate">{lang === "es" ? "Sin asignar" : "Unassigned"}</Pill>}
                      {c.unread > 0 && <span className="badge badge-red">{c.unread}</span>}
                    </div>
                  </div>
                </a>
              );
            })
          )}
          {hasMore && (
            <button className="btn btn-sm btn-ghost" style={{ width: "100%", margin: "8px 0" }}
              disabled={listLoading} onClick={() => setPages((p) => p + 1)}>
              {listLoading ? <Spinner size={14} /> : null}
              {lang === "es" ? `Cargar más (${list.length} de ${listTotal})` : `Load more (${list.length} of ${listTotal})`}
            </button>
          )}
        </div>
      </div>

      {detail && detailInView ? (
        <>
          {ctxVisible && <Workspace detail={detail} agents={agents} areas={areas} stages={stages} products={products} meId={meId} businessId={businessId} connected={connected} invoice={invoice} shipping={shipping} invoicing={invoicing} onResizeStart={startResize} onOpen360={() => setShow360(true)} onAssignedToMe={acceptedToMine} doneFromStageId={doneFromStageId} manualMarginPct={manualMarginPct} />}
          {/* En móvil el panel del cliente no cabe como columna: el mismo botón lo abre como hoja
              a pantalla completa, con TODO lo que tiene en escritorio. */}
          <Thread detail={detail} agents={agents} areas={areas} connected={connected}
            ctxVisible={isMobile ? wsSheet : ctxVisible}
            onToggleCtx={isMobile ? () => setWsSheet((v) => !v) : () => setCtxVisible((v) => !v)}
            onBack={closeConv}
            businessId={businessId} meId={meId} onAccepted={acceptedToMine} />
          {isMobile && wsSheet && (
            <div className="ws-sheet" role="dialog" aria-modal="true">
              <div className="ws-sheet-head">
                <button className="iconbtn" onClick={() => setWsSheet(false)} aria-label={lang === "es" ? "Volver al chat" : "Back to chat"}><Icon name="arrowl" size={20} /></button>
                <strong className="grow truncate">{detail.contact?.name}</strong>
              </div>
              {/* El MISMO componente que la columna de escritorio, no una copia: así una función
                  nueva sale en los dos lados sin trabajo extra (skill feature-surfaces). El
                  redimensionador se anula —- en móvil no hay columnas que redimensionar. */}
              <Workspace detail={detail} agents={agents} areas={areas} stages={stages} products={products}
                meId={meId} businessId={businessId} connected={connected} invoice={invoice}
                shipping={shipping} invoicing={invoicing} onResizeStart={() => {}}
                onOpen360={() => { setWsSheet(false); setShow360(true); }}
                onAssignedToMe={acceptedToMine} doneFromStageId={doneFromStageId} manualMarginPct={manualMarginPct} />
            </div>
          )}
          {show360 && <CustomerOverlay detail={detail} agents={agents} areas={areas} stages={stages} products={products} businessId={businessId} connected={connected} doneFromStageId={doneFromStageId} manualMarginPct={manualMarginPct} onClose={() => setShow360(false)} />}
        </>
      ) : (
        /* `chat-pick`: en móvil esto NO se pinta. La rejilla es de una columna, así que el
           placeholder no se pone "al lado" de la lista —- se pone DEBAJO, en una segunda fila, y la
           pantalla quedaba partida en dos: media lista arriba y "Elige una conversación" abajo.
           Sin chat abierto, la lista ES la pantalla. */
        <div className="chatcol center chat-pick" style={{ gridColumn: "2 / -1", background: "var(--bg)" }}>
          <div className="empty">
            <div className="empty-art"><Icon name="chat" /></div>
            <h3>{lang === "es" ? "Elige una conversación" : "Pick a conversation"}</h3>
            <p>{lang === "es" ? "Selecciona un chat de la lista." : "Select a chat from the list."}</p>
          </div>
        </div>
      )}
      {showCompose && <NewConversationModal lang={lang} onClose={() => setShowCompose(false)} onStarted={(id) => { setShowCompose(false); router.push(`/chat?c=${id}`); router.refresh(); }} />}
    </div>
    </ChatPatchContext.Provider>
    </ChatHeaderRefreshContext.Provider>
    </ChatRefreshContext.Provider>
  );
}

/* ---------- New conversation (compose) ---------- */
function NewConversationModal({ lang, onClose, onStarted }: { lang: "es" | "en"; onClose: () => void; onStarted: (convId: string) => void }) {
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    setErr(null);
    start(async () => {
      const r = await startConversation(phone, msg);
      if (!r.ok || !r.convId) {
        setErr(
          r.error === "invalid-phone" ? (lang === "es" ? "Número inválido — incluye el código de país." : "Invalid number — include the country code.")
            : r.error === "empty-message" ? (lang === "es" ? "Escribe un primer mensaje." : "Type a first message.")
              : (lang === "es" ? "No se pudo iniciar la conversación." : "Couldn't start the conversation."),
        );
        return;
      }
      onStarted(r.convId);
    });
  };
  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="whatsapp" /></span>
          <h3 className="grow">{lang === "es" ? "Nueva conversación" : "New conversation"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          <div className="col gap-1">
            <label className="lbl">{lang === "es" ? "Número de WhatsApp" : "WhatsApp number"}</label>
            <input className="inp-inline" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={lang === "es" ? "+52 55 1234 5678" : "+1 555 123 4567"} />
            <span className="t-xs muted">{lang === "es" ? "Incluye el código de país. El número debe tener WhatsApp." : "Include the country code. The number must be on WhatsApp."}</span>
          </div>
          <div className="col gap-1">
            <label className="lbl">{lang === "es" ? "Primer mensaje" : "First message"}</label>
            <textarea className="inp-inline" style={{ minHeight: 80, resize: "vertical", paddingTop: 6 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={lang === "es" ? "Hola 👋" : "Hi 👋"} />
          </div>
          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !phone.trim() || !msg.trim()} onClick={submit}><Icon name="send" size={15} />{pending ? (lang === "es" ? "Iniciando…" : "Starting…") : (lang === "es" ? "Iniciar" : "Start")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Thread (right column) ---------- */
export function Thread({ detail, agents, areas, connected, ctxVisible, onToggleCtx, onBack, businessId, floating, meId, onAccepted }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; connected: boolean; ctxVisible?: boolean; onToggleCtx?: () => void; /** Solo en móvil: volver a la lista de chats. */ onBack?: () => void; businessId: string; floating?: boolean; meId?: string; onAccepted?: (convId: string) => void }) {
  const { lang } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const refresh = useChatRefresh();
  const headerRefresh = useChatHeaderRefresh();
  const patch = useChatPatch();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  const [mentions, setMentions] = useState<{ name: string; jid: string }[]>([]); // pending group @mentions
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionRect, setMentionRect] = useState<DOMRect | null>(null);
  const mentionBtn = useRef<HTMLButtonElement>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Lo que ya estaba escrito viaja al comentario del adjunto.
   *
   * Antes se quedaba huérfano en el campo del chat: escribías "mira cómo quedó", adjuntabas la
   * foto, y el texto se quedaba atrás —- o lo mandabas suelto en otro mensaje. Es casi siempre lo
   * que se quería decir sobre ESE archivo.
   *
   * Solo al abrir (de cero a algo) y solo si el comentario está vacío, para no pisar algo que ya
   * se escribió ahí. Y se recuerda lo que se llevó: al enviar, el campo del chat se limpia SI
   * sigue teniendo exactamente eso —- si mientras tanto se escribió otra cosa, esa otra cosa se
   * respeta. Cancelar tampoco borra nada: el texto nunca se movió, se copió.
   */
  const carried = useRef<string | null>(null);
  function stageFiles(files: FileList | File[]) {
    if (!staged.length && !caption && text.trim()) { setCaption(text); carried.current = text; }
    setStaged((s) => [...s, ...Array.from(files)]);
  }
  const { dragOver, dragProps } = useFileDrop((files) => stageFiles(files));

  // Cancelar SIEMPRE debe funcionar. Antes, si un envío fallaba o se quedaba colgado, el modal
  // quedaba con `sending` en true: la X y el scrim están deshabilitados mientras envía, así que la
  // conversación se quedaba bloqueada hasta recargar o cambiar de chat (que remonta el componente).
  const cancelStaged = () => { setStaged([]); setCaption(""); setSending(false); setSendErr(null); carried.current = null; };

  // Cambiar de conversación no debe arrastrar un envío a medias de la anterior.
  useEffect(() => { setStaged([]); setCaption(""); setSending(false); setSendErr(null); setPendingTpl(null); }, [detail.id]);

  // Upload staged files, then send (caption goes on the first item, like WhatsApp).
  async function sendStaged() {
    if (!staged.length || sending) return;
    setSending(true);
    setSendErr(null);
    const failed: File[] = [];
    // El motivo del primer fallo. "No se pudo enviar 1 de 1" a secas no dice si el archivo pesa
    // demasiado, si se cayó la red o si Storage rechazó la ruta —- y sin eso no hay nada que hacer
    // más que reintentar a ciegas. Se guarda el primero: si fallan varios suele ser el mismo.
    let why = "";
    try {
      for (let i = 0; i < staged.length; i++) {
        const file = staged[i];
        try {
          const up = await uploadMedia(businessId, "out", file);
          // Se guarda la RUTA de storage; el bucket privado se sirve con URLs firmadas al leer.
          await sendMediaMessage(detail.id, { type: mediaTypeOf(up.mime), mediaUrl: up.path, mime: up.mime, name: up.name, caption: i === 0 ? caption.trim() || undefined : undefined, thumb: up.thumb, size: up.size });
        } catch (e) {
          // Un archivo que falla no debe tumbar a los demás ni perderse: se queda en la bandeja
          // para reintentarlo, en vez de desaparecer en silencio como antes.
          console.error(e);
          if (!why) why = e instanceof Error ? e.message : String(e);
          failed.push(file);
        }
      }
      if (failed.length) {
        setStaged(failed);
        const reason = why ? ` ${why}.` : "";
        setSendErr(lang === "es"
          ? `No se pudo enviar ${failed.length} de ${staged.length}.${reason} Puedes reintentar o cancelar.`
          : `Couldn't send ${failed.length} of ${staged.length}.${reason} Retry or cancel.`);
      } else {
        setStaged([]); setCaption("");
        // El texto se fue con el archivo: dejarlo también en el campo del chat invita a mandarlo
        // dos veces. Solo si sigue siendo el mismo que se llevó.
        if (carried.current !== null && text === carried.current) setText("");
        carried.current = null;
      }
      refresh();
    } finally {
      setSending(false); // pase lo que pase, el modal vuelve a ser usable
    }
  }
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // El archivo de una plantilla elegida, esperando a que se pulse enviar. Ver `pickCanned`.
  const [pendingTpl, setPendingTpl] = useState<CannedItem | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [canned, setCanned] = useState<CannedItem[]>([]);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const cannedBtn = useRef<HTMLButtonElement>(null);
  const [emojiRect, setEmojiRect] = useState<DOMRect | null>(null);
  const [cannedRect, setCannedRect] = useState<DOMRect | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useComposerFocus(taRef, detail.id); // cursor listo al abrir/cambiar de chat (igual en el de equipo)
  const [slash, setSlash] = useState<{ q: string; at: number } | null>(null);
  const [slashSel, setSlashSel] = useState(0);
  const [slashRect, setSlashRect] = useState<DOMRect | null>(null);
  const [reactTarget, setReactTarget] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage[] | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerRect, setStickerRect] = useState<DOMRect | null>(null);
  const stickerBtn = useRef<HTMLButtonElement>(null);
  const [stickerTray, setStickerTray] = useState<{ favorites: StickerItem[]; recent: StickerItem[] }>({ favorites: [], recent: [] });
  const [stickerLoading, setStickerLoading] = useState(false);
  const [stickerQuery, setStickerQuery] = useState("");
  const [savingSticker, setSavingSticker] = useState<StickerItem | null>(null); // sticker being added to favorites (name/tags form)
  const [confirmSticker, setConfirmSticker] = useState<StickerItem | null>(null); // sticker awaiting send confirmation
  const { push } = useToast();
  const flowToast = useFlowToast();

  async function loadStickers(showSpinner = true) {
    if (showSpinner) setStickerLoading(true);
    try { setStickerTray(await loadStickerTray(businessId)); } catch {}
    if (showSpinner) setStickerLoading(false);
  }
  // Send a sticker the business already has (re-sends the stored WebP by its path).
  function pickSticker(s: StickerItem) {
    setStickerOpen(false); setConfirmSticker(null);
    setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "sticker", body: null, state: "sent", author_id: null, created_at: new Date().toISOString(), media_url: s.url, media_mime: "image/webp", media_name: null, reply_to: null, deleted: false, forwarded: false, edited: false, meta: null, reactions: [], sender_name: null, sender_jid: null }]);
    start(async () => { await sendSticker(detail.id, s.path); });
  }
  // Persist the favorite with a name + tags (called from the save form), then reconcile.
  function commitFavorite(s: StickerItem, name: string, tags: string[]) {
    setSavingSticker(null);
    setStickerTray((t) => ({
      recent: t.recent.map((x) => (x.path === s.path ? { ...x, fav: true } : x)),
      favorites: t.favorites.some((f) => f.path === s.path) ? t.favorites.map((f) => (f.path === s.path ? { ...f, name, tags } : f)) : [{ ...s, fav: true, name, tags }, ...t.favorites],
    }));
    start(async () => { await saveStickerFavorite(s.path, name, tags); await loadStickers(false); });
  }
  function removeFavorite(s: StickerItem) {
    setStickerTray((t) => ({ recent: t.recent.map((x) => (x.path === s.path ? { ...x, fav: false } : x)), favorites: t.favorites.filter((f) => f.path !== s.path) }));
    start(async () => { await removeStickerFavorite(s.path); await loadStickers(false); });
  }
  // Star clicked → open the favorite editor (add for new, view/edit name+tags for existing).
  function favSticker(s: StickerItem) { setSavingSticker(s); }

  async function loadCanned() {
    if (canned.length) return;
    const supabase = createClient();
    const { data } = await supabase.from("canned_messages").select("id, title, body, shortcut, media_url, media_mime, media_name, media_size, media_thumb").eq("business_id", businessId).order("title");
    setCanned((data ?? []) as CannedItem[]);
  }
  // Load templates once so the "/" shortcut works without opening the picker.
  useEffect(() => { loadCanned(); /* eslint-disable-next-line */ }, []);

  const slashMatches = slash
    ? canned.filter((c) => { const sc = (c.shortcut ?? "").replace(/^\//, "").toLowerCase(); const q = slash.q.toLowerCase(); return sc.includes(q) || c.title.toLowerCase().includes(q); }).slice(0, 6)
    : [];
  function detectSlash(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)\/(\w*)$/);
    if (m) { setSlash({ q: m[1], at: caret - m[1].length - 1 }); setSlashSel(0); if (taRef.current) setSlashRect(taRef.current.getBoundingClientRect()); } else setSlash(null);
  }
  /**
   * Elegir una plantilla PREPARA el mensaje; no lo manda.
   *
   * Mandar en el clic es justo donde se cuela el error: un dedo que resbala en la lista y el
   * cliente recibe la plantilla de otro. Así que pasa lo mismo que al adjuntar un archivo a mano —-
   * el texto queda en el campo y el archivo se ve encima del compositor —- y no sale nada hasta
   * que se pulsa enviar. Hasta entonces se puede corregir, cambiar de plantilla o quitar el
   * archivo.
   *
   * El archivo no se re-sube: `pendingTpl` solo guarda la ruta que ya tenía la plantilla.
   */
  function attachCanned(c: CannedItem) {
    if (c.media_url) setPendingTpl(c);
  }

  function applySlash(c: CannedItem) {
    const el = taRef.current; if (!el || !slash) return;
    const caret = el.selectionStart;
    attachCanned(c);
    const filled = fillVars(c.body);
    const next = text.slice(0, slash.at) + filled + text.slice(caret);
    setText(next); setSlash(null);
    requestAnimationFrame(() => { el.focus(); const p = slash.at + filled.length; el.setSelectionRange(p, p); });
  }
  function fillVars(body: string) {
    const o = detail.orders[0];
    return body
      .replace(/\{\{\s*name\s*\}\}/gi, detail.contact?.name ?? "")
      .replace(/\{\{\s*phone\s*\}\}/gi, detail.contact?.phone ?? "")
      .replace(/\{\{\s*order_number\s*\}\}/gi, o?.code ?? "")
      .replace(/\{\{\s*total\s*\}\}/gi, o ? `$${o.total.toLocaleString("es-MX")}` : "");
  }

  // Windowed message list: start at the recent tail (detail.messages = last page), lazy-load older
  // as the agent scrolls up, and merge realtime updates in place (no full reload, no scroll jump).
  const [msgs, setMsgs] = useState<ChatMessage[]>(detail.messages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(detail.messages.length >= MSG_PAGE);
  // Persist text messages to the per-device cache (bodies are encrypted in the DB, so message
  // search runs locally — the WhatsApp Web model). Best-effort, never blocks rendering.
  useEffect(() => {
    putMessages(msgs.filter((m) => m.body && !m.deleted && !m.id.startsWith("tmp")).map((m) => ({
      businessId, kind: "wa" as const, threadId: detail.id, msgId: m.id,
      body: m.body!, senderName: m.sender_name ?? null, dir: m.direction, ts: m.created_at,
    }))).catch(() => {});
  }, [msgs, businessId, detail.id]);
  const lastConvRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const scrollAction = useRef<"bottom" | "preserve" | "follow">("bottom");
  const prevHeight = useRef(0);

  // useLayoutEffect y no useEffect: al cambiar de chat, con useEffect el navegador alcanzaba a
  // pintar un cuadro con los mensajes del chat anterior (y su scroll) antes del cambio de lista.
  useLayoutEffect(() => {
    if (lastConvRef.current !== detail.id) {
      lastConvRef.current = detail.id;
      scrollAction.current = "bottom";
      seenIds.current = new Set(detail.messages.map((m) => m.id)); // seed: the opening page doesn't animate
      setMsgs(detail.messages);
      setHasMore(detail.messages.length >= MSG_PAGE);
    } else {
      scrollAction.current = "follow";
      setMsgs((prev) => mergeMsgs(prev, detail.messages));
    }
  }, [detail.id, detail.messages]);

  async function loadOlder() {
    if (loadingOlder || !hasMore) return;
    const oldest = msgs[0]?.created_at;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await loadOlderMessages(detail.id, oldest);
      if (older.length < MSG_PAGE) setHasMore(false);
      if (older.length) {
        older.forEach((m) => seenIds.current.add(m.id)); // prepended history shouldn't animate
        prevHeight.current = endRef.current?.scrollHeight ?? 0;
        scrollAction.current = "preserve";
        setMsgs((prev) => mergeMsgs(older, prev));
      }
    } finally {
      setLoadingOlder(false);
    }
  }
  function onThreadScroll() {
    const el = endRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80) loadOlder();
  }
  // Re-pin to the bottom when something async grows the thread (e.g. a link preview card loads).
  const pinBottom = useCallback(() => { const el = endRef.current; if (el && atBottomRef.current) el.scrollTop = el.scrollHeight; }, []);

  useEffect(() => { setReplyTo(null); setEditing(null); }, [detail.id]);
  // Clear the optimistic bubble once the real message lands (msgs grows) or on conversation switch.
  useEffect(() => { setExtra([]); }, [detail.id, msgs.length]);
  // Apply the right scroll after messages render: jump to bottom on open, keep position when
  // prepending history, follow new messages only if already near the bottom.
  useLayoutEffect(() => {
    const el = endRef.current;
    if (!el) return;
    if (scrollAction.current === "bottom") {
      el.scrollTop = el.scrollHeight;
      // Re-pin after late-loading media (images/stickers) grows the thread.
      setTimeout(() => { if (endRef.current && atBottomRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, 200);
    } else if (scrollAction.current === "preserve") el.scrollTop = el.scrollHeight - prevHeight.current;
    else if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    scrollAction.current = "follow";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, extra, detail.typing_until]);

  // Per-conversation draft: restore unsent text when you reopen a chat (cleared on send).
  const draftKey = (id: string) => "ht_draft_" + id;
  const textConvRef = useRef(detail.id);
  useEffect(() => {
    textConvRef.current = detail.id;
    setMentions([]);
    try { setText(localStorage.getItem(draftKey(detail.id)) ?? ""); } catch { setText(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);
  useEffect(() => {
    const id = textConvRef.current; // the conversation this text belongs to
    try { if (text) localStorage.setItem(draftKey(id), text); else localStorage.removeItem(draftKey(id)); } catch {}
  }, [text]);

  // Auto-grow the composer as lines are typed, capped at 4 lines (then it scrolls).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 20;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = lh * 4 + padY;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const assignee = detail.assignee_id ? agentMap.get(detail.assignee_id) : null;
  const messages = [...msgs, ...extra];
  // Animate only newly-arrived bubbles (incoming) + my optimistic sends — never the whole history on open.
  const seenIds = useRef<Set<string>>(new Set());
  const isFresh = (m: ChatMessage) => m.id.startsWith("tmp") || (m.direction === "in" && !seenIds.current.has(m.id));
  useEffect(() => { for (const m of msgs) seenIds.current.add(m.id); }, [msgs]);

  // Group @mentions: who has spoken in this group (the pickable participants) + number→name lookup.
  const participants = useMemo(() => {
    const seen = new Map<string, { jid: string; name: string }>();
    for (const mm of msgs) if (mm.sender_jid && mm.sender_name && !seen.has(mm.sender_jid)) seen.set(mm.sender_jid, { jid: mm.sender_jid, name: mm.sender_name });
    return [...seen.values()];
  }, [msgs]);
  const roster = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) { const num = p.jid.split("@")[0]; if (num && !map.has(num)) map.set(num, p.name); }
    return map;
  }, [participants]);
  // Resolve a mentioned number to a name: the message's own stored mentions first, then the roster.
  const nameForNum = useCallback((m: ChatMessage, num: string): string | undefined => {
    const own = metaMentions(m).find((x) => x.jid.split("@")[0] === num);
    return own?.name ?? roster.get(num);
  }, [roster]);
  const msgMap = useMemo(() => new Map(msgs.map((mm) => [mm.id, mm])), [msgs]);
  // Photo gallery (lightbox) over every image/sticker in the loaded thread.
  const [lightbox, setLightbox] = useState<number | null>(null);
  const imageMsgs = useMemo(() => msgs.filter((mm) => mm.type === "image" && mm.media_url && !mm.deleted), [msgs]);
  const openLightbox = useCallback((id: string) => { setLightbox((() => { const idx = imageMsgs.findIndex((m) => m.id === id); return idx >= 0 ? idx : 0; })()); }, [imageMsgs]);

  // Group consecutive plain images (same sender) into a WhatsApp-style album.
  type Row = { kind: "album"; dir: string; items: ChatMessage[]; created_at: string } | { kind: "msg"; m: ChatMessage };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let album: ChatMessage[] = [];
    const flush = () => {
      if (album.length >= 2) out.push({ kind: "album", dir: album[0].direction, items: album, created_at: album[0].created_at });
      else album.forEach((m) => out.push({ kind: "msg", m }));
      album = [];
    };
    for (const m of messages) {
      const isImg = m.type === "image" && !!m.media_url && !m.reply_to && !m.deleted && !m.body;
      if (isImg && (album.length === 0 || album[album.length - 1].direction === m.direction)) album.push(m);
      else { flush(); if (isImg) album.push(m); else out.push({ kind: "msg", m }); }
    }
    flush();
    return out;
  }, [messages]);

  // El focus va aquí y no en un efecto: tiene que ocurrir dentro del gesto del click para que el
  // teclado del teléfono se abra. Igual en el chat de equipo.
  function startEdit(mm: ChatMessage) { setEditing(mm); setReplyTo(null); setText(mm.body ?? ""); focusComposer(taRef); }
  function startReply(mm: ChatMessage) { setReplyTo(mm); setEditing(null); focusComposer(taRef); }

  // Ventana de 24 h de la API oficial: solo se puede escribir libre si el cliente escribió en las
  // últimas 24 h; cerrada → únicamente plantillas aprobadas. whatsmeow y grupos no tienen ventana.
  const [tplOpen, setTplOpen] = useState(false);
  const [nowMin, setNowMin] = useState(() => Date.now());
  useEffect(() => { const iv = setInterval(() => setNowMin(Date.now()), 60_000); return () => clearInterval(iv); }, []);
  const lastInboundAt = useMemo(() => {
    let last = detail.last_inbound_at ? Date.parse(detail.last_inbound_at) : 0;
    for (const m of msgs) if (m.direction === "in") last = Math.max(last, Date.parse(m.created_at));
    return last;
  }, [detail.last_inbound_at, msgs]);
  const waBlocked = detail.wa_official && !detail.is_group && !(lastInboundAt && lastInboundAt + 24 * 3600_000 > nowMin);

  function doSend() {
    const body = text.trim();
    if (waBlocked) { setTplOpen(true); return; }
    // Con un archivo preparado el texto es opcional: es el pie, no el mensaje.
    if (!body && !pendingTpl) return;
    if (pendingTpl?.media_url) {
      const c = pendingTpl;
      const mime = c.media_mime || "application/octet-stream";
      setPendingTpl(null); setText("");
      start(async () => {
        await sendMediaMessage(detail.id, {
          type: mediaTypeOf(mime), mediaUrl: c.media_url!, mime,
          name: c.media_name ?? undefined, caption: body || undefined,
          thumb: c.media_thumb ?? undefined, size: c.media_size ?? undefined,
        });
        refresh();
      });
      return;
    }
    if (editing) {
      // Realtime echo (liveMessages) reflects the edit — no full refresh needed.
      const id = editing.id; setEditing(null); setText("");
      start(async () => { await editMessage(id, body); });
      return;
    }
    const rt = replyTo?.id;
    // Resolve @mentions (group): turn each "@Name" into WhatsApp's "@<number>" token + collect JIDs.
    let sendBody = body;
    const used: { jid: string; name: string }[] = [];
    if (detail.is_group) {
      for (const mn of mentions) {
        const tag = "@" + mn.name;
        if (sendBody.includes(tag)) { sendBody = sendBody.split(tag).join("@" + mn.jid.split("@")[0]); used.push(mn); }
      }
    }
    const optMeta = used.length ? { mentions: used } : null;
    setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "text", body: sendBody, state: "sent", author_id: null, created_at: new Date().toISOString(), media_url: null, media_mime: null, media_name: null, reply_to: rt ?? null, deleted: false, forwarded: false, edited: false, meta: optMeta, reactions: [], sender_name: null, sender_jid: null }]);
    setText(""); setReplyTo(null); setMentions([]);
    // Optimistic bubble shows instantly; the realtime echo replaces it with the stored message.
    start(async () => { await sendMessage(detail.id, sendBody, rt, used.length ? used : undefined); });
  }

  if (!connected) {
    return (
      <div className="chatcol center" style={{ background: "var(--bg)", position: "relative" }}>
        {/* La flecha de volver TIENE que estar también aquí. Esta pantalla sustituye al hilo
            entero —- encabezado incluido —- y en móvil la lista está escondida porque hay un chat
            abierto: sin esto el agente se quedaba atrapado, sin ninguna forma de regresar. En
            escritorio nunca se notó porque la lista siempre está a la vista. */}
        {onBack && (
          <button className="iconbtn only-mobile" onClick={onBack} aria-label={lang === "es" ? "Volver a los chats" : "Back to chats"}
            style={{ position: "absolute", top: 10, left: 8, zIndex: 2 }}>
            <Icon name="arrowl" size={20} />
          </button>
        )}
        <div className="empty">
          <div className="empty-art" style={{ background: "var(--red-bg)", borderColor: "var(--red-bd)", color: "var(--red)" }}><Icon name="wifioff" /></div>
          <h3>{lang === "es" ? "WhatsApp desconectado" : "WhatsApp disconnected"}</h3>
          <p>{lang === "es" ? "Conecta tu número para enviar mensajes." : "Connect your number to send messages."}</p>
          <Link className="btn btn-primary" href="/settings"><Icon name="qr" size={16} />{lang === "es" ? "Conectar" : "Connect"}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="chatcol" style={{ position: "relative", ...(floating ? { height: "100%", flex: 1, minWidth: 0, width: "100%" } : {}) }} {...dragProps}>
      {dragOver && <DropOverlay lang={lang} />}
      <div className="thread-head">
        {onBack && (
          <button className="iconbtn only-mobile" onClick={onBack} aria-label={lang === "es" ? "Volver a los chats" : "Back to chats"} style={{ marginLeft: -6, flex: "none" }}>
            <Icon name="arrowl" size={20} />
          </button>
        )}
        <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} color={avatarColor(detail.contact?.phone)} size={38}
          badge={assignee ? { initials: deriveInitials(assignee.name), color: assignee.color, src: assignee.avatar_url, title: (lang === "es" ? "Atiende " : "Handled by ") + assignee.name } : null} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name}</span>
            <span className="pill pill-green hide-mobile" style={{ height: 18, padding: "0 6px" }}><Icon name="whatsapp" size={11} />WhatsApp</span>
            {detail.locked_to && <span className="pill pill-amber" style={{ height: 18, padding: "0 6px" }} title={lang === "es" ? "Mantenido con un agente" : "Pinned to an agent"}><Icon name="lock" size={11} />{lang === "es" ? "Mantenido" : "Pinned"}</span>}
          </div>
          <div className="t-xs muted">{isTyping(detail.typing_until) ? <span className="typing-ind">{lang === "es" ? "escribiendo…" : "typing…"}</span> : assignee ? (lang === "es" ? "Atiende " : "Handled by ") + assignee.name : lang === "es" ? "Sin asignar" : "Unassigned"}</div>
        </div>
        {onToggleCtx && (
          <button className={"iconbtn" + (ctxVisible ? " active" : "")} title={ctxVisible ? (lang === "es" ? "Ocultar panel" : "Hide panel") : (lang === "es" ? "Mostrar panel" : "Show panel")} onClick={onToggleCtx}>
            <Icon name="columns" />
          </button>
        )}
        {detail.status !== "resolved" ? (
          <button className="btn btn-sm btn-outline" style={{ color: "var(--green)" }}
            onClick={() => { patch({ status: "resolved" }); start(async () => { const r = await setConvStatus(detail.id, "resolved"); flowToast(r.flows, lang); headerRefresh(); }); }}>
            <Icon name="checks" size={14} /><span className="hide-mobile">{lang === "es" ? "Resolver" : "Resolve"}</span>
          </button>
        ) : <HeaderStatusPill detail={detail} />}
        <TransferControl detail={detail} agents={agents} areas={areas} meId={meId} onAssignedToMe={onAccepted} />
        {!detail.assignee_id && (
          <button className="btn btn-sm btn-primary" onClick={() => { onAccepted?.(detail.id); if (meId) patch({ assignee_id: meId }); start(async () => { await acceptConv(detail.id); headerRefresh(); }); }}>
            <Icon name="check" size={14} /><span className="hide-mobile">{lang === "es" ? "Aceptar" : "Accept"}</span>
          </button>
        )}
      </div>

      {/* El `id` no es decorativo: lo usa el script de arranque del layout raíz para dejar el hilo
          pegado abajo ANTES del primer pintado, sin esperar a que hidrate React. Vive allá y no
          aquí porque un <script> dentro de un componente cliente se vuelve a renderizar en cada
          interacción, y React protesta —- correctamente —- de que en cliente nunca se ejecuta.
          Ver `threadPinBoot` en src/app/layout.tsx. */}
      <div id="chat-thread" className="thread thread-wa-tint scroll" ref={endRef} onScroll={onThreadScroll}>
        {loadingOlder && <div className="t-xs muted" style={{ textAlign: "center", padding: "8px 0" }}>{lang === "es" ? "Cargando mensajes…" : "Loading messages…"}</div>}
        {rows.map((row, i) => {
          const created = row.kind === "album" ? row.created_at : row.m.created_at;
          const prevRow = i > 0 ? rows[i - 1] : null;
          const prevCreated = prevRow ? (prevRow.kind === "album" ? prevRow.created_at : prevRow.m.created_at) : null;
          const showDay = !prevCreated || new Date(prevCreated).toDateString() !== new Date(created).toDateString();
          const key = row.kind === "album" ? row.items[0].id : row.m.id;
          const daySep = showDay ? <div className="day-sep"><span>{dayLabel(created, lang)}</span></div> : null;

          if (row.kind === "album") {
            const out = row.dir === "out";
            return (
              <React.Fragment key={key}>
                {daySep}
                <div className={"msg " + (out ? "out" : "in") + (isFresh(row.items[0]) ? " fresh" : "")}>
                  <div className="bubble" style={{ padding: 3 }}>
                    <AlbumMenu out={out} onForward={() => setForwarding(row.items)}
                      onDelete={out ? async () => { if (await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar fotos" : "Delete photos", message: lang === "es" ? "Se eliminan para todos en la conversación." : "They are deleted for everyone in the chat.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) start(async () => { for (const it of row.items) await deleteMessage(it.id); refresh(); }); } : undefined} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 242 }}>
                      {row.items.slice(0, 4).map((m, idx) => (
                        <a key={m.id} id={`m-${m.id}`} href={m.media_url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => { if (m.media_url) { e.preventDefault(); openLightbox(m.id); } }} style={{ position: "relative", display: "block", aspectRatio: "1 / 1", borderRadius: 6, background: "var(--surface-2)", overflow: "hidden", cursor: "zoom-in" }}>
                          <CachedImg path={m.media_path} url={m.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          {idx === 3 && row.items.length > 4 && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, borderRadius: 6 }}>+{row.items.length - 4}</span>}
                          {m.state === "failed" && (
                            <button title={lang === "es" ? "Reintentar" : "Retry"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); start(async () => { await retryMessage(m.id); refresh(); }); }}
                              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, border: "none", cursor: "pointer", font: "inherit", fontSize: 10.5, fontWeight: 700 }}>
                              <Icon name="refresh" size={17} />{lang === "es" ? "Reintentar" : "Retry"}
                            </button>
                          )}
                          {m.state === "queued" && <span style={{ position: "absolute", bottom: 3, right: 3, background: "rgba(0,0,0,.45)", borderRadius: 5, padding: "1px 3px", display: "inline-flex", color: "#fff" }}><Tick state="queued" /></span>}
                        </a>
                      ))}
                    </div>
                    <div className="bubble-meta">
                      {row.items.some((it) => it.state === "failed") && (
                        <button onClick={() => start(async () => { for (const it of row.items.filter((x) => x.state === "failed")) await retryMessage(it.id); refresh(); })}
                          style={{ marginRight: 5, border: "none", background: "transparent", color: "var(--red)", cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <Icon name="refresh" size={11} />{lang === "es" ? "Reintentar" : "Retry"}
                        </button>
                      )}
                      <span title={fullStamp(row.created_at, lang)}>{clockTime(row.created_at, lang)}</span>{out && <Tick state={row.items.some((it) => it.state === "failed") ? "failed" : row.items[row.items.length - 1].state} />}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          }

          const m = row.m;
          const out = m.direction === "out";
          const author = out && m.author_id ? agentMap.get(m.author_id) : null;
          return (
            <React.Fragment key={key}>
            {daySep}
            <div className={"msg " + (out ? "out" : "in") + (isFresh(m) ? " fresh" : "")}>
              <div className="bubble" id={`m-${m.id}`}>
                {author && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-700)", marginBottom: 2 }}>{author.name}</div>}
                {!out && detail.is_group && m.sender_name && <div style={{ fontSize: 11.5, fontWeight: 700, color: senderColor(m.sender_jid || m.sender_name), marginBottom: 2 }}>{m.sender_name}</div>}
                {m.forwarded && !m.deleted && <div className="row gap-1 t-xs muted" style={{ marginBottom: 2, fontStyle: "italic" }}><Icon name="forward" size={12} />{lang === "es" ? "Reenviado" : "Forwarded"}</div>}
                {m.reply_to && msgMap.get(m.reply_to) && <QuotedBlock m={msgMap.get(m.reply_to)!} />}
                {storyOf(m) && <StoryQuoteBlock s={storyOf(m)!} out={out} />}
                {m.deleted ? (
                  <div className="row gap-1" style={{ fontStyle: "italic", opacity: 0.6 }}><Icon name="x" size={12} />{lang === "es" ? "Mensaje eliminado" : "Message deleted"}</div>
                ) : m.type === "location" ? <LocationBlock m={m} />
                  : m.type === "contact" ? <ContactBlock m={m} />
                    : (
                      <>
                        {(m.media_url || m.type === "call" || m.media_purged_at || m.media_pending || m.media_fetch_error) && <MediaBlock m={m} onImage={openLightbox} />}
                        {m.body && <div style={{ marginTop: m.media_url ? 4 : 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail.is_group ? renderRichText(m.body, (num) => nameForNum(m, num)) : linkify(m.body)}</div>}
                        {m.body && firstUrl(m.body) && <LinkPreview url={firstUrl(m.body)!} onReady={pinBottom} />}
                      </>
                    )}
                <div className="bubble-meta">{m.edited && !m.deleted && <span style={{ marginRight: 4, fontSize: 10.5, opacity: 0.7 }}>{lang === "es" ? "editado" : "edited"}</span>}
                  {out && m.state === "failed" && !m.id.startsWith("tmp") && (
                    <button onClick={() => start(async () => { await retryMessage(m.id); refresh(); })} style={{ marginRight: 5, border: "none", background: "transparent", color: "var(--red)", cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="refresh" size={11} />{lang === "es" ? "Reintentar" : "Retry"}</button>
                  )}
                  <span title={fullStamp(m.created_at, lang)}>{clockTime(m.created_at, lang)}</span>{out && <Tick state={m.state} />}</div>
                {!m.deleted && m.reactions?.length > 0 && (
                  <div className="msg-reacts">
                    {m.reactions.map((r, ri) => (
                      <button key={ri} className={"msg-react" + (r.by === "agent" ? " mine" : "")} title={r.by === "agent" ? (lang === "es" ? "Tu reacción" : "Your reaction") : (lang === "es" ? "Reacción del cliente" : "Customer reaction")}
                        onClick={() => start(async () => { await reactToMessage(m.id, r.emoji); refresh(); })}>{r.emoji}</button>
                    ))}
                  </div>
                )}
                {!m.deleted && !m.id.startsWith("tmp") && (
                  <MsgMenu m={m} out={out} onReply={() => startReply(m)} onEdit={() => startEdit(m)} onForward={() => setForwarding([m])}
                    onCopied={(r) => push({ kind: r ? "success" : "warn", message: r === "file" ? (lang === "es" ? "Archivo copiado" : "File copied") : r === "link" ? (lang === "es" ? "Enlace copiado" : "Link copied") : (lang === "es" ? "No se pudo copiar" : "Couldn't copy") })}
                    onReact={(rect) => setReactTarget({ id: m.id, rect })}
                    onDelete={async () => { if (await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar mensaje" : "Delete message", message: lang === "es" ? "Se elimina para todos en la conversación." : "It is deleted for everyone in the chat.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) start(async () => { await deleteMessage(m.id); refresh(); }); }} />
                )}
              </div>
            </div>
            </React.Fragment>
          );
        })}
        {isTyping(detail.typing_until) && (
          <div className="msg in">
            <div className="bubble typing-bubble"><span className="td" /><span className="td" /><span className="td" /></div>
          </div>
        )}
      </div>

      <div className="composer">
        {waBlocked && (
          <div className="row gap-3" style={{ padding: "10px 12px", background: "var(--amber-bg, var(--surface-2))", border: "1px solid var(--amber-bd, var(--border))", borderRadius: "var(--r-md)", marginBottom: 6, alignItems: "center" }}>
            <Icon name="clock" size={16} />
            <div className="grow t-sm">
              {lang === "es"
                ? "La ventana de 24 h está cerrada: WhatsApp solo permite iniciar con una plantilla aprobada. Cuando el cliente responda, el chat libre se reabre."
                : "The 24h window is closed: WhatsApp only allows starting with an approved template. Once the customer replies, free chat reopens."}
            </div>
            <button className="btn btn-sm btn-primary" style={{ flex: "none" }} onClick={() => setTplOpen(true)}>
              <Icon name="send" size={14} />{lang === "es" ? "Enviar plantilla" : "Send template"}
            </button>
          </div>
        )}
        {(replyTo || editing) && (
          <div className="row gap-2" style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 6 }}>
            <Icon name={editing ? "edit" : "swap"} size={14} />
            <span className="t-xs muted grow truncate">{(editing ? (lang === "es" ? "Editando: " : "Editing: ") : (lang === "es" ? "Respondiendo: " : "Replying: "))}{(editing || replyTo)?.body || (editing || replyTo)?.type}</span>
            <button className="iconbtn sm" onClick={() => { setEditing(null); setReplyTo(null); if (editing) setText(""); }}><Icon name="x" size={14} /></button>
          </div>
        )}
        {/* El archivo de la plantilla elegida, a la vista y todavía sin mandar. La X lo quita y
            deja el texto: cambiar de idea no debe costar volver a escribirlo. */}
        {pendingTpl && (
          <div className="row gap-2" style={{ padding: "6px 8px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 6, alignItems: "center" }}>
            {pendingTpl.media_thumb
              ? <img src={pendingTpl.media_thumb} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", flex: "none" }} />
              : <span style={{ width: 34, height: 34, borderRadius: 6, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="file" size={16} /></span>}
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="truncate" style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{pendingTpl.media_name || (lang === "es" ? "Archivo" : "File")}</span>
              <span className="t-xs muted">{lang === "es" ? "se envía al pulsar Enviar" : "sends when you press Send"}</span>
            </span>
            <button className="iconbtn sm" onClick={() => setPendingTpl(null)}><Icon name="x" size={14} /></button>
          </div>
        )}
        {!waBlocked && (
        <div className="composer-box">
          <div className="composer-input">
            <textarea ref={taRef} className="bare" rows={1} style={{ resize: "none" }} placeholder={lang === "es" ? "Escribe un mensaje… ( / para plantillas)" : "Type a message… ( / for templates)"} value={text}
              onChange={(e) => { setText(e.target.value); detectSlash(e.target.value, e.target.selectionStart); }}
              onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); stageFiles(files); } }}
              onBlur={() => setTimeout(() => setSlash(null), 150)}
              onKeyDown={(e) => {
                if (slash && slashMatches.length) {
                  if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => (s + 1) % slashMatches.length); return; }
                  if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => (s - 1 + slashMatches.length) % slashMatches.length); return; }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applySlash(slashMatches[slashSel]); return; }
                  if (e.key === "Escape") { setSlash(null); return; }
                }
                if (e.key === "Enter" && !e.shiftKey && enterSends()) { e.preventDefault(); doSend(); }
              }} />
          </div>
          {slash && slashMatches.length > 0 && slashRect && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setSlash(null)} />
              <div className="menu scroll" style={{ position: "fixed", bottom: window.innerHeight - slashRect.top + 6, left: slashRect.left, width: Math.min(360, Math.max(260, slashRect.width)), maxHeight: 280, zIndex: 201 }}>
                <div className="menu-label">{lang === "es" ? "Plantillas (/)" : "Templates (/)"}</div>
                {slashMatches.map((c, i) => (
                  <button key={c.id} type="button" className={"menu-item" + (i === slashSel ? " on" : "")} style={{ display: "block", textAlign: "left", height: "auto", padding: "8px 12px", ...(i === slashSel ? { background: "var(--surface-2)" } : {}) }}
                    onMouseEnter={() => setSlashSel(i)} onMouseDown={(e) => { e.preventDefault(); applySlash(c); }}>
                    <div className="row gap-2">{c.media_url && <Icon name="paperclip" size={12} />}<span style={{ fontWeight: 600, fontSize: 12.5 }}>{c.title}</span>{c.shortcut && <span className="mono t-xs muted">{c.shortcut}</span>}</div>
                    <div className="muted t-xs truncate">{c.body || c.media_name || ""}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="composer-actions">
            <input ref={fileRef} type="file" multiple style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.length) stageFiles(e.target.files); e.target.value = ""; }} />
            <button className="iconbtn" onClick={() => fileRef.current?.click()} title={lang === "es" ? "Adjuntar" : "Attach"}><Icon name="paperclip" /></button>
            {detail.is_group && participants.length > 0 && (
              <span style={{ display: "inline-flex" }}>
                <button ref={mentionBtn} className="iconbtn" title={lang === "es" ? "Mencionar" : "Mention"} style={{ fontWeight: 800, fontSize: 16 }} onClick={() => { if (!mentionOpen && mentionBtn.current) setMentionRect(mentionBtn.current.getBoundingClientRect()); setMentionOpen((o) => !o); setEmojiOpen(false); setCannedOpen(false); }}>@</button>
                {mentionOpen && mentionRect && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setMentionOpen(false)} />
                    <div className="menu scroll" style={{ position: "fixed", bottom: window.innerHeight - mentionRect.top + 6, left: mentionRect.left, width: 220, maxHeight: 280, zIndex: 201 }}>
                      <div className="menu-label">{lang === "es" ? "Mencionar a" : "Mention"}</div>
                      {participants.map((p) => (
                        <button key={p.jid} className="menu-item" style={{ textAlign: "left" }} onClick={() => {
                          setText((v) => (v && !v.endsWith(" ") && v.length ? v + " " : v) + "@" + p.name + " ");
                          setMentions((m) => (m.some((x) => x.jid === p.jid) ? m : [...m, p]));
                          setMentionOpen(false);
                          taRef.current?.focus();
                        }}>
                          <span style={{ display: "inline-flex", color: senderColor(p.jid) }}><Icon name="user" size={14} /></span>
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </span>
            )}
            <span style={{ display: "inline-flex" }}>
              <button ref={emojiBtn} className="iconbtn" onClick={() => { if (!emojiOpen && emojiBtn.current) setEmojiRect(emojiBtn.current.getBoundingClientRect()); setEmojiOpen((o) => !o); setCannedOpen(false); }} title="Emoji" style={{ fontSize: 16 }}>😀</button>
              {emojiOpen && emojiRect && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setEmojiOpen(false)} />
                  <EmojiPicker rect={emojiRect} onPick={(e) => setText((v) => v + e)} />
                </>
              )}
            </span>
            <span style={{ display: "inline-flex" }}>
              <button ref={cannedBtn} className="iconbtn" onClick={() => { if (!cannedOpen && cannedBtn.current) setCannedRect(cannedBtn.current.getBoundingClientRect()); setCannedOpen((o) => !o); setEmojiOpen(false); loadCanned(); }} title={lang === "es" ? "Plantillas" : "Templates"}><Icon name="canned" /></button>
              {cannedOpen && cannedRect && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setCannedOpen(false)} />
                  <div className="menu scroll" style={{ position: "fixed", bottom: window.innerHeight - cannedRect.top + 6, left: cannedRect.left, width: 300, maxHeight: 320, zIndex: 201 }}>
                    {canned.length === 0 ? <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Sin plantillas." : "No templates."}</div> :
                      canned.map((c) => (
                        <button key={c.id} className="menu-item" style={{ display: "block", textAlign: "left", height: "auto", padding: "8px 12px" }}
                          onClick={() => { setCannedOpen(false); attachCanned(c); setText((v) => (v ? v + " " : "") + fillVars(c.body)); taRef.current?.focus(); }}>
                          <div className="row gap-1" style={{ fontWeight: 600, fontSize: 12.5 }}>{c.media_url && <Icon name="paperclip" size={12} />}{c.title}</div>
                          <div className="muted t-xs truncate">{c.body || c.media_name || ""}</div>
                        </button>
                      ))}
                  </div>
                </>
              )}
            </span>
            <span style={{ display: "inline-flex" }}>
              <button ref={stickerBtn} className="iconbtn" title={lang === "es" ? "Stickers" : "Stickers"} style={{ fontSize: 16 }} onClick={() => { if (!stickerOpen && stickerBtn.current) setStickerRect(stickerBtn.current.getBoundingClientRect()); setStickerOpen((o) => !o); setEmojiOpen(false); setCannedOpen(false); if (!stickerOpen) loadStickers(); }}>🩷</button>
              {stickerOpen && stickerRect && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => { setStickerOpen(false); setSavingSticker(null); setConfirmSticker(null); }} />
                  <div className="menu" style={{ position: "fixed", bottom: window.innerHeight - stickerRect.top + 6, left: Math.max(8, stickerRect.left - 150), width: 300, height: 360, maxHeight: "70vh", zIndex: 201, padding: 8, display: "flex", flexDirection: "column" }}>
                    {savingSticker ? (
                      <SaveFavoriteForm s={savingSticker} lang={lang} onCancel={() => setSavingSticker(null)} onSave={(name, tags) => commitFavorite(savingSticker, name, tags)} onRemove={savingSticker.fav ? () => { removeFavorite(savingSticker); setSavingSticker(null); } : undefined} />
                    ) : confirmSticker ? (
                      <div className="col gap-3" style={{ padding: 8, alignItems: "center", justifyContent: "center", flex: 1 }}>
                        <span className="sticker-pick" style={{ width: 140, height: 140, padding: 8, pointerEvents: "none" }}><CachedImg path={confirmSticker.path} url={confirmSticker.url} alt="" /></span>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{lang === "es" ? "¿Enviar este sticker?" : "Send this sticker?"}</div>
                        <div className="row gap-2" style={{ width: "100%" }}>
                          <button className="btn btn-outline grow" onClick={() => setConfirmSticker(null)}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
                          <button className="btn btn-primary grow" onClick={() => pickSticker(confirmSticker)}><Icon name="send" size={15} />{lang === "es" ? "Enviar" : "Send"}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="field field-sm field-filled" style={{ marginBottom: 6, flex: "none" }}>
                          <Icon name="search" />
                          <input placeholder={lang === "es" ? "Buscar por nombre o tag…" : "Search by name or tag…"} value={stickerQuery} onChange={(e) => setStickerQuery(e.target.value)} />
                        </div>
                        <div className="sticker-tray scroll" style={{ flex: 1, minHeight: 0 }}>
                          {stickerLoading ? <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>
                            : (() => {
                              const q = stickerQuery.trim().toLowerCase();
                              const favs = q ? stickerTray.favorites.filter((f) => (f.name ?? "").toLowerCase().includes(q) || (f.tags ?? []).some((t) => t.includes(q))) : stickerTray.favorites;
                              const recents = q ? [] : stickerTray.recent;
                              if (favs.length === 0 && recents.length === 0) return <div className="muted t-sm" style={{ padding: 10 }}>{q ? (lang === "es" ? "Sin resultados." : "No matches.") : (lang === "es" ? "Aún no hay stickers. Aparecerán los que recibas o envíes." : "No stickers yet. The ones you receive or send show up here.")}</div>;
                              return (
                                <>
                                  {favs.length > 0 && <>
                                    <div className="menu-label">{lang === "es" ? "★ Favoritos" : "★ Favorites"}</div>
                                    <div className="sticker-grid">{favs.map((s) => <StickerCell key={"f" + s.path} s={s} onSend={() => setConfirmSticker(s)} onFav={() => favSticker(s)} lang={lang} />)}</div>
                                  </>}
                                  {recents.length > 0 && <>
                                    <div className="menu-label">{lang === "es" ? "Recientes" : "Recent"}</div>
                                    <div className="sticker-grid">{recents.map((s) => <StickerCell key={"r" + s.path} s={s} onSend={() => setConfirmSticker(s)} onFav={() => favSticker(s)} lang={lang} />)}</div>
                                  </>}
                                </>
                              );
                            })()}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </span>
            <span className="grow" />
            <button className="btn btn-primary btn-sm" onClick={doSend} disabled={(!text.trim() && !pendingTpl) || pending}><Icon name="send" size={15} /> {lang === "es" ? "Enviar" : "Send"}</button>
          </div>
        </div>
        )}
      </div>

      {tplOpen && (
        <WaTemplateModal
          convId={detail.id}
          onClose={() => setTplOpen(false)}
          onSent={(body) => {
            setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "text", body, state: "sent", author_id: null, created_at: new Date().toISOString(), media_url: null, media_mime: null, media_name: null, reply_to: null, deleted: false, forwarded: false, edited: false, meta: null, reactions: [], sender_name: null, sender_jid: null }]);
          }}
        />
      )}

      {staged.length > 0 && (
        <div className="modal-wrap">
          <div className="scrim" onClick={cancelStaged} />
          <div className="modal">
            <div className="modal-head">
              <h3 className="grow">{lang === "es" ? "Enviar archivos" : "Send files"}{staged.length > 1 ? ` (${staged.length})` : ""}</h3>
              {/* Nunca deshabilitada: quedarse sin salida es peor que cortar un envío a medias. */}
              <button className="iconbtn" onClick={cancelStaged}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="row gap-2" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                {staged.map((f, i) => <MediaThumb key={i} file={f} onRemove={() => setStaged((s) => s.filter((_, j) => j !== i))} />)}
                <button className="iconbtn" style={{ width: 86, height: 86, border: "1px dashed var(--border-strong)", borderRadius: 10 }} onClick={() => fileRef.current?.click()}><Icon name="plus" /></button>
              </div>
            </div>
            <div className="modal-foot stack">
              <div className="col gap-2 grow" style={{ minWidth: 0, width: "100%" }}>
                {sendErr && <div className="t-xs" style={{ color: "var(--red)" }}>{sendErr}</div>}
                <div className="field field-filled"><Icon name="edit" size={15} /><input placeholder={lang === "es" ? "Agrega un comentario…" : "Add a caption…"} value={caption} onChange={(e) => setCaption(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendStaged(); }} autoFocus /></div>
              </div>
              <button className="btn btn-primary" disabled={sending} onClick={sendStaged}><Icon name="send" size={15} />{sending ? (lang === "es" ? "Enviando…" : "Sending…") : sendErr ? (lang === "es" ? "Reintentar" : "Retry") : (lang === "es" ? "Enviar" : "Send")}</button>
            </div>
          </div>
        </div>
      )}

      {reactTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setReactTarget(null)} />
          <EmojiPicker rect={reactTarget.rect} onPick={(e) => { const id = reactTarget.id; setReactTarget(null); start(async () => { await reactToMessage(id, e); refresh(); }); }} />
        </>
      )}
      {lightbox !== null && imageMsgs.length > 0 && (
        <Lightbox items={imageMsgs} index={lightbox} onClose={() => setLightbox(null)}
          onForward={(m) => { setLightbox(null); setForwarding([m]); }}
          onDelete={async (m) => { setLightbox(null); if (await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar foto" : "Delete photo", message: lang === "es" ? "Se elimina para todos en la conversación." : "It is deleted for everyone in the chat.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) start(async () => { await deleteMessage(m.id); refresh(); }); }} />
      )}
      {forwarding && (
        <ForwardPicker businessId={businessId} messages={forwarding} onClose={() => setForwarding(null)}
          onDone={(n) => { setForwarding(null); push({ kind: "success", message: lang === "es" ? `Reenviado a ${n} chat${n > 1 ? "s" : ""}` : `Forwarded to ${n} chat${n > 1 ? "s" : ""}` }); }} />
      )}
    </div>
  );
}

/** Pick one or more conversations to forward message(s) into. */
function ForwardPicker({ businessId, messages, onClose, onDone }: { businessId: string; messages: ChatMessage[]; onClose: () => void; onDone: (n: number) => void }) {
  const { lang } = useApp();
  const [convs, setConvs] = useState<ConvListItem[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  useEffect(() => { liveListPage(businessId, { scope: "all", limit: 200 }).then((p) => setConvs(p.rows)).catch(() => {}); }, [businessId]);
  const view = convs.filter((c) => { const s = q.trim().toLowerCase(); return !s || (c.contact?.name ?? "").toLowerCase().includes(s) || (c.contact?.phone ?? "").includes(s); });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doForward = async () => {
    if (!sel.size) return;
    setSending(true);
    try { for (const convId of sel) for (const m of messages) await forwardMessage(m.id, convId); onDone(sel.size); }
    finally { setSending(false); }
  };
  const preview = messages.length > 1 ? (lang === "es" ? `${messages.length} fotos` : `${messages.length} photos`) : (messages[0]?.body || (messages[0] && messages[0].type !== "text" ? "📎 " + messages[0].type : ""));
  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal" style={{ width: 420, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-head"><h3 className="grow">{lang === "es" ? "Reenviar a…" : "Forward to…"}</h3><button className="iconbtn" onClick={onClose}><Icon name="x" /></button></div>
        <div style={{ padding: "0 16px 10px" }}>
          {preview && <div className="t-xs muted truncate" style={{ marginBottom: 8, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 8 }}>{preview}</div>}
          <div className="field field-filled"><Icon name="search" size={15} /><input placeholder={lang === "es" ? "Buscar chat…" : "Search chat…"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        </div>
        <div className="scroll" style={{ flex: 1, padding: "0 8px", minHeight: 0, overflowY: "auto" }}>
          {view.map((c) => (
            <button key={c.id} className={"menu-item" + (sel.has(c.id) ? " on" : "")} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", height: "auto", padding: "8px 10px" }} onClick={() => toggle(c.id)}>
              <input type="checkbox" checked={sel.has(c.id)} readOnly style={{ pointerEvents: "none" }} />
              <Avatar name={c.contact?.name} initials={deriveInitials(c.contact?.name || c.contact?.phone || "?")} color={avatarColor(c.contact?.phone)} size={30} />
              <span className="grow truncate">{c.contact?.name ?? c.contact?.phone ?? "—"}</span>
            </button>
          ))}
          {view.length === 0 && <div className="muted t-sm" style={{ padding: 14, textAlign: "center" }}>{lang === "es" ? "Sin chats." : "No chats."}</div>}
        </div>
        <div className="modal-foot"><span className="grow" />
          <button className="btn btn-primary" disabled={sending || sel.size === 0} onClick={doForward}>
            {sending ? <Spinner size={14} /> : <Icon name="forward" size={15} />}{lang === "es" ? "Reenviar" : "Forward"}{sel.size ? ` (${sel.size})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MediaThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  // Create the preview URL in an effect (not useMemo) and revoke it in the same cleanup, so a
  // re-render/StrictMode remount can't revoke a URL that's still in use → no intermittent broken image.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div style={{ position: "relative", width: 86, height: 86, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {file.type.startsWith("image/") && url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : file.type.startsWith("video/") && url ? <video src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div className="col" style={{ alignItems: "center", gap: 4, padding: 6 }}><Icon name="file" size={20} /><span className="t-xs muted truncate" style={{ maxWidth: 76 }}>{file.name}</span></div>}
      <button className="iconbtn sm" style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.55)", color: "#fff" }} onClick={onRemove}><Icon name="x" size={13} /></button>
    </div>
  );
}

/* ---------- Transfer popover ---------- */
function TransferControl({ detail, agents, areas, meId, onAssignedToMe }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; meId?: string; onAssignedToMe?: (convId: string) => void }) {
  const { lang } = useApp();
  const refresh = useChatHeaderRefresh();
  const patch = useChatPatch();
  const ask = useConfirm();
  const { ref, open, rect, toggle, close } = usePopover();
  const [pending, start] = useTransition();

  async function pick(mode: "agent" | "area" | "unassign", id: string) {
    close();
    // Pinned ("mantener conmigo") + reassigning elsewhere → confirm; transferring releases the lock.
    if (detail.locked_to && (mode !== "agent" || id !== detail.locked_to)) {
      const name = agents.find((a) => a.id === detail.locked_to)?.name ?? (lang === "es" ? "un agente" : "an agent");
      if (!(await ask(lockConfirmOpts(name, lang)))) return;
    }
    if (mode === "unassign") patch({ assignee_id: null, locked_to: null });
    else if (mode === "agent") {
      patch({ assignee_id: id, locked_to: null });
      // Transferirte un chat a ti mismo lo saca de la pestaña donde estabas ("Sin asignar") y el
      // hilo se quedaba huérfano en pantalla. Mismo trato que el botón Aceptar: la lista salta a
      // "Míos" y el chat abierto se queda abierto, que es donde sigues trabajando.
      if (meId && id === meId) onAssignedToMe?.(detail.id);
    }
    else { const ar = areas.find((a) => a.id === id); patch({ area: ar ? { name: ar.name, color: ar.color } : detail.area, locked_to: null }); }
    start(async () => { await transferConv(detail.id, mode, id); refresh(); });
  }

  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} className="btn btn-sm btn-outline" onClick={toggle}>
        <Icon name="swap" size={14} /><span className="hide-mobile">{lang === "es" ? "Transferir" : "Transfer"}</span>
      </button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu scroll" style={menuStyle(rect, { width: 220, height: 360, align: "right" })}>
            <div className="menu-label">{lang === "es" ? "A un agente" : "To an agent"}</div>
            {agents.filter((a) => a.role !== "viewer").map((a) => (
              <button className="menu-item" key={a.id} onClick={() => pick("agent", a.id)}>
                <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} src={a.avatar_url ?? undefined} size={20} />{a.name}
              </button>
            ))}
            <div className="menu-sep" />
            <div className="menu-label">{lang === "es" ? "A un área" : "To an area"}</div>
            {areas.map((ar) => (
              <button className="menu-item" key={ar.id} onClick={() => pick("area", ar.id)}>
                <Pill color={ar.color as PillColor}>{ar.name}</Pill>
              </button>
            ))}
            {/* Siempre visible. Antes se escondía si el chat no tenía agente, pero la asignación
                masiva de la lista sí la ofrecía siempre — y aun sin agente hace algo: suelta el
                candado de "mantener conmigo". */}
            {<>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => pick("unassign", "")}>
                <Pill color="slate"><Icon name="agents" size={11} />{lang === "es" ? "Sin asignar" : "Unassign"}</Pill>
              </button>
            </>}
          </div>
        </>
      )}
    </span>
  );
}

/* ---------- Workspace (center column) ---------- */
function Workspace({ detail, agents, areas, stages, products, meId, businessId, connected, invoice, shipping, invoicing, onResizeStart, onOpen360, onAssignedToMe, doneFromStageId = null, manualMarginPct = 50 }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; stages: Stage[]; products: Product[]; meId: string; businessId: string; connected: boolean; invoice?: { add: boolean; rate: number }; shipping?: string | null; invoicing?: boolean; onResizeStart: (e: React.PointerEvent) => void; onOpen360: () => void; onAssignedToMe?: (convId: string) => void; doneFromStageId?: string | null; manualMarginPct?: number }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const refresh = useChatRefresh();
  const headerRefresh = useChatHeaderRefresh();
  const patch = useChatPatch();
  const flowToast = useFlowToast();
  const { push: pushToast } = useToast();
  const ask = useConfirm();
  const [pending, start] = useTransition();
  const [openOrder, setOpenOrder] = useState<OrderDetail | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const openOrderDrawer = (id: string) => { setLoadingOrder(id); startLoad(async () => { const d = await loadOrderDetail(id); setOpenOrder(d); setLoadingOrder(null); }); };
  const [note, setNote] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(detail.contact?.name ?? "");
  const [actOpen, setActOpen] = useState(true);
  const [showXfer, setShowXfer] = useState(false);
  const tagBtn = useRef<HTMLButtonElement>(null);
  const [tagRect, setTagRect] = useState<DOMRect | null>(null);
  const actionsBtn = useRef<HTMLButtonElement>(null);
  const [actionsRect, setActionsRect] = useState<DOMRect | null>(null);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // Reorderable center-column blocks (orders / notes / activity), persisted.
  const [blockOrder, setBlockOrder] = useState<string[]>(["orders", "notes", "activity"]);
  useEffect(() => {
    try {
      const s = localStorage.getItem("ht_wsOrder");
      if (s) { const arr = JSON.parse(s); if (Array.isArray(arr) && arr.length === 3 && ["orders", "notes", "activity"].every((k) => arr.includes(k))) setBlockOrder(arr); }
    } catch {}
  }, []);
  function commitBlockOrder(ids: string[]) {
    setBlockOrder(ids);
    try { localStorage.setItem("ht_wsOrder", JSON.stringify(ids)); } catch {}
  }

  useEffect(() => { setNameVal(detail.contact?.name ?? ""); setEditingName(false); }, [detail.contact?.id, detail.contact?.name]);

  function postNote() {
    const body = note.trim();
    if (!body) return;
    setNote("");
    // Optimistic: show the note immediately; refresh() reconciles with the stored row.
    patch({ notes: [...detail.notes, { id: "tmp" + detail.notes.length, body, author_id: null, created_at: new Date().toISOString() }] });
    start(async () => { await addConvNote(detail.id, body); refresh(); });
  }
  function saveName() {
    setEditingName(false);
    const v = nameVal.trim();
    if (v && detail.contact && v !== detail.contact.name) {
      start(async () => { await renameContact(detail.contact!.id, v); refresh(); });
    }
  }
  async function removeChat() {
    const ok = await ask({
      icon: "trash", danger: true,
      title: lang === "es" ? "Eliminar conversación" : "Delete conversation",
      message: lang === "es" ? "Se borran también todos sus mensajes." : "All its messages are deleted too.",
      confirmLabel: lang === "es" ? "Eliminar" : "Delete",
      cancelLabel: lang === "es" ? "Volver" : "Back",
    });
    if (!ok) return;
    start(async () => { await deleteConv(detail.id); router.push("/chat"); refresh(); });
  }

  const grip = (handle: { onPointerDown: (e: React.PointerEvent) => void }) => (
    <span className="ws-grip" {...handle} title={lang === "es" ? "Arrastra para reordenar" : "Drag to reorder"}><Icon name="grip" size={14} /></span>
  );

  const blockContent: Record<string, (handle: { onPointerDown: (e: React.PointerEvent) => void }) => React.ReactNode> = {
    orders: (handle) => detail.is_group ? (
      <>
        <div className="ws-block-head">{grip(handle)}<Icon name="agents" size={16} /><h4 className="grow">{lang === "es" ? "Grupo" : "Group"}</h4></div>
        <div className="ws-block-body"><div className="muted t-sm" style={{ padding: "6px 2px", lineHeight: 1.5 }}>{lang === "es" ? "Chat de grupo — solo para conversar. Los grupos no crean ni se vinculan a pedidos." : "Group chat — conversation only. Groups don't create or link to orders."}</div></div>
      </>
    ) : (
      <>
        <div className="ws-block-head">{grip(handle)}<Icon name="orders" size={16} /><h4 className="grow">{personal ? (lang === "es" ? "Tareas" : "Tasks") : (lang === "es" ? "Pedidos" : "Orders")} <span className="muted">· {detail.orders.length}</span></h4>
          <button className="btn btn-sm btn-outline" onClick={() => setShowNewTask(true)}><Icon name="plus" size={14} />{lang === "es" ? "Nuevo" : "New"}</button>
        </div>
        <div className="ws-block-body col gap-2">
          {detail.orders.length === 0 ? <div className="muted t-sm" style={{ padding: "6px 2px" }}>{personal ? (lang === "es" ? "Sin tareas." : "No tasks.") : (lang === "es" ? "Sin pedidos." : "No orders.")}</div> :
            detail.orders.map((o) => (
              <button key={o.id} className="ocard" style={{ textAlign: "left", cursor: "pointer", font: "inherit", opacity: loadingOrder === o.id ? 0.6 : 1 }} disabled={loadingOrder === o.id} onClick={() => openOrderDrawer(o.id)}>
                <div className="ocard-top"><span className="ocard-id mono">{o.code}</span><span className="grow" />{o.cancelled_at ? <Pill color="red" dot>{lang === "es" ? "Cancelado" : "Cancelled"}</Pill> : o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}</div>
                {o.items?.[0]?.name && <div className="t-xs muted truncate">{o.items[0].name}{o.items.length > 1 ? ` +${o.items.length - 1}` : ""}</div>}
                {/* El mismo distintivo que llevan la tabla de Pedidos y el tablero. Aquí es donde
                    más sirve: se está atendiendo a esa persona y su transferencia sigue sin aprobar. */}
                <div className="ocard-foot">{o.area && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}<span className="grow" />{!personal && o.pending_proof && <Pill color="amber" title={lang === "es" ? "Comprobante por revisar" : "Receipt to review"}><Icon name="checks" size={10} />{lang === "es" ? "Por aprobar" : "To approve"}</Pill>}{!personal && <span className="row gap-1" style={{ alignItems: "center" }}><PayDot status={o.pay_status} title={payStatusLabel(o.pay_status, lang)} /><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>${o.total.toLocaleString("es-MX")}</span></span>}</div>
              </button>
            ))}
        </div>
      </>
    ),
    notes: (handle) => (
      <>
        <div className="ws-block-head">{grip(handle)}<Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Internal notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
        <div className="ws-block-body">
          <div style={{ marginBottom: 8 }}>
            <MentionTextarea value={note} onChange={setNote} agents={agents} placeholder={lang === "es" ? "Agregar nota… usa @ para mencionar" : "Add a note… use @ to mention"} />
          </div>
          {note.trim() && <button className="btn btn-sm btn-primary" style={{ marginBottom: 10 }} disabled={pending} onClick={postNote}><Icon name="send" size={14} />{lang === "es" ? "Publicar" : "Post"}</button>}
          {detail.notes.length === 0 ? <div className="muted t-sm">{lang === "es" ? "Aún no hay notas." : "No notes yet."}</div> :
            detail.notes.map((n) => {
              const au = n.author_id ? agentMap.get(n.author_id) : null;
              return (
                <div className="note" key={n.id}>
                  <Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={28} />
                  <div className="note-body note-yellow">
                    <div className="note-head"><span className="note-author">{au?.name ?? "Agente"}</span><span className="note-time">{relTime(n.created_at, lang)}</span></div>
                    <div className="note-text">{n.body}</div>
                  </div>
                </div>
              );
            })}
        </div>
      </>
    ),
    activity: (handle) => (
      <>
        <div className="ws-block-head">{grip(handle)}
          <button style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left", padding: 0 }} onClick={() => setActOpen((v) => !v)}>
            <Icon name="clock" size={16} /><h4 className="grow">{lang === "es" ? "Actividad" : "Activity"}</h4>
            <span style={{ transform: actOpen ? "rotate(180deg)" : "none", transition: "transform .2s", display: "flex", color: "var(--text-muted)" }}><Icon name="chevd" size={16} /></span>
          </button>
        </div>
        {actOpen && (
          <div className="ws-block-body"><div className="timeline">
            {detail.events.length === 0 ? <div className="muted t-sm">—</div> :
              detail.events.map((e) => {
                const au = e.actor_id ? agentMap.get(e.actor_id) : null;
                return (
                  <div className="tl" key={e.id}>
                    <div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : e.kind === "lock" ? "lock" : "clock"} size={13} /></div></div>
                    <div className="tl-body">
                      <div className="row gap-1" style={{ alignItems: "center", flexWrap: "wrap" }}>
                        {au
                          ? <Avatar name={au.name} initials={deriveInitials(au.name)} color={au.color} src={au.avatar_url ?? undefined} size={16} />
                          : <span title={lang === "es" ? "Automático" : "Automated"} style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--surface-3)", color: "var(--text-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="bolt" size={10} /></span>}
                        <span>{e.text}</span>
                      </div>
                      <div className="tl-time">{(au?.name ? au.name + " · " : "") + relTime(e.created_at, lang)}</div>
                    </div>
                  </div>
                );
              })}
          </div></div>
        )}
      </>
    ),
  };

  return (
    <div className="chatcol ctx" style={{ position: "relative" }}>
      <div className="ws scroll">
        <div className="ws-contact">
          <div className="row gap-3">
            <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} color={avatarColor(detail.contact?.phone)} size={52}
              badge={(() => { const wsA = detail.assignee_id ? agents.find((x) => x.id === detail.assignee_id) : null; return wsA ? { initials: deriveInitials(wsA.name), color: wsA.color, src: wsA.avatar_url, title: (lang === "es" ? "Atiende " : "Handled by ") + wsA.name } : null; })()} />
            <div className="grow" style={{ minWidth: 0 }}>
              {editingName ? (
                <input className="inp-inline" style={{ width: "100%" }} value={nameVal} autoFocus
                  onChange={(e) => setNameVal(e.target.value)} onBlur={saveName}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }} />
              ) : (
                <div style={{ fontWeight: 800, fontSize: 16 }} className="truncate">{detail.contact?.name}</div>
              )}
              <div className="row gap-2" style={{ marginTop: 3 }}><Icon name="whatsapp" size={14} /><span className="mono t-sm muted nowrap">{detail.contact?.phone}</span></div>
            </div>
            <div className="row gap-1" style={{ alignSelf: "flex-start", marginTop: -2 }}>
              <button ref={actionsBtn} className={"iconbtn sm" + (actionsRect ? " active" : "")} title={lang === "es" ? "Acciones" : "Actions"} onClick={() => setActionsRect(actionsRect ? null : actionsBtn.current?.getBoundingClientRect() ?? null)}><Icon name="bolt" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Historial completo" : "Full history"} onClick={onOpen360}><Icon name="eye" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Renombrar" : "Rename"} onClick={() => setEditingName(true)}><Icon name="edit" size={15} /></button>
              {/* Si no hay quien lo atienda, se dice. Antes el clic encendía una bandera que en un
                  número oficial nadie iba a mirar nunca: el botón parecía funcionar y no hacía nada. */}
              <button className="iconbtn sm" title={lang === "es" ? "Buscar nombre" : "Fetch name"} disabled={pending}
                onClick={() => start(async () => {
                  const r = await requestContactInfo(detail.contact!.id);
                  if (!r.ok) {
                    pushToast({
                      kind: "info",
                      title: r.reason === "official"
                        ? (lang === "es" ? "Aquí el nombre llega solo" : "The name arrives on its own here")
                        : (lang === "es" ? "Sin conexión a WhatsApp" : "WhatsApp not connected"),
                      message: r.reason === "official"
                        ? (lang === "es"
                            ? "Con un número oficial, WhatsApp manda el nombre del perfil con el mensaje: no hay nada que buscar a mano."
                            : "On an official number, WhatsApp sends the profile name with the message — there's nothing to fetch by hand.")
                        : (lang === "es"
                            ? "Se buscará en cuanto el número vuelva a conectarse."
                            : "It will be looked up as soon as the number reconnects."),
                      key: "fetch-name",
                    });
                    return;
                  }
                  refresh();
                })}><Icon name="refresh" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Eliminar chat" : "Delete chat"} onClick={removeChat}><Icon name="trash" size={15} /></button>
            </div>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {(detail.contact?.tags ?? []).map((tg) => <Pill key={tg} color={tagColor(tg)}><Icon name="tag" size={10} />{tg}</Pill>)}
            {detail.area && <Pill color={detail.area.color as PillColor}>{detail.area.name}</Pill>}
          </div>
          <div className="col gap-1" style={{ paddingTop: 4 }}>
            {!personal && <div className="kv"><span className="k">{lang === "es" ? "Total gastado" : "Lifetime"}</span><span className="v mono">${detail.orders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString("es-MX")}</span></div>}
            <div className="kv"><span className="k">{lang === "es" ? "Primer contacto" : "First seen"}</span><span className="v">{detail.contact?.created_at ? new Date(detail.contact.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span></div>
          </div>
          <button className="btn btn-dark btn-block" style={{ marginTop: 2 }} onClick={onOpen360}><Icon name="eye" size={15} />{lang === "es" ? "Historial completo" : "Full history"}<span className="grow" /><Icon name="arrowr" size={15} /></button>
        </div>

        <ReorderList items={blockOrder} getKey={(id) => id} onReorder={commitBlockOrder} className="col gap-3"
          itemClassName="ws-block ws-reorder" renderItem={(id, handle) => blockContent[id](handle)} />
      </div>
      <div className="col-resizer" onPointerDown={onResizeStart} title="" />
      {showXfer && (
        <TransferModal agents={agents} areas={areas} allowUnassign onClose={() => setShowXfer(false)}
          onConfirm={async (dest) => {
            // Pinned + reassigning elsewhere → confirm; transferring releases the lock.
            if (detail.locked_to && (dest.type !== "agent" || dest.id !== detail.locked_to)) {
              const name = agents.find((a) => a.id === detail.locked_to)?.name ?? (lang === "es" ? "un agente" : "an agent");
              if (!(await ask(lockConfirmOpts(name, lang)))) return false; // cancelled → keep the transfer modal open
            }
            if (dest.type === "unassign") patch({ assignee_id: null, locked_to: null });
            else if (dest.type === "agent") {
              patch({ assignee_id: dest.id, locked_to: null });
              if (dest.id === meId) onAssignedToMe?.(detail.id); // misma regla que el Transferir del encabezado
            }
            else { const ar = areas.find((a) => a.id === dest.id); patch({ area: ar ? { name: ar.name, color: ar.color } : detail.area, locked_to: null }); }
            await transferConv(detail.id, dest.type, dest.id); refresh();
          }} />
      )}
      {tagRect && detail.contact && (
        <TagPicker businessId={businessId} current={detail.contact.tags ?? []} rect={tagRect}
          onPick={(t) => { patch({ contact: detail.contact ? { ...detail.contact, tags: Array.from(new Set([...(detail.contact.tags ?? []), t])) } : detail.contact }); start(async () => { await addContactTag(detail.contact!.id, t); refresh(); }); }}
          onRemove={(t) => { patch({ contact: { ...detail.contact!, tags: (detail.contact!.tags ?? []).filter((x) => x !== t) } }); start(async () => { await removeContactTag(detail.contact!.id, t); refresh(); }); }}
          onClose={() => setTagRect(null)} />
      )}
      {actionsRect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 180 }} onClick={() => setActionsRect(null)} />
          <div className="menu" style={{ position: "fixed", top: actionsRect.bottom + 6, right: Math.max(8, window.innerWidth - actionsRect.right), width: 248, zIndex: 181, padding: 10 }}>
            <div className="menu-label">{lang === "es" ? "Acciones" : "Actions"}</div>
            <div className="actions-grid">
              <StatusControl detail={detail} />
              <SnoozeControl detail={detail} />
              <button className="act" onClick={() => { setActionsRect(null); setShowXfer(true); }}><Icon name="swap" />{lang === "es" ? "Transferir" : "Transfer"}</button>
              <button ref={tagBtn} className="act" disabled={!detail.contact} onClick={() => { if (tagBtn.current) setTagRect(tagBtn.current.getBoundingClientRect()); }}><Icon name="tag" />{lang === "es" ? "Etiqueta" : "Tag"}</button>
              <button className="act" disabled={pending} onClick={() => start(async () => { await setConvHidden(detail.id, !detail.hidden); headerRefresh(); })}>
                <Icon name="eye" />{detail.hidden ? (lang === "es" ? "Mostrar" : "Unhide") : (lang === "es" ? "Ocultar" : "Hide")}
              </button>
              <button className={"act" + (detail.muted ? " warn" : "")} title={lang === "es" ? "Al desconectar, los mensajes entrantes ya no se guardan" : "When disconnected, incoming messages are no longer saved"} onClick={() => { patch({ muted: !detail.muted }); start(async () => { await setConvMuted(detail.id, !detail.muted); headerRefresh(); }); }}>
                <Icon name="wifioff" />{detail.muted ? (lang === "es" ? "Conectar chat" : "Connect chat") : (lang === "es" ? "Desconectar chat" : "Disconnect chat")}
              </button>
              {detail.locked_to
                ? <button className="act warn" title={lang === "es" ? "Quitar el candado para que pueda reasignarse" : "Remove the pin so it can be reassigned"} onClick={() => { patch({ locked_to: null }); start(async () => { await unlockConv(detail.id); headerRefresh(); }); }}>
                    <Icon name="lock" />{lang === "es" ? "Soltar cliente" : "Release client"}
                  </button>
                : <button className="act" title={lang === "es" ? "Mantener este cliente asignado a ti pase lo que pase" : "Keep this client assigned to you no matter what"} onClick={() => { patch({ locked_to: meId, assignee_id: meId }); start(async () => { await lockConvToMe(detail.id); headerRefresh(); }); }}>
                    <Icon name="lock" />{lang === "es" ? "Mantener conmigo" : "Keep with me"}
                  </button>}
              {detail.status === "resolved"
                ? <button className="act full" onClick={() => { patch({ status: "open" }); start(async () => { const r = await setConvStatus(detail.id, "open"); flowToast(r.flows, lang); headerRefresh(); }); }}><Icon name="dot" />{lang === "es" ? "Reabrir" : "Reopen"}</button>
                : <button className="act good full" onClick={() => { patch({ status: "resolved" }); start(async () => { const r = await setConvStatus(detail.id, "resolved"); flowToast(r.flows, lang); headerRefresh(); }); }}><Icon name="checks" />{lang === "es" ? "Resolver" : "Resolve"}</button>}
            </div>
          </div>
        </>
      )}
      {openOrder && (
        <OrderDrawer detail={openOrder} stages={stages} areas={areas} agents={agents} products={products} businessId={businessId}
          convDetail={detail} connected={connected} shipping={shipping} invoicing={invoicing} doneFromStageId={doneFromStageId} manualMarginPct={manualMarginPct}
          // Los pedidos del chat salen del detalle de la conversación, que este componente guarda
          // en estado: `refresh()` lo vuelve a pedir. Sin esto, cambiar la etapa desde el cajón
          // dejaba la tarjeta del pedido en el chat con la etapa anterior.
          onChanged={refresh}
          onClose={() => { setOpenOrder(null); refresh(); }} />
      )}
      {showNewTask && (
        <NewOrderModal embedded businessId={businessId} areas={areas} stages={stages} products={products} contacts={[]} doneFromStageId={doneFromStageId}
          // El id, no solo el nombre: el chat SABE de qué contacto se trata, y resolver por nombre
          // en el servidor puede caer en un homónimo (o crear uno nuevo sin conversación).
          defaultContact={detail.contact?.name ?? ""} defaultContactId={detail.contact?.id ?? null} invoice={invoice}
          onClose={() => setShowNewTask(false)} onCreated={() => { setShowNewTask(false); refresh(); }} />
      )}
    </div>
  );
}

/** El pill de estado del encabezado, clicable: abre el mismo menú de estados que StatusControl.
 *  Existe porque "Resuelto" como texto muerto obligaba a ir al panel lateral solo para reabrir. */
function HeaderStatusPill({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const refresh = useChatHeaderRefresh();
  const patch = useChatPatch();
  const flowToast = useFlowToast();
  const { ref, open, rect, toggle, close } = usePopover();
  const [, start] = useTransition();
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} onClick={toggle} title={lang === "es" ? "Cambiar estado" : "Change status"}
        style={{ all: "unset", cursor: "pointer", display: "inline-flex" }}>
        <Pill color={STATUS_COLOR[detail.status]} dot>{STATUS_LABEL[detail.status][lang]}<Icon name="chevd" size={11} /></Pill>
      </button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={menuStyle(rect, { width: 180, height: 130, align: "right" })}>
            {(["open", "pending", "resolved"] as const).map((s) => (
              <button className="menu-item" key={s} onClick={() => { close(); if (s === detail.status) return; patch({ status: s }); start(async () => { const r = await setConvStatus(detail.id, s); flowToast(r.flows, lang); refresh(); }); }}>
                <Pill color={STATUS_COLOR[s]} dot>{STATUS_LABEL[s][lang]}</Pill>
                {s === detail.status && <Icon name="check" size={13} />}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function StatusControl({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const refresh = useChatHeaderRefresh();
  const patch = useChatPatch();
  const flowToast = useFlowToast();
  const { ref, open, rect, toggle, close } = usePopover();
  const [, start] = useTransition();
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} className="act" onClick={toggle}><Icon name="dot" />{lang === "es" ? "Estado" : "Status"}</button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={menuStyle(rect, { width: 180, height: 240, gap: 6 })}>
            {(["open", "pending", "resolved"] as const).map((s) => (
              <button className="menu-item" key={s} onClick={() => { close(); patch({ status: s }); start(async () => { const r = await setConvStatus(detail.id, s); flowToast(r.flows, lang); refresh(); }); }}>
                <Pill color={STATUS_COLOR[s]} dot>{STATUS_LABEL[s][lang]}</Pill>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function SnoozeControl({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const refresh = useChatHeaderRefresh();
  const { ref, open, rect, toggle, close } = usePopover();
  const [, start] = useTransition();
  const snoozed = detail.snoozed_until ? new Date(detail.snoozed_until).getTime() > Date.now() : false;
  const apply = (iso: string | null) => { close(); start(async () => { await snoozeConv(detail.id, iso); refresh(); }); };

  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} className={"act" + (snoozed ? " warn" : "")} onClick={toggle}><Icon name="clock" />{lang === "es" ? "Posponer" : "Snooze"}</button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={menuStyle(rect, { width: 220, height: 280, gap: 6 })}>
          {snoozeShortcuts(lang).map((o) => (
            <button className="menu-item" key={o.label} onClick={() => apply(o.iso)}><Icon name="clock" size={15} />{o.label}</button>
          ))}
          <div className="menu-sep" />
          <div style={{ padding: "4px 8px" }}>
            <div className="t-xs muted" style={{ marginBottom: 4 }}>{lang === "es" ? "Fecha personalizada" : "Custom date"}</div>
            <input type="datetime-local" className="inp-inline" style={{ width: "100%" }}
              onChange={(e) => { if (e.target.value) apply(new Date(e.target.value).toISOString()); }} />
          </div>
          {snoozed && (
            <>
              <div className="menu-sep" />
              <button className="menu-item" onClick={() => apply(null)}><Icon name="check" size={15} />{lang === "es" ? "Reactivar ahora" : "Un-snooze now"}</button>
            </>
          )}
          </div>
        </>
      )}
    </span>
  );
}

/** Local clock time a message was sent, e.g. "3:45 p. m." / "3:45 PM". */
function clockTime(iso: string | null, lang: "es" | "en"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" });
}
/** Full local date+time, for hover tooltips. */
function fullStamp(iso: string | null, lang: "es" | "en"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function relTime(iso: string | null, lang: "es" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return lang === "es" ? "ahora" : "now";
  if (diff < 60) return `${Math.floor(diff)}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" });
}

export function dayLabel(iso: string, lang: "es" | "en"): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return lang === "es" ? "Hoy" : "Today";
  if (d.toDateString() === yest.toDateString()) return lang === "es" ? "Ayer" : "Yesterday";
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "long", day: "2-digit", month: "long" });
}

const fmtBytes = (n?: number | null) => {
  if (!n) return "";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

/** Adjunto pesado que aún no se ha bajado (0067).
 *
 *  Al pedirlo se marca pending_op y el worker lo baja; el UPDATE vuelve por realtime, así que no
 *  hace falta sondear — cuando llegue media_url este bloque desaparece solo.
 *
 *  El caso "expired" es esperable, no un bug: WhatsApp purga su CDN a los pocos días y ahí el
 *  archivo ya no existe en ningún lado. Por eso se dice explícito qué hacer. */
function PendingMedia({ m }: { m: ChatMessage }) {
  const { lang } = useApp();
  const es = lang === "es";
  const [asked, setAsked] = useState(false);
  const expired = m.media_fetch_error === "expired";
  // El archivo existe pero no cabe en la memoria del worker. Se decide por el TAMAÑO, que ya viene
  // guardado, y no solo por el error de un intento previo: para un archivo de 238 MB el resultado
  // se sabe de antemano, así que no hay por qué ofrecer un botón, hacer esperar y luego enseñar un
  // fallo. Y volver a pulsarlo nunca funcionaría.
  const tooBig = m.media_fetch_error === "too-big" || (m.media_size ?? 0) > MAX_MEDIA_FETCH_BYTES;
  const failed = !!m.media_fetch_error && !expired && !tooBig;

  // `expired` va antes que `tooBig`: es un hecho comprobado de un intento real, mientras que
  // "demasiado grande" es una deducción por el tamaño. Si un archivo enorme además caducó, el
  // motivo útil es que caducó.
  if (expired) {
    return (
      <span className="row gap-2" style={{ alignItems: "center", padding: "6px 4px", color: "var(--text-faint)", fontSize: 12.5 }}>
        <Icon name="file" size={15} />
        <span>{m.media_name || (es ? "Archivo" : "File")} · {es ? "caducó en WhatsApp, pídelo de nuevo" : "expired on WhatsApp, ask for it again"}</span>
      </span>
    );
  }

  if (tooBig) {
    return (
      <span className="row gap-2" style={{ alignItems: "center", padding: "6px 4px", color: "var(--text-faint)", fontSize: 12.5 }}>
        <Icon name="file" size={15} />
        <span>
          {m.media_name || (es ? "Archivo" : "File")} · {fmtBytes(m.media_size)} ·{" "}
          {es ? "demasiado grande, ábrelo en tu teléfono" : "too large, open it on your phone"}
        </span>
      </span>
    );
  }
  return (
    <span className="row gap-2" style={{ alignItems: "center", padding: "6px 4px" }}>
      <span className="doc-ic" style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="file" size={17} /></span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 12.5, display: "block" }} className="truncate">{m.media_name || (es ? "Archivo" : "File")}</span>
        <span className="t-xs muted">{fmtBytes(m.media_size)}{failed ? (es ? " · no se pudo bajar" : " · couldn't download") : ""}</span>
      </span>
      <button className="btn btn-sm btn-outline" disabled={asked}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAsked(true); requestMediaFetch(m.id); }}>
        {asked ? (es ? "Bajando…" : "Downloading…") : <><Icon name="download" size={14} />{es ? "Descargar" : "Download"}</>}
      </button>
    </span>
  );
}
