"use client";
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Spinner } from "@/components/Spinner";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Agent, ConvListItem, ConvDetail, ChatMessage } from "@/lib/chat";
import type { Area, Stage } from "@/lib/business";
import { CustomerOverlay } from "@/components/chat/CustomerOverlay";
import { OrderDrawer } from "@/components/OrderDrawer";
import { NewOrderModal } from "@/components/OrdersTable";
import { loadOrderDetail } from "@/app/(app)/orders/actions";
import type { OrderDetail } from "@/lib/orders";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { MentionTextarea } from "@/components/MentionTextarea";
import { TagPicker } from "@/components/TagPicker";
import { ReorderList } from "@/components/ReorderList";
import { tagColor } from "@/lib/types";
import { TransferModal } from "@/components/TransferModal";
import {
  sendMessage, sendMediaMessage, editMessage, deleteMessage, setConvStatus, acceptConv, addConvNote, transferConv, setConvHidden, snoozeConv,
  deleteConv, renameContact, requestContactInfo, markConvRead, addContactTag, removeContactTag, reactToMessage, retryMessage, forwardMessage, startConversation, sendSticker, toggleStickerFavorite,
} from "@/app/(app)/chat/actions";
import { useToast } from "@/components/Toast";
import { liveList, liveMessages, liveConvHeader, liveDetail, loadOlderMessages, loadStickerTray } from "@/app/(app)/chat/live-actions";
import type { StickerItem } from "@/lib/chat";
import { MSG_PAGE } from "@/lib/types";
import { fetchLinkMeta, type LinkMeta } from "@/app/(app)/chat/link-actions";

/** Render text with clickable URLs. */
function linkify(text: string): React.ReactNode {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", wordBreak: "break-all" }} onClick={(e) => e.stopPropagation()}>{p}</a>
      : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}
const firstUrl = (text: string) => text.match(/https?:\/\/[^\s]+/)?.[0] ?? null;

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
    id: c.id, status: c.status, assignee_id: c.assignee_id, unread: c.unread,
    hidden: c.hidden, snoozed_until: c.snoozed_until, area: c.area,
    contact: c.contact
      ? { id: c.contact.id, name: c.contact.name, phone: c.contact.phone, tags: c.contact.tags ?? [], avatar_url: c.contact.avatar_url, created_at: null }
      : null,
    typing_until: c.typing_until,
    is_group: c.is_group,
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
function LinkPreview({ url, onReady }: { url: string; onReady?: () => void }) {
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
function useChatRefresh() {
  const ctx = useContext(ChatRefreshContext);
  const router = useRouter();
  return ctx ?? (() => router.refresh());
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
 *  by a scrolling/overflow ancestor. */
function usePopover() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => { if (!open && ref.current) setRect(ref.current.getBoundingClientRect()); setOpen((o) => !o); };
  return { ref, open, rect, toggle, close: () => setOpen(false) };
}

/** Reserve the exact display box (from stored w/h, or a default) so media never reflows the
 *  thread when it finishes loading — no "pop", and the scroll-to-bottom stays accurate. */
function mediaBox(m: ChatMessage, maxW: number, maxH: number, defW: number, defH: number) {
  const meta = (m.meta ?? {}) as { w?: number; h?: number };
  if (meta.w && meta.h && meta.w > 0 && meta.h > 0) {
    const s = Math.min(maxW / meta.w, maxH / meta.h, 1);
    return { width: Math.max(60, Math.round(meta.w * s)), height: Math.max(60, Math.round(meta.h * s)) };
  }
  return { width: defW, height: defH };
}

function MediaImage({ m, url, onImage }: { m: ChatMessage; url: string; onImage?: (id: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const isSticker = m.type === "sticker";
  const box = isSticker ? mediaBox(m, 130, 130, 130, 130) : mediaBox(m, 240, 300, 220, 165);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="media-frame" style={{ ...box, cursor: "zoom-in" }}
      onClick={(e) => { if (onImage) { e.preventDefault(); onImage(m.id); } }}>
      {!loaded && <span className="media-skeleton" />}
      <img src={url} alt="" onLoad={() => setLoaded(true)} className="media-el" style={{ objectFit: isSticker ? "contain" : "cover", opacity: loaded ? 1 : 0 }} />
    </a>
  );
}

/** Full-screen photo viewer with prev/next + per-photo download/forward/delete. */
function Lightbox({ items, index, onClose, onForward, onDelete }: { items: ChatMessage[]; index: number; onClose: () => void; onForward: (m: ChatMessage) => void; onDelete: (m: ChatMessage) => void }) {
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
  async function download() {
    try {
      const res = await fetch(url); const blob = await res.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = m.media_name || (m.type === "sticker" ? "sticker.webp" : "foto.jpg"); a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch { window.open(url, "_blank"); }
  }
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={download} title={lang === "es" ? "Descargar" : "Download"}><Icon name="download" size={20} /></button>
        <button onClick={() => onForward(m)} title={lang === "es" ? "Reenviar" : "Forward"}><Icon name="forward" size={20} /></button>
        {m?.direction === "out" && <button onClick={() => onDelete(m)} title={lang === "es" ? "Eliminar" : "Delete"}><Icon name="trash" size={20} /></button>}
        <button onClick={onClose} title={lang === "es" ? "Cerrar" : "Close"}><Icon name="x" size={20} /></button>
      </div>
      {items.length > 1 && <button className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="prev"><span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><Icon name="chevd" size={26} /></span></button>}
      <img src={url} alt="" className="lb-img" onClick={(e) => e.stopPropagation()} />
      {items.length > 1 && <button className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="next"><span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon name="chevd" size={26} /></span></button>}
      {items.length > 1 && <div className="lb-count">{i + 1} / {items.length}</div>}
    </div>
  );
}

const fmtTime = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; };

/** Voice-note / audio player. WhatsApp ships OGG/Opus voice notes whose duration Chrome
 *  miscomputes (often ~half, or Infinity), which makes the native <audio controls> stall or stop
 *  early. We force the browser to scan to the real end once (seek to a huge time → it re-reads the
 *  last page → durationchange fires with the true length), then drive a small custom UI. */
function AudioPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const fixing = useRef(false);

  // Accept a finite duration; otherwise kick the one-time "seek to end" scan.
  const settle = () => {
    const a = ref.current; if (!a) return;
    const d = a.duration;
    if (isFinite(d) && d > 0) {
      setDur(d);
      if (fixing.current) { fixing.current = false; try { a.currentTime = 0; } catch {} setCur(0); } // undo the end-seek
    } else if (!fixing.current) { fixing.current = true; try { a.currentTime = 1e101; } catch {} }
  };
  const onTimeUpdate = () => {
    const a = ref.current; if (!a) return;
    if (fixing.current) { // the forced end-seek landed → real duration is known now
      if (isFinite(a.duration) && a.duration > 0) setDur(a.duration);
      fixing.current = false;
      try { a.currentTime = 0; } catch {}
      setCur(0);
      return;
    }
    setCur(a.currentTime);
  };
  const toggle = () => {
    const a = ref.current; if (!a) return;
    if (a.paused) { a.play().catch(() => {}); } else { a.pause(); }
  };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = ref.current; if (!a || !dur) return;
    const v = Number(e.target.value); a.currentTime = v; setCur(v);
  };

  return (
    <div className="aud">
      <audio ref={ref} src={url} preload="metadata"
        onLoadedMetadata={settle} onDurationChange={settle} onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCur(0); }} />
      <button className="aud-btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing
          ? <svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          : <svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>}
      </button>
      <input className="aud-range" type="range" min={0} max={dur || 0} step="0.01" value={Math.min(cur, dur || 0)} onChange={seek} disabled={!dur} />
      <span className="aud-time mono">{fmtTime(cur)} / {dur ? fmtTime(dur) : "–:––"}</span>
    </div>
  );
}

/** One sticker in the send tray: click to send, star toggles favorite. */
function StickerCell({ s, onSend, onFav, lang }: { s: StickerItem; onSend: () => void; onFav: () => void; lang: "es" | "en" }) {
  return (
    <div className="sticker-cell">
      <button className="sticker-pick" onClick={onSend} title={lang === "es" ? "Enviar sticker" : "Send sticker"}><img src={s.url} alt="" loading="lazy" /></button>
      <button className={"sticker-fav" + (s.fav ? " on" : "")} onClick={(e) => { e.stopPropagation(); onFav(); }} title={s.fav ? (lang === "es" ? "Quitar de favoritos" : "Remove favorite") : (lang === "es" ? "Agregar a favoritos" : "Add to favorites")}>{s.fav ? "★" : "☆"}</button>
    </div>
  );
}

function MediaBlock({ m, onImage }: { m: ChatMessage; onImage?: (id: string) => void }) {
  const url = m.media_url ?? undefined;
  if (!url) return null;
  if (m.type === "image" || m.type === "sticker") return <MediaImage m={m} url={url} onImage={onImage} />;
  if (m.type === "video") {
    const box = mediaBox(m, 260, 320, 260, 180);
    return <div className="media-frame" style={box}><video src={url} controls className="media-el" style={{ objectFit: "cover" }} /></div>;
  }
  if (m.type === "audio") return <AudioPlayer url={url} />;
  // document / other
  return (
    <a href={url} target="_blank" rel="noreferrer" className="row gap-2" style={{ padding: "6px 4px", textDecoration: "none", color: "inherit" }}>
      <span className="doc-ic" style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="file" size={17} /></span>
      <span style={{ minWidth: 0 }}><span style={{ fontWeight: 600, fontSize: 12.5, display: "block" }} className="truncate">{m.media_name || "Archivo"}</span><span className="t-xs muted">{(m.media_mime || "").split("/").pop()}</span></span>
    </a>
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

function QuotedBlock({ m }: { m: ChatMessage }) {
  const label = m.deleted ? "…" : (m.body || (m.type !== "text" ? "📎 " + m.type : ""));
  return <div className="truncate" style={{ borderLeft: "3px solid var(--brand)", padding: "3px 8px", marginBottom: 4, background: "rgba(0,0,0,.05)", borderRadius: 6, fontSize: 12, maxWidth: 240 }}>{label}</div>;
}

function MsgMenu({ m, out, onReply, onEdit, onDelete, onReact, onForward }: { m: ChatMessage; out: boolean; onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (rect: DOMRect) => void; onForward: () => void }) {
  const { lang } = useApp();
  const { ref, open, rect, toggle, close } = usePopover();
  return (
    <span className={"msg-menu" + (open ? " open" : "")} style={{ position: "absolute", top: 3, [out ? "right" : "left"]: 4 }}>
      <button ref={ref} className="msg-menu-btn" onClick={toggle} aria-label="Menu"><Icon name="dots" size={14} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, [out ? "right" : "left"]: out ? window.innerWidth - rect.right : rect.left, width: 160, zIndex: 201 }}>
            <button className="menu-item" onClick={() => { const r = rect; close(); onReact(r); }}><span style={{ fontSize: 15, width: 15, display: "inline-flex", justifyContent: "center" }}>😊</span>{lang === "es" ? "Reaccionar" : "React"}</button>
            <button className="menu-item" onClick={() => { close(); onReply(); }}><Icon name="swap" size={15} />{lang === "es" ? "Responder" : "Reply"}</button>
            {!m.deleted && (m.type === "text" || !!m.media_url) && <button className="menu-item" onClick={() => { close(); onForward(); }}><Icon name="forward" size={15} />{lang === "es" ? "Reenviar" : "Forward"}</button>}
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
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, [out ? "right" : "left"]: out ? window.innerWidth - rect.right : rect.left, width: 180, zIndex: 201 }}>
            <button className="menu-item" onClick={() => { close(); onForward(); }}><Icon name="forward" size={15} />{lang === "es" ? "Reenviar todas" : "Forward all"}</button>
            {onDelete && <button className="menu-item danger" onClick={() => { close(); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar todas" : "Delete all"}</button>}
          </div>
        </>
      )}
    </span>
  );
}

function isArchived(c: { hidden: boolean; snoozed_until: string | null }): boolean {
  return c.hidden || (c.snoozed_until ? new Date(c.snoozed_until).getTime() > Date.now() : false);
}

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

export function ChatScreen({
  list: listProp, detail: detailProp, selectedId, agents, areas, stages, meId, businessId, connected,
}: {
  list: ConvListItem[];
  detail: ConvDetail | null;
  selectedId: string | null;
  agents: Agent[];
  areas: Area[];
  stages: Stage[];
  meId: string;
  businessId: string;
  connected: boolean;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [show360, setShow360] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [tab, setTab] = useState<"mine" | "unassigned" | "all">("mine");

  // Local copies kept live by targeted realtime refetches; re-seeded when the server sends new props.
  const [list, setList] = useState(listProp);
  useEffect(() => { setList(listProp); }, [listProp]);
  const [detail, setDetail] = useState(detailProp);
  useEffect(() => { setDetail(detailProp); }, [detailProp]);
  const detailIdRef = useRef<string | null>(null);
  detailIdRef.current = detail?.id ?? null;
  const patchDetail = useCallback((patch: Partial<ConvDetail>) => setDetail((c) => (c ? { ...c, ...patch } : c)), []);

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
  const openConv = useCallback((c: ConvListItem) => {
    setDetail(_detailCache.get(c.id) ?? skeletonDetail(c));
    // Persist immediately on the explicit click (the URL lags behind the optimistic open, so the
    // URL-guarded effect below can miss it and the "last chat" cookie would get stuck).
    try { document.cookie = `ht_lastChat=${c.id}; path=/; max-age=2592000; SameSite=Lax`; } catch {}
  }, []);

  // Targeted refresh used by click handlers instead of refresh(): refetches the open
  // conversation (incl. notes/orders, which aren't realtime-published) + the list — not the route.
  const softRefresh = useCallback(() => {
    const id = detailIdRef.current;
    if (id) liveDetail(id).then((d) => { if (d) setDetail((c) => (c && c.id === d.id ? d : c)); }).catch(() => {});
    liveList(businessId).then(setList).catch(() => {});
  }, [businessId]);

  // Live updates via targeted refetches (no full route refresh — only what changed).
  useEffect(() => {
    const supabase = createClient();
    let tl: ReturnType<typeof setTimeout>, tm: ReturnType<typeof setTimeout>, th: ReturnType<typeof setTimeout>;
    const softList = () => { clearTimeout(tl); tl = setTimeout(() => { liveList(businessId).then(setList).catch(() => {}); }, 250); };
    const softMsgs = () => { const id = detailIdRef.current; if (!id) return; clearTimeout(tm); tm = setTimeout(() => { liveMessages(id).then((ms) => setDetail((c) => (c && c.id === id ? { ...c, messages: mergeMsgs(c.messages, ms) } : c))).catch(() => {}); }, 120); };
    const softHeader = () => { const id = detailIdRef.current; if (!id) return; clearTimeout(th); th = setTimeout(() => { liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {}); }, 250); };
    const ch = supabase
      .channel(`chat-${businessId}`)
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
      .subscribe();
    return () => { clearTimeout(tl); clearTimeout(tm); clearTimeout(th); supabase.removeChannel(ch); };
  }, [businessId]);

  // Safety net: realtime can drop an event (token refresh, brief socket reconnect). Re-sync the
  // open conversation + list periodically (only while the tab is visible) and whenever the tab
  // regains focus, so nothing stays stale until you reopen the chat.
  useEffect(() => {
    const resync = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const id = detailIdRef.current;
      if (id) {
        liveMessages(id).then((ms) => setDetail((c) => (c && c.id === id ? { ...c, messages: mergeMsgs(c.messages, ms) } : c))).catch(() => {});
        liveConvHeader(id).then((h) => { if (h) setDetail((c) => (c && c.id === id ? { ...c, ...h } : c)); }).catch(() => {});
      }
      liveList(businessId).then(setList).catch(() => {});
    };
    const i = setInterval(resync, 5000);
    const onFocus = () => resync();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [businessId]);

  // Mark a conversation read when it's open and it has unread (incl. messages that arrive while open).
  useEffect(() => {
    if (detail && detail.unread > 0) { markConvRead(detail.id); setDetail((c) => (c ? { ...c, unread: 0 } : c)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id, detail?.unread]);

  // Remember the last chat the agent actually opened (cookie → the server page reopens it
  // when returning to /chat without an explicit ?c). Only persist when the chat was opened
  // via the URL, so the most-recent default doesn't overwrite it.
  useEffect(() => {
    if (detail && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("c") === detail.id) {
      document.cookie = `ht_lastChat=${detail.id}; path=/; max-age=2592000; SameSite=Lax`;
    }
  }, [detail?.id]);

  // Center column: show/hide + drag-resize (persisted).
  const [ctxVisible, setCtxVisible] = useState(true);
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
  const [statusF, setStatusF] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [areaF, setAreaF] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const areaNames = useMemo(() => [...new Set(list.map((c) => c.area?.name).filter(Boolean))] as string[], [list]);

  const filtered = useMemo(() => {
    return list.filter((c) => {
      // Snoozed/hidden live in a separate view; active list excludes them.
      if (isArchived(c) !== showArchived) return false;
      if (tab === "mine" && c.assignee_id !== meId) return false;
      if (tab === "unassigned" && c.assignee_id != null) return false;
      if (statusF && c.status !== statusF) return false;
      if (areaF && c.area?.name !== areaF) return false;
      if (unreadOnly && !(c.unread > 0)) return false;
      if (q) {
        const hay = (c.contact?.name ?? "") + " " + c.preview;
        if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [list, tab, statusF, q, meId, showArchived, areaF, unreadOnly]);

  const archivedN = list.filter(isArchived).length;

  const mineN = list.filter((c) => c.assignee_id === meId).length;
  const unN = list.filter((c) => c.assignee_id == null).length;

  // Counts for the filter chips — scoped by the active tab/area/archived view (not by the
  // status/unread filters themselves).
  const chipCounts = useMemo(() => {
    const scope = list.filter((c) =>
      isArchived(c) === showArchived &&
      !(tab === "mine" && c.assignee_id !== meId) &&
      !(tab === "unassigned" && c.assignee_id != null) &&
      !(areaF && c.area?.name !== areaF));
    return {
      all: scope.length,
      open: scope.filter((c) => c.status === "open").length,
      pending: scope.filter((c) => c.status === "pending").length,
      resolved: scope.filter((c) => c.status === "resolved").length,
      unread: scope.filter((c) => c.unread > 0).length,
    };
  }, [list, tab, areaF, showArchived, meId]);

  return (
    <ChatRefreshContext.Provider value={softRefresh}>
    <ChatPatchContext.Provider value={patchDetail}>
    <div
      className="chat"
      style={{
        position: "relative",
        gridTemplateColumns: detail && ctxVisible
          ? `${listW}px ${ctxW}px minmax(300px,1fr)`
          : `${listW}px minmax(300px,1fr)`,
      }}
    >
      {/* list column */}
      <div className="chatcol list" style={{ position: "relative" }}>
        <div className="col-resizer" onPointerDown={startListResize} title="" />
        <div className="col-head">
          <div className="seg" style={{ width: "100%" }}>
            {([["mine", lang === "es" ? "Míos" : "Mine", mineN], ["unassigned", lang === "es" ? "Sin asignar" : "Unassigned", unN], ["all", lang === "es" ? "Todos" : "All", null]] as const).map(([id, lbl, n]) => (
              <button key={id} className={tab === id ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab(id)}>
                {lbl}{n != null && n > 0 && <span className="badge badge-soft">{n}</span>}
              </button>
            ))}
          </div>
          <div className="row gap-2">
            <div className="field field-sm field-filled grow">
              <Icon name="search" />
              <input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn btn-sm btn-primary" title={lang === "es" ? "Nueva conversación" : "New conversation"} onClick={() => setShowCompose(true)}><Icon name="plus" size={15} /></button>
          </div>
          <div className="chip-row">
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
            {areaNames.length > 0 && (
              <select className="select select-sm chip-select" value={areaF ?? ""} onChange={(e) => setAreaF(e.target.value || null)}>
                <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
                {areaNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <button className={"chip" + (showArchived ? " on" : "")} onClick={() => setShowArchived((v) => !v)} title={lang === "es" ? "Pospuestos/Ocultos" : "Snoozed/Hidden"}>
              <Icon name="clock" size={12} />{lang === "es" ? "Pospuestos" : "Snoozed"}{archivedN > 0 && <span className="chip-n">{archivedN}</span>}
            </button>
          </div>
        </div>
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
                <Link key={c.id} href={`/chat?c=${c.id}`} onMouseEnter={() => prefetchDetail(c.id)} onClick={() => openConv(c)} className={"conv" + (c.id === (detail?.id ?? selectedId) ? " sel" : "") + (c.unread ? " unread" : "")}>
                  <Avatar name={c.contact?.name} initials={deriveInitials(c.contact?.name || c.contact?.phone || "?")} color={avatarColor(c.contact?.phone)} size={42} />
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
                      {c.area && <Pill color={c.area.color as PillColor}>{c.area.name}</Pill>}
                      {(c.contact?.tags ?? []).slice(0, 3).map((tg) => <Pill key={tg} color={tagColor(tg)}><Icon name="tag" size={10} />{tg}</Pill>)}
                      <span className="grow" />
                      {a ? <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={20} /> : <Pill color="slate">{lang === "es" ? "Sin asignar" : "Unassigned"}</Pill>}
                      {c.unread > 0 && <span className="badge badge-red">{c.unread}</span>}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {detail ? (
        <>
          {ctxVisible && <Workspace detail={detail} agents={agents} areas={areas} stages={stages} businessId={businessId} connected={connected} onResizeStart={startResize} onOpen360={() => setShow360(true)} />}
          <Thread detail={detail} agents={agents} areas={areas} connected={connected} ctxVisible={ctxVisible} onToggleCtx={() => setCtxVisible((v) => !v)} businessId={businessId} />
          {show360 && <CustomerOverlay detail={detail} agents={agents} areas={areas} stages={stages} businessId={businessId} connected={connected} onClose={() => setShow360(false)} />}
        </>
      ) : (
        <div className="chatcol center" style={{ gridColumn: "2 / -1", background: "var(--bg)" }}>
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
export function Thread({ detail, agents, areas, connected, ctxVisible, onToggleCtx, businessId, floating }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; connected: boolean; ctxVisible?: boolean; onToggleCtx?: () => void; businessId: string; floating?: boolean }) {
  const { lang } = useApp();
  const refresh = useChatRefresh();
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
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  function stageFiles(files: FileList | File[]) {
    setStaged((s) => [...s, ...Array.from(files)]);
  }

  // Upload staged files, then send (caption goes on the first item, like WhatsApp).
  async function sendStaged() {
    if (!staged.length) return;
    setSending(true);
    const supabase = createClient();
    try {
      for (let i = 0; i < staged.length; i++) {
        const file = staged[i];
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `${businessId}/out/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
        if (error) { console.error(error); continue; }
        // Store the storage PATH; the private bucket is served via signed URLs on read.
        const mtype = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
        await sendMediaMessage(detail.id, { type: mtype, mediaUrl: path, mime: file.type || "application/octet-stream", name: file.name, caption: i === 0 ? caption.trim() || undefined : undefined });
      }
      setStaged([]); setCaption("");
      refresh();
    } finally {
      setSending(false);
    }
  }
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [canned, setCanned] = useState<{ id: string; title: string; body: string; shortcut: string | null }[]>([]);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const cannedBtn = useRef<HTMLButtonElement>(null);
  const [emojiRect, setEmojiRect] = useState<DOMRect | null>(null);
  const [cannedRect, setCannedRect] = useState<DOMRect | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
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
  const { push } = useToast();

  async function loadStickers() {
    setStickerLoading(true);
    try { setStickerTray(await loadStickerTray(businessId)); } catch {}
    setStickerLoading(false);
  }
  // Send a sticker the business already has (re-sends the stored WebP by message reference).
  function pickSticker(s: StickerItem) {
    setStickerOpen(false);
    setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "sticker", body: null, state: "sent", author_id: null, created_at: new Date().toISOString(), media_url: s.url, media_mime: "image/webp", media_name: null, reply_to: null, deleted: false, forwarded: false, edited: false, meta: null, reactions: [], sender_name: null, sender_jid: null }]);
    start(async () => { await sendSticker(detail.id, s.id); });
  }
  // Star/unstar from the tray (optimistic).
  function favSticker(s: StickerItem) {
    const next = !s.fav;
    setStickerTray((t) => {
      const recent = t.recent.map((x) => (x.id === s.id ? { ...x, fav: next } : x));
      let favorites = t.favorites;
      if (next && !favorites.some((f) => f.url === s.url)) favorites = [{ ...s, fav: true }, ...favorites];
      if (!next) favorites = favorites.filter((f) => f.url !== s.url);
      return { favorites, recent };
    });
    start(async () => { await toggleStickerFavorite(s.id); });
  }

  async function loadCanned() {
    if (canned.length) return;
    const supabase = createClient();
    const { data } = await supabase.from("canned_messages").select("id, title, body, shortcut").eq("business_id", businessId).order("title");
    setCanned((data ?? []) as { id: string; title: string; body: string; shortcut: string | null }[]);
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
  function applySlash(c: { body: string }) {
    const el = taRef.current; if (!el || !slash) return;
    const caret = el.selectionStart;
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
  const lastConvRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const scrollAction = useRef<"bottom" | "preserve" | "follow">("bottom");
  const prevHeight = useRef(0);

  useEffect(() => {
    if (lastConvRef.current !== detail.id) {
      lastConvRef.current = detail.id;
      scrollAction.current = "bottom";
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
  const imageMsgs = useMemo(() => msgs.filter((mm) => (mm.type === "image" || mm.type === "sticker") && mm.media_url && !mm.deleted), [msgs]);
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

  function startEdit(mm: ChatMessage) { setEditing(mm); setReplyTo(null); setText(mm.body ?? ""); }
  function startReply(mm: ChatMessage) { setReplyTo(mm); setEditing(null); }

  function doSend() {
    const body = text.trim();
    if (!body) return;
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
      <div className="chatcol center" style={{ background: "var(--bg)" }}>
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
    <div className="chatcol" style={floating ? { height: "100%", flex: 1, minWidth: 0, width: "100%" } : undefined}>
      <div className="thread-head">
        <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} color={avatarColor(detail.contact?.phone)} size={38} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name}</span>
            <span className="pill pill-green" style={{ height: 18, padding: "0 6px" }}><Icon name="whatsapp" size={11} />WhatsApp</span>
          </div>
          <div className="t-xs muted">{isTyping(detail.typing_until) ? <span className="typing-ind">{lang === "es" ? "escribiendo…" : "typing…"}</span> : assignee ? (lang === "es" ? "Atiende " : "Handled by ") + assignee.name : lang === "es" ? "Sin asignar" : "Unassigned"}</div>
        </div>
        {onToggleCtx && (
          <button className={"iconbtn" + (ctxVisible ? " active" : "")} title={ctxVisible ? (lang === "es" ? "Ocultar panel" : "Hide panel") : (lang === "es" ? "Mostrar panel" : "Show panel")} onClick={onToggleCtx}>
            <Icon name="columns" />
          </button>
        )}
        {!detail.assignee_id && (
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => { await acceptConv(detail.id); refresh(); })}>
            {pending ? <Spinner size={14} /> : <Icon name="check" size={14} />}{lang === "es" ? "Aceptar" : "Accept"}
          </button>
        )}
        <TransferControl detail={detail} agents={agents} areas={areas} />
        {detail.status !== "resolved" ? (
          <button className="iconbtn" title={lang === "es" ? "Resolver" : "Resolve"} style={{ color: "var(--green)" }} disabled={pending}
            onClick={() => { patch({ status: "resolved" }); start(async () => { await setConvStatus(detail.id, "resolved"); refresh(); }); }}>
            {pending ? <Spinner size={15} /> : <Icon name="check" />}
          </button>
        ) : <Pill color="green" dot>{STATUS_LABEL.resolved[lang]}</Pill>}
      </div>

      <div className="thread thread-wa-tint scroll" ref={endRef} onScroll={onThreadScroll}>
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
                <div className={"msg " + (out ? "out" : "in")}>
                  <div className="bubble" style={{ padding: 3 }}>
                    <AlbumMenu out={out} onForward={() => setForwarding(row.items)}
                      onDelete={out ? () => { if (confirm(lang === "es" ? "¿Eliminar todas las fotos para todos?" : "Delete all photos for everyone?")) start(async () => { for (const it of row.items) await deleteMessage(it.id); refresh(); }); } : undefined} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 242 }}>
                      {row.items.slice(0, 4).map((m, idx) => (
                        <a key={m.id} href={m.media_url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => { if (m.media_url) { e.preventDefault(); openLightbox(m.id); } }} style={{ position: "relative", display: "block", aspectRatio: "1 / 1", borderRadius: 6, background: "var(--surface-2)", overflow: "hidden", cursor: "zoom-in" }}>
                          <img src={m.media_url ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
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
            <div className={"msg " + (out ? "out" : "in")}>
              <div className="bubble">
                {author && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-700)", marginBottom: 2 }}>{author.name}</div>}
                {!out && detail.is_group && m.sender_name && <div style={{ fontSize: 11.5, fontWeight: 700, color: senderColor(m.sender_jid || m.sender_name), marginBottom: 2 }}>{m.sender_name}</div>}
                {m.forwarded && !m.deleted && <div className="row gap-1 t-xs muted" style={{ marginBottom: 2, fontStyle: "italic" }}><Icon name="forward" size={12} />{lang === "es" ? "Reenviado" : "Forwarded"}</div>}
                {m.reply_to && msgMap.get(m.reply_to) && <QuotedBlock m={msgMap.get(m.reply_to)!} />}
                {m.deleted ? (
                  <div className="row gap-1" style={{ fontStyle: "italic", opacity: 0.6 }}><Icon name="x" size={12} />{lang === "es" ? "Mensaje eliminado" : "Message deleted"}</div>
                ) : m.type === "location" ? <LocationBlock m={m} />
                  : m.type === "contact" ? <ContactBlock m={m} />
                    : (
                      <>
                        {m.media_url && <MediaBlock m={m} onImage={openLightbox} />}
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
                    onReact={(rect) => setReactTarget({ id: m.id, rect })}
                    onDelete={() => { if (confirm(lang === "es" ? "¿Eliminar mensaje para todos?" : "Delete for everyone?")) start(async () => { await deleteMessage(m.id); refresh(); }); }} />
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
        {(replyTo || editing) && (
          <div className="row gap-2" style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 6 }}>
            <Icon name={editing ? "edit" : "swap"} size={14} />
            <span className="t-xs muted grow truncate">{(editing ? (lang === "es" ? "Editando: " : "Editing: ") : (lang === "es" ? "Respondiendo: " : "Replying: "))}{(editing || replyTo)?.body || (editing || replyTo)?.type}</span>
            <button className="iconbtn sm" onClick={() => { setEditing(null); setReplyTo(null); if (editing) setText(""); }}><Icon name="x" size={14} /></button>
          </div>
        )}
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
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
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
                    <div className="row gap-2"><span style={{ fontWeight: 600, fontSize: 12.5 }}>{c.title}</span>{c.shortcut && <span className="mono t-xs muted">{c.shortcut}</span>}</div>
                    <div className="muted t-xs truncate">{c.body}</div>
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
                        <button key={c.id} className="menu-item" style={{ display: "block", textAlign: "left", height: "auto", padding: "8px 12px" }} onClick={() => { setText((v) => (v ? v + " " : "") + fillVars(c.body)); setCannedOpen(false); }}>
                          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.title}</div>
                          <div className="muted t-xs truncate">{c.body}</div>
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
                  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setStickerOpen(false)} />
                  <div className="menu scroll" style={{ position: "fixed", bottom: window.innerHeight - stickerRect.top + 6, left: Math.max(8, stickerRect.left - 150), width: 300, maxHeight: 340, zIndex: 201, padding: 8 }}>
                    {stickerLoading ? <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>
                      : (stickerTray.favorites.length === 0 && stickerTray.recent.length === 0) ? <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Aún no hay stickers. Aparecerán los que recibas o envíes." : "No stickers yet. The ones you receive or send show up here."}</div>
                        : (
                          <>
                            {stickerTray.favorites.length > 0 && <>
                              <div className="menu-label">{lang === "es" ? "★ Favoritos" : "★ Favorites"}</div>
                              <div className="sticker-grid">{stickerTray.favorites.map((s) => <StickerCell key={"f" + s.id} s={s} onSend={() => pickSticker(s)} onFav={() => favSticker(s)} lang={lang} />)}</div>
                            </>}
                            <div className="menu-label">{lang === "es" ? "Recientes" : "Recent"}</div>
                            <div className="sticker-grid">{stickerTray.recent.map((s) => <StickerCell key={"r" + s.id} s={s} onSend={() => pickSticker(s)} onFav={() => favSticker(s)} lang={lang} />)}</div>
                          </>
                        )}
                  </div>
                </>
              )}
            </span>
            <span className="grow" />
            <button className="btn btn-primary btn-sm" onClick={doSend} disabled={!text.trim() || pending}><Icon name="send" size={15} /> {lang === "es" ? "Enviar" : "Send"}</button>
          </div>
        </div>
      </div>

      {staged.length > 0 && (
        <div className="modal-wrap">
          <div className="scrim" onClick={() => { if (!sending) setStaged([]); }} />
          <div className="modal">
            <div className="modal-head">
              <h3 className="grow">{lang === "es" ? "Enviar archivos" : "Send files"}{staged.length > 1 ? ` (${staged.length})` : ""}</h3>
              <button className="iconbtn" disabled={sending} onClick={() => setStaged([])}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <div className="row gap-2" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                {staged.map((f, i) => <MediaThumb key={i} file={f} onRemove={() => setStaged((s) => s.filter((_, j) => j !== i))} />)}
                <button className="iconbtn" style={{ width: 86, height: 86, border: "1px dashed var(--border-strong)", borderRadius: 10 }} onClick={() => fileRef.current?.click()}><Icon name="plus" /></button>
              </div>
            </div>
            <div className="modal-foot">
              <div className="field field-filled grow"><Icon name="edit" size={15} /><input placeholder={lang === "es" ? "Agrega un comentario…" : "Add a caption…"} value={caption} onChange={(e) => setCaption(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendStaged(); }} autoFocus /></div>
              <button className="btn btn-primary" disabled={sending} onClick={sendStaged}><Icon name="send" size={15} />{sending ? (lang === "es" ? "Enviando…" : "Sending…") : (lang === "es" ? "Enviar" : "Send")}</button>
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
          onDelete={(m) => { setLightbox(null); if (confirm(lang === "es" ? "¿Eliminar foto para todos?" : "Delete photo for everyone?")) start(async () => { await deleteMessage(m.id); refresh(); }); }} />
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
  useEffect(() => { liveList(businessId).then(setConvs).catch(() => {}); }, [businessId]);
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
        <div className="scroll" style={{ flex: 1, padding: "0 8px", minHeight: 0 }}>
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

function MediaThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => (file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
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
function TransferControl({ detail, agents, areas }: { detail: ConvDetail; agents: Agent[]; areas: Area[] }) {
  const { lang } = useApp();
  const refresh = useChatRefresh();
  const patch = useChatPatch();
  const { ref, open, rect, toggle, close } = usePopover();
  const [pending, start] = useTransition();

  function pick(mode: "agent" | "area", id: string) {
    close();
    if (mode === "agent") patch({ assignee_id: id });
    else { const ar = areas.find((a) => a.id === id); patch({ area: ar ? { name: ar.name, color: ar.color } : detail.area }); }
    start(async () => { await transferConv(detail.id, mode, id); refresh(); });
  }

  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} className="btn btn-sm btn-outline" disabled={pending} onClick={toggle}>
        <Icon name="swap" size={14} />{lang === "es" ? "Transferir" : "Transfer"}
      </button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu scroll" style={{ position: "fixed", top: rect.bottom + 6, right: window.innerWidth - rect.right, width: 220, maxHeight: 340, zIndex: 201 }}>
            <div className="menu-label">{lang === "es" ? "A un agente" : "To an agent"}</div>
            {agents.filter((a) => a.role !== "viewer").map((a) => (
              <button className="menu-item" key={a.id} onClick={() => pick("agent", a.id)}>
                <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={20} />{a.name}
              </button>
            ))}
            <div className="menu-sep" />
            <div className="menu-label">{lang === "es" ? "A un área" : "To an area"}</div>
            {areas.map((ar) => (
              <button className="menu-item" key={ar.id} onClick={() => pick("area", ar.id)}>
                <Pill color={ar.color as PillColor}>{ar.name}</Pill>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/* ---------- Workspace (center column) ---------- */
function Workspace({ detail, agents, areas, stages, businessId, connected, onResizeStart, onOpen360 }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; stages: Stage[]; businessId: string; connected: boolean; onResizeStart: (e: React.PointerEvent) => void; onOpen360: () => void }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const refresh = useChatRefresh();
  const patch = useChatPatch();
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
  function removeChat() {
    if (!confirm(lang === "es" ? "¿Eliminar esta conversación y sus mensajes?" : "Delete this conversation and its messages?")) return;
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
                <div className="ocard-top"><span className="ocard-id mono">{o.code}</span><span className="grow" />{o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}</div>
                {o.items?.[0]?.name && <div className="t-xs muted truncate">{o.items[0].name}{o.items.length > 1 ? ` +${o.items.length - 1}` : ""}</div>}
                <div className="ocard-foot">{o.area && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}<span className="grow" />{!personal && <span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>${o.total.toLocaleString("es-MX")}</span>}</div>
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
              detail.events.map((e) => (
                <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{relTime(e.created_at, lang)}</div></div></div>
              ))}
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
            <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} color={avatarColor(detail.contact?.phone)} size={52} />
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
              <button className="iconbtn sm" title={lang === "es" ? "Buscar nombre" : "Fetch name"} disabled={pending} onClick={() => start(async () => { await requestContactInfo(detail.contact!.id); refresh(); })}><Icon name="refresh" size={15} /></button>
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
        <TransferModal agents={agents} areas={areas} onClose={() => setShowXfer(false)}
          onConfirm={async (dest) => {
            if (dest.type === "agent") patch({ assignee_id: dest.id });
            else { const ar = areas.find((a) => a.id === dest.id); patch({ area: ar ? { name: ar.name, color: ar.color } : detail.area }); }
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
              <button className="act" disabled={pending} onClick={() => start(async () => { await setConvHidden(detail.id, !detail.hidden); refresh(); })}>
                <Icon name="eye" />{detail.hidden ? (lang === "es" ? "Mostrar" : "Unhide") : (lang === "es" ? "Ocultar" : "Hide")}
              </button>
              {detail.status === "resolved"
                ? <button className="act full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "open"); refresh(); })}><Icon name="dot" />{lang === "es" ? "Reabrir" : "Reopen"}</button>
                : <button className="act good full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "resolved"); refresh(); })}><Icon name="check" />{lang === "es" ? "Resolver" : "Resolve"}</button>}
            </div>
          </div>
        </>
      )}
      {openOrder && (
        <OrderDrawer detail={openOrder} stages={stages} areas={areas} agents={agents} businessId={businessId}
          convDetail={detail} connected={connected}
          onClose={() => { setOpenOrder(null); refresh(); }} />
      )}
      {showNewTask && (
        <NewOrderModal embedded businessId={businessId} areas={areas} stages={stages} products={[]} contacts={[]}
          defaultContact={detail.contact?.name ?? ""}
          onClose={() => setShowNewTask(false)} onCreated={() => { setShowNewTask(false); refresh(); }} />
      )}
    </div>
  );
}

function StatusControl({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const refresh = useChatRefresh();
  const patch = useChatPatch();
  const { ref, open, rect, toggle, close } = usePopover();
  const [, start] = useTransition();
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={ref} className="act" onClick={toggle}><Icon name="dot" />{lang === "es" ? "Estado" : "Status"}</button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={close} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, width: 180, zIndex: 201 }}>
            {(["open", "pending", "resolved"] as const).map((s) => (
              <button className="menu-item" key={s} onClick={() => { close(); patch({ status: s }); start(async () => { await setConvStatus(detail.id, s); refresh(); }); }}>
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
  const refresh = useChatRefresh();
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
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, width: 220, zIndex: 201 }}>
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

function dayLabel(iso: string, lang: "es" | "en"): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return lang === "es" ? "Hoy" : "Today";
  if (d.toDateString() === yest.toDateString()) return lang === "es" ? "Ayer" : "Yesterday";
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "long", day: "2-digit", month: "long" });
}
