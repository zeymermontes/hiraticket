"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { useConfirm } from "@/components/Confirm";
import { Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { useToast } from "@/components/Toast";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { firstUrl, LinkPreview, MediaThumb, MediaBlock, Lightbox, dayLabel } from "@/components/chat/ChatScreen";
import { useFileDrop, DropOverlay } from "@/components/chat/fileDrop";
import { menuStyle } from "@/lib/popover";
import { keepSubscribed } from "@/lib/realtime";
import { putMessages } from "@/lib/localCache";
import { copyFile, copyLink, canCopyFile, downloadMedia } from "@/lib/mediaDrag";
import { MSG_PAGE } from "@/lib/types";
import type { Agent, ChatMessage } from "@/lib/chat";
import type { InternalThread, InternalMsg } from "@/lib/internal";
import {
  loadInternalThreads, loadInternalMessages, sendInternalMessage, sendInternalMedia, forwardInternalMessage, sendInternalSticker,
  markInternalRead, editInternalMessage, deleteInternalMessage, reactInternalMessage,
} from "@/app/(app)/internal/actions";
import { loadStickerTray } from "@/app/(app)/chat/live-actions";
import { saveStickerFavorite, removeStickerFavorite } from "@/app/(app)/chat/actions";
import { StickerCell } from "@/components/chat/StickerCell";
import { useCachedMedia } from "@/lib/mediaCache";
import { makeImageThumb } from "@/lib/imageThumb";
import { CachedImg } from "@/components/chat/CachedImg";
import type { StickerItem } from "@/lib/chat";
import { useComposerFocus } from "@/lib/composerFocus";

/** Merge message lists by id (incoming wins, so edits/reactions/deletes apply), sorted by time. */
function mergeInternal(a: InternalMsg[], b: InternalMsg[]): InternalMsg[] {
  const map = new Map<string, InternalMsg>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
}

/** Scroll the original message into view and flash it (parity with the clients chat). */
function jumpInternal(id: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("im-" + id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-flash");
  window.setTimeout(() => el.classList.remove("msg-flash"), 1500);
}

function clock(iso: string, lang: "es" | "en") {
  return new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Render internal body text: clickable URLs + highlighted @member mentions (names from the msg). */
function renderBody(body: string, mentionNames: string[]) {
  const esc = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const mentionRe = esc.length ? new RegExp("(@(?:" + esc.join("|") + "))", "g") : null;
  return body.split(/(https?:\/\/[^\s]+)/g).map((part, i) => {
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", wordBreak: "break-all" }} onClick={(e) => e.stopPropagation()}>{part}</a>;
    if (!mentionRe) return <Fragment key={i}>{part}</Fragment>;
    return part.split(mentionRe).map((seg, j) => (/^@/.test(seg) && mentionNames.includes(seg.slice(1)) ? <span key={`${i}-${j}`} className="mention">{seg}</span> : <Fragment key={`${i}-${j}`}>{seg}</Fragment>));
  });
}

export function InternalChat({ initial, businessId, initialChannel }: { initial: { threads: InternalThread[]; agents: Agent[]; meId: string }; businessId: string; initialChannel?: string | null }) {
  const { lang } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const { push } = useToast();
  const [threads, setThreads] = useState(initial.threads);
  const [sel, setSel] = useState<string>(initial.threads[0]?.key ?? "team");
  const [msgs, setMsgs] = useState<InternalMsg[]>([]);
  // Persist text messages to the per-device cache (bodies are encrypted in the DB, so message
  // search runs locally — same as the clients chat). Best-effort, never blocks rendering.
  useEffect(() => {
    const nameOf = (uid: string | null) => initial.agents.find((a) => a.id === uid)?.name ?? null;
    putMessages(msgs.filter((m) => m.body && !m.deleted && !m.id.startsWith("tmp")).map((m) => ({
      businessId, kind: "internal" as const, threadId: m.channel, msgId: m.id,
      body: m.body, senderName: nameOf(m.author_id), dir: m.author_id === initial.meId ? "out" as const : "in" as const, ts: m.created_at,
    }))).catch(() => {});
  }, [msgs, businessId, initial.agents, initial.meId]);
  const [extra, setExtra] = useState<InternalMsg[]>([]); // optimistic bubbles, kept out of msgs so the real row can't dup
  const [text, setText] = useState("");
  const [reply, setReply] = useState<InternalMsg | null>(null);
  const [editing, setEditing] = useState<InternalMsg | null>(null);
  const [emojiRect, setEmojiRect] = useState<DOMRect | null>(null);
  const [reactTarget, setReactTarget] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [fwdTarget, setFwdTarget] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [stickerRect, setStickerRect] = useState<DOMRect | null>(null);
  const [stickerTray, setStickerTray] = useState<{ favorites: StickerItem[]; recent: StickerItem[] }>({ favorites: [], recent: [] });
  const [staged, setStaged] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [mention, setMention] = useState<{ q: string; at: number; rect: DOMRect } | null>(null);
  const [mentionSel, setMentionSel] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Espejo de lo que hace el chat de clientes (skill chat-parity): en un teléfono se ve la lista o
  // el hilo, nunca los dos. Se lleva con una vista propia y no vaciando `sel`, porque el canal
  // seleccionado también manda los marcadores de leído y el resync al recuperar el foco.
  //
  // Quién se esconde lo decide el CSS (`hide-mobile` solo hace algo bajo 768px), así que este
  // estado vale en escritorio también y no pasa nada: allá las dos columnas se ven igual.
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const [hasMore, setHasMore] = useState(false);
  const [typingName, setTypingName] = useState<string | null>(null);
  const atBottomRef = useRef(true);
  const scrollAction = useRef<"bottom" | "preserve" | "follow">("bottom");
  const prevHeight = useRef(0);
  const chanRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const typingTO = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSentTyping = useRef(0);
  const stickerBtn = useRef<HTMLButtonElement>(null);
  const mentionMatches = useMemo(() => (mention ? initial.agents.filter((a) => a.id !== initial.meId && a.name.toLowerCase().includes(mention.q.toLowerCase())).slice(0, 6) : []), [mention, initial.agents, initial.meId]);
  const [, start] = useTransition();
  const meId = initial.meId;
  const agentMap = useMemo(() => new Map(initial.agents.map((a) => [a.id, a])), [initial.agents]);
  const msgMap = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const imageMsgs = useMemo(() => msgs.filter((mm) => mm.type === "image" && mm.media_url && !mm.deleted), [msgs]);
  const openLightbox = useCallback((id: string) => { const idx = imageMsgs.findIndex((mm) => mm.id === id); setLightbox(idx >= 0 ? idx : 0); }, [imageMsgs]);
  const selRef = useRef(sel); selRef.current = sel;
  // Bubbles already on screen — used to animate only *newly arrived* messages, never the whole history on open.
  const seen = useRef<Set<string>>(new Set());
  const isFresh = (m: InternalMsg) => m.author_id !== meId && !seen.current.has(m.id);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useComposerFocus(taRef, sel); // cursor listo al abrir/cambiar de canal (igual en el de clientes)
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const teamLabel = lang === "es" ? "Equipo" : "Team";
  const title = (t: InternalThread) => (t.kind === "team" ? teamLabel : t.title);

  // Tell the Shell to refetch the nav "Equipo" badge after we mark a channel read.
  const pokeBadges = () => { try { window.dispatchEvent(new Event("ht:badges")); } catch {} };
  const refreshThreads = useCallback(() => { loadInternalThreads().then((r) => { if (r) setThreads(r.threads); }).catch(() => {}); }, []);
  // Merge the latest page into what's loaded (keeps older history + applies edits/reactions/deletes).
  const refreshMsgs = useCallback((ch: string) => {
    loadInternalMessages(ch).then((fresh) => { scrollAction.current = "follow"; setMsgs((prev) => mergeInternal(prev, fresh)); setHasMore((h) => h || fresh.length >= MSG_PAGE); }).catch(() => {});
  }, []);
  const openChannel = useCallback((ch: string) => {
    setSel(ch); setReply(null); setEditing(null); setText(""); setTypingName(null);
    setMobileView("thread"); // en móvil solo cabe una columna; ver `isMobile` abajo
    try { localStorage.setItem("ht.internalCh." + businessId, ch); } catch {} // remember across tab changes
    scrollAction.current = "bottom";
    loadInternalMessages(ch).then((fresh) => { seen.current = new Set(fresh.map((m) => m.id)); setMsgs(fresh); setHasMore(fresh.length >= MSG_PAGE); }).catch(() => {});
    start(async () => { await markInternalRead(ch); refreshThreads(); pokeBadges(); });
  }, [refreshThreads, businessId]);

  async function loadOlder() {
    if (loadingOlder || !hasMore) return;
    const oldest = msgs[0]?.created_at;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await loadInternalMessages(selRef.current, oldest);
      if (older.length < MSG_PAGE) setHasMore(false);
      if (older.length) { older.forEach((m) => seen.current.add(m.id)); prevHeight.current = endRef.current?.scrollHeight ?? 0; scrollAction.current = "preserve"; setMsgs((prev) => mergeInternal(older, prev)); }
    } finally { setLoadingOlder(false); }
  }
  function onThreadScroll() {
    const el = endRef.current; if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80) loadOlder();
  }

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("ht.internalCh." + businessId); } catch {}
    // ?ch= gana sobre el último canal visto: viene de un toast, que apunta a un hilo concreto.
    const wanted = initialChannel && (initialChannel === "team" || threads.some((t) => t.key === initialChannel)) ? initialChannel : null;
    const start0 = wanted ?? (saved && (saved === "team" || threads.some((t) => t.key === saved)) ? saved : selRef.current);
    openChannel(start0);
    /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // Se reconecta solo: antes, si el socket moría, el hilo dejaba de actualizarse en vivo sin
    // ninguna señal, y solo recargar lo revivía.
    // chanRef se reasigna en cada (re)conexión: el "escribiendo…" se emite por ese canal, y tras
    // reconectar el anterior ya no sirve.
    const stop = keepSubscribed(supabase, `internal-${businessId}`, (ch) => {
      chanRef.current = ch;
      return ch
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, (p) => {
        const row = (p.new ?? p.old) as { channel?: string };
        refreshThreads();
        if (row?.channel && row.channel === selRef.current) { refreshMsgs(selRef.current); markInternalRead(selRef.current).catch(() => {}); pokeBadges(); }
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const t = payload as { channel?: string; userId?: string; name?: string };
        if (t.channel !== selRef.current || t.userId === meId) return;
        setTypingName(t.name ?? null);
        clearTimeout(typingTO.current); typingTO.current = setTimeout(() => setTypingName(null), 3500);
      });
    }, {
      // Al reconectar, el hilo abierto pudo perderse mensajes mientras estuvo caído.
      onHealthy: (reconnected) => { if (reconnected) { refreshMsgs(selRef.current); refreshThreads(); } },
    });
    return () => { clearTimeout(typingTO.current); stop(); chanRef.current = null; };
  }, [businessId, refreshThreads, refreshMsgs, meId]);

  // Resync al recuperar el foco (espejo del chat de clientes): una pestaña dormida >30 s pudo
  // perder eventos aunque el canal siga "vivo" — una pasada de hilos + mensajes al volver.
  useEffect(() => {
    let hiddenAt = 0;
    let t: ReturnType<typeof setTimeout>;
    const onVis = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < 30_000) return;
      hiddenAt = 0;
      clearTimeout(t);
      t = setTimeout(() => { refreshThreads(); refreshMsgs(selRef.current); }, 400);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [refreshThreads, refreshMsgs]);

  // Drop the optimistic bubble once the real row lands (msgs grows) or on channel switch.
  useEffect(() => { setExtra([]); }, [sel, msgs.length]);
  // Cambiar de canal no debe arrastrar un envío a medias del anterior.
  useEffect(() => { setStaged([]); setCaption(""); setSending(false); setSendErr(null); }, [sel]);
  // After paint, mark everything on screen as seen so it won't re-animate on the next render.
  useEffect(() => { for (const m of msgs) seen.current.add(m.id); }, [msgs]);

  // Apply scroll after messages render: bottom on open, keep position when prepending, follow if near bottom.
  useLayoutEffect(() => {
    const el = endRef.current; if (!el) return;
    if (scrollAction.current === "bottom") { el.scrollTop = el.scrollHeight; setTimeout(() => { if (endRef.current && atBottomRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, 200); }
    else if (scrollAction.current === "preserve") el.scrollTop = el.scrollHeight - prevHeight.current;
    else if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    scrollAction.current = "follow";
  }, [msgs, extra]);

  // Broadcast a throttled "typing" ping on the realtime channel (ephemeral, no DB).
  const sendTyping = () => {
    const now = Date.now();
    if (now - lastSentTyping.current < 1500) return;
    lastSentTyping.current = now;
    chanRef.current?.send({ type: "broadcast", event: "typing", payload: { channel: selRef.current, userId: meId, name: agentMap.get(meId)?.name ?? "Alguien" } });
  };

  // @mention autocomplete in the composer.
  const onComposerChange = (v: string, caret: number) => {
    setText(v);
    if (v.trim()) sendTyping();
    const m = v.slice(0, caret).match(/(?:^|\s)@([\p{L}\d]*)$/u);
    if (m) { setMentionSel(0); setMention({ q: m[1], at: caret - m[1].length - 1, rect: taRef.current?.getBoundingClientRect() ?? new DOMRect() }); }
    else setMention(null);
  };
  const insertMention = (a: Agent) => {
    const el = taRef.current; if (!el || !mention) return;
    const caret = el.selectionStart; const ins = "@" + a.name + " ";
    const next = text.slice(0, mention.at) + ins + text.slice(caret);
    setText(next); setMention(null);
    requestAnimationFrame(() => { el.focus(); const p = mention.at + ins.length; el.setSelectionRange(p, p); });
  };

  function submit() {
    const body = text.trim();
    if (!body) return;
    if (editing) { const id = editing.id; setEditing(null); setText(""); start(async () => { await editInternalMessage(id, body); refreshMsgs(selRef.current); }); return; }
    const ch = sel; const rt = reply?.id ?? null;
    const mentioned = initial.agents.filter((a) => a.id !== meId && body.includes("@" + a.name)).map((a) => a.id);
    setText(""); setReply(null); setMention(null);
    const opt: InternalMsg = { id: "tmp" + extra.length, channel: ch, author_id: meId, body, mentions: mentioned, created_at: new Date().toISOString(), reply_to: rt, edited: false, deleted: false, reactions: [], type: "text", media_url: null, media_mime: null, media_name: null, forwarded: false };
    setExtra((e) => [...e, opt]);
    start(async () => { await sendInternalMessage(ch, body, rt, mentioned); refreshMsgs(selRef.current); refreshThreads(); });
  }
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
  const stageFiles = (files: FileList | File[]) => {
    if (!staged.length && !caption && text.trim()) { setCaption(text); carried.current = text; }
    setStaged((s) => [...s, ...Array.from(files)]);
  };
  const { dragOver, dragProps } = useFileDrop((files) => stageFiles(files));
  // Upload staged files, then send (caption goes on the first item, like the WhatsApp chat).
  // Cancelar SIEMPRE debe funcionar: si un envío fallaba, `sending` dejaba el modal sin salida
  // (la X y el scrim se deshabilitan mientras envía) y el canal quedaba bloqueado hasta recargar.
  const cancelStaged = () => { setStaged([]); setCaption(""); setSending(false); setSendErr(null); carried.current = null; };

  async function sendStaged() {
    if (!staged.length || sending) return;
    const ch = sel; setSending(true); setSendErr(null);
    const supabase = createClient();
    const failed: File[] = [];
    try {
      for (let i = 0; i < staged.length; i++) {
        const file = staged[i];
        try {
          const ext = (file.name.split(".").pop() || "bin").toLowerCase();
          const path = `${businessId}/internal/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
          if (error) throw new Error(error.message);
          const mtype = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
          // Igual que en el chat de clientes: la miniatura se calcula al subir, que es cuando el
          // archivo está a mano. Ver `@/lib/imageThumb`.
          const thumb = await makeImageThumb(file);
          await sendInternalMedia(ch, { type: mtype, mediaUrl: path, mime: file.type || "application/octet-stream", name: file.name, caption: i === 0 ? caption.trim() || undefined : undefined, thumb, size: file.size });
        } catch (e) {
          // El que falla se queda en la bandeja para reintentar, en vez de desaparecer.
          console.error(e);
          failed.push(file);
        }
      }
      if (failed.length) {
        setStaged(failed);
        setSendErr(lang === "es"
          ? `No se pudo enviar ${failed.length} de ${staged.length}. Puedes reintentar o cancelar.`
          : `Couldn't send ${failed.length} of ${staged.length}. Retry or cancel.`);
      } else {
        setStaged([]); setCaption("");
        if (carried.current !== null && text === carried.current) setText("");
        carried.current = null;
      }
      refreshMsgs(ch); refreshThreads();
    } finally { setSending(false); }
  }
  const startEdit = (m: InternalMsg) => { setEditing(m); setReply(null); setText(m.body); taRef.current?.focus(); };
  const del = async (m: InternalMsg) => { if (!(await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar mensaje" : "Delete message", message: lang === "es" ? "Se elimina para todo el equipo." : "It is deleted for the whole team.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" }))) return; start(async () => { await deleteInternalMessage(m.id); refreshMsgs(selRef.current); }); };
  const react = (id: string, emoji: string) => { setReactTarget(null); start(async () => { await reactInternalMessage(id, emoji); refreshMsgs(selRef.current); }); };
  const doForward = (toChannel: string) => { const id = fwdTarget?.id; setFwdTarget(null); if (id) start(async () => { await forwardInternalMessage(id, toChannel); refreshThreads(); }); };
  const openStickers = () => { setEmojiRect(null); if (stickerRect) { setStickerRect(null); return; } setStickerRect(stickerBtn.current?.getBoundingClientRect() ?? null); loadStickerTray(businessId).then(setStickerTray).catch(() => {}); };
  const pickSticker = (s: StickerItem) => { const ch = sel; setStickerRect(null); const opt: InternalMsg = { id: "tmp" + extra.length, channel: ch, author_id: meId, body: "", mentions: [], created_at: new Date().toISOString(), reply_to: null, edited: false, deleted: false, reactions: [], type: "sticker", media_url: s.url, media_mime: "image/webp", media_name: null, forwarded: false }; setExtra((e) => [...e, opt]); start(async () => { await sendInternalSticker(ch, s.path); refreshMsgs(selRef.current); refreshThreads(); }); };
  // La estrella aquí es un interruptor, sin el editor de nombre/tags del chat de WhatsApp: este
  // popover es chico y lo que hacía falta era poder guardarlos, no volver a curarlos.
  const toggleFav = (s: StickerItem) => {
    const fav = !s.fav;
    const mark = (x: StickerItem) => (x.path === s.path ? { ...x, fav } : x);
    setStickerTray((t) => ({
      recent: t.recent.map(mark),
      favorites: fav ? [{ ...s, fav: true }, ...t.favorites] : t.favorites.filter((f) => f.path !== s.path),
    }));
    start(async () => {
      if (fav) await saveStickerFavorite(s.path, "", []);
      else await removeStickerFavorite(s.path);
      loadStickerTray(businessId).then(setStickerTray).catch(() => {});
    });
  };

  const selThread = threads.find((t) => t.key === sel);

  // Group consecutive plain images (same author) into a 2×2 album, like the clients chat.
  type Row = { kind: "album"; items: InternalMsg[] } | { kind: "msg"; m: InternalMsg };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []; let album: InternalMsg[] = [];
    const flush = () => { if (album.length >= 2) out.push({ kind: "album", items: album }); else album.forEach((m) => out.push({ kind: "msg", m })); album = []; };
    for (const m of msgs) {
      const isImg = m.type === "image" && !!m.media_url && !m.reply_to && !m.deleted && !m.body;
      if (isImg && (album.length === 0 || album[album.length - 1].author_id === m.author_id)) album.push(m);
      else { flush(); if (isImg) album.push(m); else out.push({ kind: "msg", m }); }
    }
    flush(); return out;
  }, [msgs]);

  function renderBubble(m: InternalMsg, fresh = false) {
    const mine = m.author_id === meId;
    const au = m.author_id ? agentMap.get(m.author_id) : null;
    const quoted = m.reply_to ? msgMap.get(m.reply_to) : null;
    const url = m.body ? firstUrl(m.body) : null;
    return (
      <div className={"msg " + (mine ? "out" : "in") + (fresh ? " fresh" : "")}>
        <div className="bubble" id={`im-${m.id}`}>
          {!mine && selThread?.kind === "team" && !m.deleted && <div style={{ fontSize: 11.5, fontWeight: 700, color: au?.color ?? "var(--brand-700)", marginBottom: 2 }}>{au?.name ?? "Agente"}</div>}
          {m.forwarded && !m.deleted && <div className="row gap-1 t-xs muted" style={{ marginBottom: 2, fontStyle: "italic" }}><Icon name="forward" size={12} />{lang === "es" ? "Reenviado" : "Forwarded"}</div>}
          {quoted && !m.deleted && (
            <div onClick={(e) => { e.stopPropagation(); jumpInternal(quoted.id); }} title={lang === "es" ? "Ir al mensaje" : "Go to message"} style={{ borderLeft: "3px solid var(--brand)", padding: "2px 8px", margin: "0 0 4px", background: "rgba(0,0,0,.05)", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
              <div style={{ fontWeight: 700, color: "var(--brand-700)" }}>{quoted.author_id === meId ? (lang === "es" ? "Tú" : "You") : (agentMap.get(quoted.author_id ?? "")?.name ?? "Agente")}</div>
              <div className="truncate" style={{ opacity: 0.8 }}>{quoted.deleted ? "—" : (quoted.body || (lang === "es" ? "Adjunto" : "Attachment"))}</div>
            </div>
          )}
          {m.deleted ? (
            <div className="row gap-1" style={{ fontStyle: "italic", opacity: 0.6 }}><Icon name="x" size={12} />{lang === "es" ? "Mensaje eliminado" : "Message deleted"}</div>
          ) : (
            <>
              {m.media_url && <MediaBlock m={m as unknown as ChatMessage} onImage={openLightbox} />}
              {m.body && <div style={{ marginTop: m.media_url ? 4 : 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{renderBody(m.body, (m.mentions ?? []).map((id) => agentMap.get(id)?.name).filter((n): n is string => !!n))}</div>}
              {url && <LinkPreview url={url} />}
            </>
          )}
          <div className="bubble-meta">{m.edited && !m.deleted && <span style={{ marginRight: 4, fontSize: 10.5, opacity: 0.7 }}>{lang === "es" ? "editado" : "edited"}</span>}<span>{clock(m.created_at, lang)}</span></div>
          {!m.deleted && m.reactions.length > 0 && (
            <div className="msg-reacts">
              {m.reactions.map((r, i) => <button key={i} className={"msg-react" + (r.by === meId ? " mine" : "")} onClick={() => react(m.id, r.emoji)}>{r.emoji}</button>)}
            </div>
          )}
          {!m.deleted && !m.id.startsWith("tmp") && (
            <InternalMsgMenu out={mine} canEdit={mine && m.type === "text"} canDelete={mine} lang={lang}
              media={m.media_url && !m.deleted ? { url: m.media_url, mime: m.media_mime, name: m.media_name } : null}
              onCopied={(r) => push({ kind: r ? "success" : "warn", message: r === "file" ? (lang === "es" ? "Archivo copiado" : "File copied") : r === "link" ? (lang === "es" ? "Enlace copiado" : "Link copied") : (lang === "es" ? "No se pudo copiar" : "Couldn't copy") })}
              onReply={() => { setReply(m); setEditing(null); taRef.current?.focus(); }}
              onForward={(rect) => setFwdTarget({ id: m.id, rect })}
              onEdit={() => startEdit(m)} onDelete={() => del(m)} onReact={(rect) => setReactTarget({ id: m.id, rect })} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* threads list */}
      <div className={"chatcol int-list" + (mobileView === "thread" ? " hide-mobile" : "")}>
        <div className="col-head"><h1 style={{ fontSize: 18, margin: "2px 2px 6px" }}>{lang === "es" ? "Chat interno" : "Internal chat"}</h1></div>
        <div className="col-scroll scroll">
          {threads.map((t) => (
            <button key={t.key} onClick={() => openChannel(t.key)} className={"conv" + (t.key === sel ? " sel" : "") + (t.unread ? " unread" : "")} style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", font: "inherit" }}>
              {t.kind === "team"
                ? <span style={{ width: 42, height: 42, borderRadius: 12, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="agents" /></span>
                : <Avatar name={t.title} initials={deriveInitials(t.title)} color={t.color} size={42} />}
              <div className="conv-body">
                <div className="conv-top">
                  <span className="conv-name truncate">{title(t)}</span>
                  {t.lastAt && <span className="conv-time">{clock(t.lastAt, lang)}</span>}
                </div>
                <div className="conv-prev truncate">{t.lastBody ? (t.lastAuthorId === meId ? (lang === "es" ? "Tú: " : "You: ") : "") + t.lastBody : <span className="muted">{lang === "es" ? "Sin mensajes" : "No messages"}</span>}</div>
              </div>
              {t.unread > 0 && <span className="badge badge-red">{t.unread}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className={"chatcol" + (mobileView === "list" ? " hide-mobile" : "")}
        style={{ position: "relative", flex: 1, minWidth: 0, background: "var(--bg)" }} {...dragProps}>
        {dragOver && <DropOverlay lang={lang} />}
        <div className="thread-head">
          <button className="iconbtn only-mobile" onClick={() => setMobileView("list")} aria-label={lang === "es" ? "Volver a los chats" : "Back to chats"} style={{ marginLeft: -6, flex: "none" }}>
            <Icon name="arrowl" size={20} />
          </button>
          {selThread?.kind === "team"
            ? <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="agents" size={18} /></span>
            : <Avatar name={selThread?.title} initials={deriveInitials(selThread?.title ?? "?")} color={selThread?.color} size={36} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{selThread ? title(selThread) : teamLabel}</div>
            <div className="t-xs muted">{selThread?.kind === "team" ? (lang === "es" ? "Todo el equipo" : "Whole team") : (lang === "es" ? "Mensaje directo · interno" : "Direct message · internal")}</div>
          </div>
        </div>

        <div className="thread scroll" ref={endRef} onScroll={onThreadScroll}>
          {loadingOlder && <div className="t-xs muted" style={{ textAlign: "center", padding: "8px 0" }}>{lang === "es" ? "Cargando mensajes…" : "Loading messages…"}</div>}
          {rows.length === 0 ? (
            <div className="empty" style={{ padding: "56px 24px" }}><div className="empty-art"><Icon name="chat" /></div><p className="muted t-sm">{lang === "es" ? "Inicia la conversación interna." : "Start the internal conversation."}</p></div>
          ) : rows.map((row, i) => {
            const created = row.kind === "album" ? row.items[0].created_at : row.m.created_at;
            const prev = i > 0 ? rows[i - 1] : null;
            const prevAt = prev ? (prev.kind === "album" ? prev.items[0].created_at : prev.m.created_at) : null;
            const daySep = (!prevAt || new Date(prevAt).toDateString() !== new Date(created).toDateString())
              ? <div className="day-sep"><span>{dayLabel(created, lang)}</span></div> : null;
            if (row.kind === "album") {
              const mine = row.items[0].author_id === meId;
              return (
                <Fragment key={"al" + row.items[0].id}>
                  {daySep}
                  <div className={"msg " + (mine ? "out" : "in") + (isFresh(row.items[0]) ? " fresh" : "")}>
                    <div className="bubble" style={{ padding: 3 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, width: 242 }}>
                        {row.items.slice(0, 4).map((m, idx) => (
                          <a key={m.id} id={`im-${m.id}`} href={m.media_url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openLightbox(m.id); }} style={{ position: "relative", display: "block", aspectRatio: "1 / 1", borderRadius: 6, background: "var(--surface-2)", overflow: "hidden", cursor: "zoom-in" }}>
                            <CachedImg path={m.media_path} url={m.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            {idx === 3 && row.items.length > 4 && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 }}>+{row.items.length - 4}</span>}
                          </a>
                        ))}
                      </div>
                      <div className="bubble-meta"><span>{clock(row.items[row.items.length - 1].created_at, lang)}</span></div>
                    </div>
                  </div>
                </Fragment>
              );
            }
            return <Fragment key={row.m.id}>{daySep}{renderBubble(row.m, isFresh(row.m))}</Fragment>;
          })}
          {extra.map((m) => <Fragment key={m.id}>{renderBubble(m, true)}</Fragment>)}
          {typingName && <div className="msg in"><div className="bubble typing-bubble"><span className="td" /><span className="td" /><span className="td" /></div></div>}
        </div>

        <div className="composer">
          {(reply || editing) && (
            <div className="row gap-2" style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 6 }}>
              <Icon name={editing ? "edit" : "swap"} size={14} />
              <span className="t-xs muted grow truncate">{(editing ? (lang === "es" ? "Editando: " : "Editing: ") : (lang === "es" ? "Respondiendo: " : "Replying: ")) + ((editing || reply)?.body ?? (lang === "es" ? "Adjunto" : "Attachment"))}</span>
              <button className="iconbtn sm" onClick={() => { setEditing(null); setReply(null); if (editing) setText(""); }}><Icon name="x" size={14} /></button>
            </div>
          )}
          <div className="composer-box">
            <div className="composer-input">
              <textarea ref={taRef} className="bare" rows={1} style={{ resize: "none" }} placeholder={lang === "es" ? "Mensaje interno… usa @ para mencionar" : "Internal message… use @ to mention"} value={text}
                onChange={(e) => onComposerChange(e.target.value, e.target.selectionStart)}
                onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); stageFiles(files); } }}
                onBlur={() => setTimeout(() => setMention(null), 150)}
                onKeyDown={(e) => {
                  if (mention && mentionMatches.length) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMentionSel((s) => (s + 1) % mentionMatches.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMentionSel((s) => (s - 1 + mentionMatches.length) % mentionMatches.length); return; }
                    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionMatches[mentionSel]); return; }
                    if (e.key === "Escape") { setMention(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }} />
              {mention && mentionMatches.length > 0 && (
                <div className="menu scroll" style={menuStyle(mention.rect, { width: 240, height: 240, align: "left" })}>
                  <div className="menu-label">{lang === "es" ? "Mencionar" : "Mention"}</div>
                  {mentionMatches.map((a, i) => (
                    <button type="button" key={a.id} className={"menu-item" + (i === mentionSel ? " on" : "")} style={i === mentionSel ? { background: "var(--surface-2)" } : undefined}
                      onMouseEnter={() => setMentionSel(i)} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}>
                      <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} src={a.avatar_url ?? undefined} size={22} />{a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="composer-actions">
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) stageFiles(e.target.files); e.target.value = ""; }} />
              <button className="iconbtn" onClick={() => fileRef.current?.click()} title={lang === "es" ? "Adjuntar" : "Attach"}><Icon name="paperclip" /></button>
              <span style={{ display: "inline-flex" }}>
                <button ref={emojiBtn} className="iconbtn" title="Emoji" style={{ fontSize: 16 }} onClick={() => { setEmojiRect(emojiRect ? null : emojiBtn.current?.getBoundingClientRect() ?? null); }}>😀</button>
                {emojiRect && (<><div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setEmojiRect(null)} /><EmojiPicker rect={emojiRect} onPick={(e) => setText((v) => v + e)} /></>)}
              </span>
              <span style={{ display: "inline-flex" }}>
                <button ref={stickerBtn} className="iconbtn" title="Stickers" style={{ fontSize: 16 }} onClick={openStickers}>🩷</button>
                {stickerRect && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setStickerRect(null)} />
                    <div className="menu" style={{ ...menuStyle(stickerRect, { width: 300, height: 340, align: "left" }), padding: 8 }}>
                      {stickerTray.favorites.length === 0 && stickerTray.recent.length === 0
                        ? <div className="muted t-sm" style={{ padding: 10 }}>{lang === "es" ? "Aún no hay stickers." : "No stickers yet."}</div>
                        : (
                          <>
                            {stickerTray.favorites.length > 0 && <><div className="menu-label">{lang === "es" ? "★ Favoritos" : "★ Favorites"}</div><div className="sticker-grid">{stickerTray.favorites.map((s) => <StickerCell key={"f" + s.path} s={s} onSend={() => pickSticker(s)} onFav={() => toggleFav(s)} lang={lang} />)}</div></>}
                            <div className="menu-label">{lang === "es" ? "Recientes" : "Recent"}</div>
                            <div className="sticker-grid">{stickerTray.recent.map((s) => <StickerCell key={"r" + s.path} s={s} onSend={() => pickSticker(s)} onFav={() => toggleFav(s)} lang={lang} />)}</div>
                          </>
                        )}
                    </div>
                  </>
                )}
              </span>
              <span className="grow" />
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={!text.trim()}><Icon name="send" size={15} /> {editing ? (lang === "es" ? "Guardar" : "Save") : (lang === "es" ? "Enviar" : "Send")}</button>
            </div>
          </div>
        </div>
      </div>

      {reactTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setReactTarget(null)} />
          <EmojiPicker rect={reactTarget.rect} onPick={(e) => react(reactTarget.id, e)} />
        </>
      )}
      {lightbox != null && imageMsgs.length > 0 && (
        <Lightbox items={imageMsgs as unknown as ChatMessage[]} index={lightbox} onClose={() => setLightbox(null)}
          onForward={(mm) => { setLightbox(null); setFwdTarget({ id: mm.id, rect: new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0) }); }}
          onDelete={(mm) => { setLightbox(null); start(async () => { await deleteInternalMessage(mm.id); refreshMsgs(selRef.current); }); }} />
      )}
      {fwdTarget && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setFwdTarget(null)} />
          <div className="menu scroll" style={menuStyle(fwdTarget.rect, { width: 220, height: 300 })}>
            <div className="menu-label">{lang === "es" ? "Reenviar a" : "Forward to"}</div>
            {threads.map((t) => <button key={t.key} className="menu-item" onClick={() => doForward(t.key)}>{t.kind === "team" ? <Icon name="agents" size={15} /> : <Avatar name={t.title} initials={deriveInitials(t.title)} color={t.color} size={20} />}<span className="truncate">{title(t)}</span></button>)}
          </div>
        </>
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
            <div className="modal-foot">
              <div className="col gap-2 grow" style={{ minWidth: 0 }}>
                {sendErr && <div className="t-xs" style={{ color: "var(--red)" }}>{sendErr}</div>}
                <div className="field field-filled"><Icon name="edit" size={15} /><input placeholder={lang === "es" ? "Agrega un comentario…" : "Add a caption…"} value={caption} onChange={(e) => setCaption(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendStaged(); }} autoFocus /></div>
              </div>
              <button className="btn btn-primary" disabled={sending} onClick={sendStaged}><Icon name="send" size={15} />{sending ? (lang === "es" ? "Enviando…" : "Sending…") : sendErr ? (lang === "es" ? "Reintentar" : "Retry") : (lang === "es" ? "Enviar" : "Send")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Per-message hover menu for internal chat — same actions/icons/order as the WhatsApp chat. */
function InternalMsgMenu({ out, canEdit, canDelete, lang, media, onReply, onForward, onEdit, onDelete, onReact, onCopied }: { out: boolean; canEdit: boolean; canDelete: boolean; lang: "es" | "en"; media?: { url: string; mime: string | null; name: string | null } | null; onReply: () => void; onForward: (rect: DOMRect) => void; onEdit: () => void; onDelete: () => void; onReact: (rect: DOMRect) => void; onCopied?: (r: "file" | "link" | null) => void }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => { setRect(btn.current?.getBoundingClientRect() ?? null); setOpen((o) => !o); };
  return (
    <span className={"msg-menu" + (open ? " open" : "")} style={{ position: "absolute", top: 3, [out ? "right" : "left"]: 4 }}>
      <button ref={btn} className="msg-menu-btn" onClick={toggle} aria-label="Menu"><Icon name="dots" size={14} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setOpen(false)} />
          <div className="menu" style={menuStyle(rect, { width: 170, height: 210, align: out ? "right" : "left" })}>
            <button className="menu-item" onClick={() => { const r = rect; setOpen(false); onReact(r); }}><span style={{ fontSize: 15, width: 15, display: "inline-flex", justifyContent: "center" }}>😊</span>{lang === "es" ? "Reaccionar" : "React"}</button>
            <button className="menu-item" onClick={() => { setOpen(false); onReply(); }}><Icon name="swap" size={15} />{lang === "es" ? "Responder" : "Reply"}</button>
            <button className="menu-item" onClick={() => { const r = rect; setOpen(false); onForward(r); }}><Icon name="forward" size={15} />{lang === "es" ? "Reenviar" : "Forward"}</button>
            {/* Paridad con el chat de clientes: archivo y enlace como acciones separadas. */}
            {media && canCopyFile(media.mime) && (
              <button className="menu-item" onClick={async () => { setOpen(false); onCopied?.(await copyFile(media.url, media.mime) ? "file" : null); }}>
                <Icon name="file" size={15} />{lang === "es" ? "Copiar archivo" : "Copy file"}
              </button>
            )}
            {media && (
              <button className="menu-item" onClick={() => { setOpen(false); downloadMedia(media.url, media.name, media.mime); }}>
                <Icon name="download" size={15} />{lang === "es" ? "Descargar" : "Download"}
              </button>
            )}
            {media && (
              <button className="menu-item" onClick={async () => { setOpen(false); onCopied?.(await copyLink(media.url) ? "link" : null); }}>
                <Icon name="paperclip" size={15} />{lang === "es" ? "Copiar enlace" : "Copy link"}
              </button>
            )}
            {canEdit && <button className="menu-item" onClick={() => { setOpen(false); onEdit(); }}><Icon name="edit" size={15} />{lang === "es" ? "Editar" : "Edit"}</button>}
            {canDelete && <button className="menu-item danger" onClick={() => { setOpen(false); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar" : "Delete"}</button>}
          </div>
        </>
      )}
    </span>
  );
}
