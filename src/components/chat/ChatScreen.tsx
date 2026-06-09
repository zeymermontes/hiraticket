"use client";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Agent, ConvListItem, ConvDetail, ChatMessage } from "@/lib/chat";
import type { Area, Stage } from "@/lib/business";
import { CustomerOverlay } from "@/components/chat/CustomerOverlay";
import { TransferModal } from "@/components/TransferModal";
import {
  sendMessage, sendMediaMessage, editMessage, deleteMessage, setConvStatus, acceptConv, addConvNote, transferConv, setConvHidden, snoozeConv,
  deleteConv, renameContact, requestContactInfo, markConvRead, addContactTag,
} from "@/app/(app)/chat/actions";

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

function MediaBlock({ m }: { m: ChatMessage }) {
  const url = m.media_url ?? undefined;
  if (!url) return null;
  if (m.type === "image" || m.type === "sticker") {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" style={{ maxWidth: m.type === "sticker" ? 130 : 240, maxHeight: 280, borderRadius: 10, display: "block" }} /></a>;
  }
  if (m.type === "video") return <video src={url} controls style={{ maxWidth: 260, borderRadius: 10, display: "block" }} />;
  if (m.type === "audio") return <audio src={url} controls style={{ maxWidth: 240 }} />;
  // document / other
  return (
    <a href={url} target="_blank" rel="noreferrer" className="row gap-2" style={{ padding: "6px 4px", textDecoration: "none", color: "inherit" }}>
      <span className="doc-ic" style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(0,0,0,.06)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="file" size={17} /></span>
      <span style={{ minWidth: 0 }}><span style={{ fontWeight: 600, fontSize: 12.5, display: "block" }} className="truncate">{m.media_name || "Archivo"}</span><span className="t-xs muted">{(m.media_mime || "").split("/").pop()}</span></span>
    </a>
  );
}

function Tick({ state }: { state: string | null }) {
  if (state === "read") return <span style={{ color: "var(--wa)", display: "inline-flex" }}><Icon name="checks" size={15} /></span>;
  if (state === "delivered") return <span style={{ display: "inline-flex", opacity: 0.65 }}><Icon name="checks" size={15} /></span>;
  if (state === "sent") return <span style={{ display: "inline-flex", opacity: 0.65 }}><Icon name="check" size={13} /></span>;
  return <span style={{ display: "inline-flex", opacity: 0.5 }}><Icon name="clock" size={11} /></span>;
}

function QuotedBlock({ m }: { m: ChatMessage }) {
  const label = m.deleted ? "…" : (m.body || (m.type !== "text" ? "📎 " + m.type : ""));
  return <div className="truncate" style={{ borderLeft: "3px solid var(--brand)", padding: "3px 8px", marginBottom: 4, background: "rgba(0,0,0,.05)", borderRadius: 6, fontSize: 12, maxWidth: 240 }}>{label}</div>;
}

function MsgMenu({ m, out, onReply, onEdit, onDelete }: { m: ChatMessage; out: boolean; onReply: () => void; onEdit: () => void; onDelete: () => void }) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <span className={"msg-menu" + (open ? " open" : "")} style={{ position: "absolute", top: 3, [out ? "right" : "left"]: 4 }}>
      <button className="msg-menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu"><Icon name="dots" size={14} /></button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ position: "absolute", top: "100%", [out ? "right" : "left"]: 0, width: 160, zIndex: 50 }}>
            <button className="menu-item" onClick={() => { setOpen(false); onReply(); }}><Icon name="swap" size={15} />{lang === "es" ? "Responder" : "Reply"}</button>
            {out && m.type === "text" && <button className="menu-item" onClick={() => { setOpen(false); onEdit(); }}><Icon name="edit" size={15} />{lang === "es" ? "Editar" : "Edit"}</button>}
            {out && <button className="menu-item danger" onClick={() => { setOpen(false); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar" : "Delete"}</button>}
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
  list, detail, selectedId, agents, areas, stages, meId, businessId, connected,
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
  const [tab, setTab] = useState<"mine" | "unassigned" | "all">("mine");

  // Live updates: refresh server data when messages/conversations change.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout>;
    const bump = () => { clearTimeout(t); t = setTimeout(() => router.refresh(), 250); };
    const ch = supabase
      .channel(`chat-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `business_id=eq.${businessId}` }, bump)
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [businessId, router]);

  // Mark a conversation read (reset unread) when it's opened.
  useEffect(() => {
    if (detail && detail.unread > 0) markConvRead(detail.id).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // Center column: show/hide + drag-resize (persisted).
  const [ctxVisible, setCtxVisible] = useState(true);
  const [ctxW, setCtxW] = useState(360);
  useEffect(() => {
    try {
      const v = localStorage.getItem("ht_ctxVisible");
      const w = localStorage.getItem("ht_ctxW");
      if (v != null) setCtxVisible(v === "true");
      if (w != null) setCtxW(Math.max(280, Math.min(680, Number(w) || 360)));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("ht_ctxVisible", String(ctxVisible)); } catch {} }, [ctxVisible]);
  useEffect(() => { try { localStorage.setItem("ht_ctxW", String(ctxW)); } catch {} }, [ctxW]);

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

  return (
    <div
      className="chat"
      style={{
        position: "relative",
        gridTemplateColumns: detail && ctxVisible
          ? `300px ${ctxW}px minmax(300px,1fr)`
          : "300px minmax(300px,1fr)",
      }}
    >
      {/* list column */}
      <div className="chatcol list">
        <div className="col-head">
          <div className="seg" style={{ width: "100%" }}>
            {([["mine", lang === "es" ? "Míos" : "Mine", mineN], ["unassigned", lang === "es" ? "Sin asignar" : "Unassigned", unN], ["all", lang === "es" ? "Todos" : "All", null]] as const).map(([id, lbl, n]) => (
              <button key={id} className={tab === id ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => setTab(id)}>
                {lbl}{n != null && n > 0 && <span className="badge badge-soft">{n}</span>}
              </button>
            ))}
          </div>
          <div className="field field-sm field-filled">
            <Icon name="search" />
            <input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {(["open", "pending", "resolved"] as const).map((s) => (
              <button key={s} className={"btn btn-sm " + (statusF === s ? "btn-primary" : "btn-outline")} onClick={() => setStatusF(statusF === s ? null : s)}>
                <Icon name="dot" size={12} /> {STATUS_LABEL[s][lang]}
              </button>
            ))}
            <button className={"btn btn-sm " + (unreadOnly ? "btn-primary" : "btn-outline")} onClick={() => setUnreadOnly((v) => !v)}>
              <Icon name="dot" size={12} /> {lang === "es" ? "No leídos" : "Unread"}
            </button>
            {areaNames.length > 0 && (
              <select className="select select-sm" value={areaF ?? ""} onChange={(e) => setAreaF(e.target.value || null)}>
                <option value="">{lang === "es" ? "Toda área" : "All areas"}</option>
                {areaNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <button className={"btn btn-sm " + (showArchived ? "btn-primary" : "btn-outline")} onClick={() => setShowArchived((v) => !v)}>
              <Icon name="clock" size={12} /> {lang === "es" ? "Pospuestos/Ocultos" : "Snoozed/Hidden"}{archivedN > 0 && <span className="badge badge-soft">{archivedN}</span>}
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
                <Link key={c.id} href={`/chat?c=${c.id}`} className={"conv" + (c.id === selectedId ? " sel" : "") + (c.unread ? " unread" : "")}>
                  <Avatar name={c.contact?.name} initials={deriveInitials(c.contact?.name || c.contact?.phone || "?")} color={avatarColor(c.contact?.phone)} size={42} />
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name truncate">{c.contact?.name ?? "—"}</span>
                      <span className="conv-time">{relTime(c.last_message_at, lang)}</span>
                    </div>
                    <div className="conv-prev truncate">{c.preview}</div>
                    <div className="conv-meta">
                      {c.snoozed_until && new Date(c.snoozed_until).getTime() > Date.now()
                        ? <Pill color="violet"><Icon name="clock" size={11} />{new Date(c.snoozed_until).toLocaleString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Pill>
                        : <Pill color={STATUS_COLOR[c.status]} dot>{STATUS_LABEL[c.status][lang]}</Pill>}
                      {c.hidden && <Pill color="slate"><Icon name="eye" size={11} /></Pill>}
                      {c.area && <Pill color={c.area.color as PillColor}>{c.area.name}</Pill>}
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
          {ctxVisible && <Workspace detail={detail} agents={agents} areas={areas} onResizeStart={startResize} onOpen360={() => setShow360(true)} />}
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
    </div>
  );
}

/* ---------- Thread (right column) ---------- */
export function Thread({ detail, agents, areas, connected, ctxVisible, onToggleCtx, businessId, floating }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; connected: boolean; ctxVisible?: boolean; onToggleCtx?: () => void; businessId: string; floating?: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [extra, setExtra] = useState<ChatMessage[]>([]);
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
        const { data } = supabase.storage.from("media").getPublicUrl(path);
        const mtype = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
        await sendMediaMessage(detail.id, { type: mtype, mediaUrl: data.publicUrl, mime: file.type || "application/octet-stream", name: file.name, caption: i === 0 ? caption.trim() || undefined : undefined });
      }
      setStaged([]); setCaption("");
      router.refresh();
    } finally {
      setSending(false);
    }
  }
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [canned, setCanned] = useState<{ id: string; title: string; body: string }[]>([]);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const cannedBtn = useRef<HTMLButtonElement>(null);
  const [emojiRect, setEmojiRect] = useState<DOMRect | null>(null);
  const [cannedRect, setCannedRect] = useState<DOMRect | null>(null);

  async function loadCanned() {
    if (canned.length) return;
    const supabase = createClient();
    const { data } = await supabase.from("canned_messages").select("id, title, body").eq("business_id", businessId).order("title");
    setCanned((data ?? []) as { id: string; title: string; body: string }[]);
  }
  function fillVars(body: string) {
    const o = detail.orders[0];
    return body
      .replace(/\{\{\s*name\s*\}\}/gi, detail.contact?.name ?? "")
      .replace(/\{\{\s*phone\s*\}\}/gi, detail.contact?.phone ?? "")
      .replace(/\{\{\s*order_number\s*\}\}/gi, o?.code ?? "")
      .replace(/\{\{\s*total\s*\}\}/gi, o ? `$${o.total.toLocaleString("es-MX")}` : "");
  }
  const EMOJIS = ["😀", "😅", "🙏", "👍", "🙌", "🎉", "❤️", "🔥", "✅", "👀", "😍", "😂", "🤝", "💪", "📦", "💳", "📍", "⏰", "✨", "🙆"];

  useEffect(() => { setExtra([]); setReplyTo(null); setEditing(null); }, [detail.id, detail.messages.length]);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; });

  const assignee = detail.assignee_id ? agentMap.get(detail.assignee_id) : null;
  const messages = [...detail.messages, ...extra];
  const msgMap = useMemo(() => new Map(detail.messages.map((mm) => [mm.id, mm])), [detail.messages]);

  function startEdit(mm: ChatMessage) { setEditing(mm); setReplyTo(null); setText(mm.body ?? ""); }
  function startReply(mm: ChatMessage) { setReplyTo(mm); setEditing(null); }

  function doSend() {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      const id = editing.id; setEditing(null); setText("");
      start(async () => { await editMessage(id, body); router.refresh(); });
      return;
    }
    const rt = replyTo?.id;
    setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "text", body, state: "sent", author_id: null, created_at: new Date().toISOString(), media_url: null, media_mime: null, media_name: null, reply_to: rt ?? null, deleted: false, forwarded: false, edited: false, meta: null }]);
    setText(""); setReplyTo(null);
    start(async () => { await sendMessage(detail.id, body, rt); router.refresh(); });
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
    <div className="chatcol" style={floating ? { height: "100%" } : undefined}>
      <div className="thread-head">
        <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name || detail.contact?.phone || "?")} color={avatarColor(detail.contact?.phone)} size={38} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name}</span>
            <span className="pill pill-green" style={{ height: 18, padding: "0 6px" }}><Icon name="whatsapp" size={11} />WhatsApp</span>
          </div>
          <div className="t-xs muted">{assignee ? (lang === "es" ? "Atiende " : "Handled by ") + assignee.name : lang === "es" ? "Sin asignar" : "Unassigned"}</div>
        </div>
        {onToggleCtx && (
          <button className={"iconbtn" + (ctxVisible ? " active" : "")} title={ctxVisible ? (lang === "es" ? "Ocultar panel" : "Hide panel") : (lang === "es" ? "Mostrar panel" : "Show panel")} onClick={onToggleCtx}>
            <Icon name="columns" />
          </button>
        )}
        {!detail.assignee_id && (
          <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => start(async () => { await acceptConv(detail.id); router.refresh(); })}>
            <Icon name="check" size={14} />{lang === "es" ? "Aceptar" : "Accept"}
          </button>
        )}
        <TransferControl detail={detail} agents={agents} areas={areas} />
        {detail.status !== "resolved" ? (
          <button className="iconbtn" title={lang === "es" ? "Resolver" : "Resolve"} style={{ color: "var(--green)" }} disabled={pending}
            onClick={() => start(async () => { await setConvStatus(detail.id, "resolved"); router.refresh(); })}>
            <Icon name="check" />
          </button>
        ) : <Pill color="green" dot>{STATUS_LABEL.resolved[lang]}</Pill>}
      </div>

      <div className="thread thread-wa-tint scroll" ref={endRef}>
        {messages.map((m, i) => {
          const out = m.direction === "out";
          const author = out && m.author_id ? agentMap.get(m.author_id) : null;
          const prev = i > 0 ? messages[i - 1] : null;
          const showDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          return (
            <React.Fragment key={m.id}>
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at, lang)}</span></div>}
            <div className={"msg " + (out ? "out" : "in")}>
              <div className="bubble">
                {author && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-700)", marginBottom: 2 }}>{author.name}</div>}
                {m.forwarded && !m.deleted && <div className="row gap-1 t-xs muted" style={{ marginBottom: 2, fontStyle: "italic" }}><Icon name="forward" size={12} />{lang === "es" ? "Reenviado" : "Forwarded"}</div>}
                {m.reply_to && msgMap.get(m.reply_to) && <QuotedBlock m={msgMap.get(m.reply_to)!} />}
                {m.deleted ? (
                  <div className="row gap-1" style={{ fontStyle: "italic", opacity: 0.6 }}><Icon name="x" size={12} />{lang === "es" ? "Mensaje eliminado" : "Message deleted"}</div>
                ) : m.type === "location" ? <LocationBlock m={m} />
                  : m.type === "contact" ? <ContactBlock m={m} />
                    : (
                      <>
                        {m.media_url && <MediaBlock m={m} />}
                        {m.body && <div style={{ marginTop: m.media_url ? 4 : 0 }}>{m.body}</div>}
                      </>
                    )}
                <div className="bubble-meta">{m.edited && !m.deleted && <span style={{ marginRight: 4, fontSize: 10.5, opacity: 0.7 }}>{lang === "es" ? "editado" : "edited"}</span>}{relTime(m.created_at, lang)}{out && <Tick state={m.state} />}</div>
                {!m.deleted && !m.id.startsWith("tmp") && (
                  <MsgMenu m={m} out={out} onReply={() => startReply(m)} onEdit={() => startEdit(m)}
                    onDelete={() => { if (confirm(lang === "es" ? "¿Eliminar mensaje para todos?" : "Delete for everyone?")) start(async () => { await deleteMessage(m.id); router.refresh(); }); }} />
                )}
              </div>
            </div>
            </React.Fragment>
          );
        })}
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
            <textarea className="bare" rows={1} placeholder={lang === "es" ? "Escribe un mensaje…" : "Type a message…"} value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); stageFiles(files); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }} />
          </div>
          <div className="composer-actions">
            <input ref={fileRef} type="file" multiple style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.length) stageFiles(e.target.files); e.target.value = ""; }} />
            <button className="iconbtn" onClick={() => fileRef.current?.click()} title={lang === "es" ? "Adjuntar" : "Attach"}><Icon name="paperclip" /></button>
            <span style={{ display: "inline-flex" }}>
              <button ref={emojiBtn} className="iconbtn" onClick={() => { if (!emojiOpen && emojiBtn.current) setEmojiRect(emojiBtn.current.getBoundingClientRect()); setEmojiOpen((o) => !o); setCannedOpen(false); }} title="Emoji" style={{ fontSize: 16 }}>😀</button>
              {emojiOpen && emojiRect && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setEmojiOpen(false)} />
                  <div className="menu" style={{ position: "fixed", bottom: window.innerHeight - emojiRect.top + 6, left: emojiRect.left, width: 232, padding: 8, display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 2, zIndex: 201 }}>
                    {EMOJIS.map((e) => <button key={e} className="iconbtn" style={{ fontSize: 18 }} onClick={() => { setText((v) => v + e); setEmojiOpen(false); }}>{e}</button>)}
                  </div>
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function pick(mode: "agent" | "area", id: string) {
    setOpen(false);
    start(async () => { await transferConv(detail.id, mode, id); router.refresh(); });
  }

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="btn btn-sm btn-outline" disabled={pending} onClick={() => setOpen((o) => !o)}>
        <Icon name="swap" size={14} />{lang === "es" ? "Transferir" : "Transfer"}
      </button>
      {open && (
        <div className="menu scroll" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 220, maxHeight: 340, zIndex: 50 }}>
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
      )}
    </span>
  );
}

/* ---------- Workspace (center column) ---------- */
function Workspace({ detail, agents, areas, onResizeStart, onOpen360 }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; onResizeStart: (e: React.PointerEvent) => void; onOpen360: () => void }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(detail.contact?.name ?? "");
  const [actOpen, setActOpen] = useState(true);
  const [showXfer, setShowXfer] = useState(false);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => { setNameVal(detail.contact?.name ?? ""); setEditingName(false); }, [detail.contact?.id, detail.contact?.name]);

  function postNote() {
    const body = note.trim();
    if (!body) return;
    setNote("");
    start(async () => { await addConvNote(detail.id, body); router.refresh(); });
  }
  function saveName() {
    setEditingName(false);
    const v = nameVal.trim();
    if (v && detail.contact && v !== detail.contact.name) {
      start(async () => { await renameContact(detail.contact!.id, v); router.refresh(); });
    }
  }
  function removeChat() {
    if (!confirm(lang === "es" ? "¿Eliminar esta conversación y sus mensajes?" : "Delete this conversation and its messages?")) return;
    start(async () => { await deleteConv(detail.id); router.push("/chat"); router.refresh(); });
  }

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
            <div className="row gap-1">
              <button className="iconbtn sm" title={lang === "es" ? "Historial completo" : "Full history"} onClick={onOpen360}><Icon name="eye" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Renombrar" : "Rename"} onClick={() => setEditingName(true)}><Icon name="edit" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Buscar nombre" : "Fetch name"} disabled={pending} onClick={() => start(async () => { await requestContactInfo(detail.contact!.id); router.refresh(); })}><Icon name="refresh" size={15} /></button>
              <button className="iconbtn sm" title={lang === "es" ? "Eliminar chat" : "Delete chat"} onClick={removeChat}><Icon name="trash" size={15} /></button>
            </div>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {(detail.contact?.tags ?? []).map((tg) => <Pill key={tg} color="brand"><Icon name="tag" size={10} />{tg}</Pill>)}
            {detail.area && <Pill color={detail.area.color as PillColor}>{detail.area.name}</Pill>}
          </div>
          <div className="col gap-1" style={{ paddingTop: 4 }}>
            <div className="kv"><span className="k">{lang === "es" ? "Total gastado" : "Lifetime"}</span><span className="v mono">${detail.orders.reduce((s, o) => s + (o.total || 0), 0).toLocaleString("es-MX")}</span></div>
            <div className="kv"><span className="k">{lang === "es" ? "Primer contacto" : "First seen"}</span><span className="v">{detail.contact?.created_at ? new Date(detail.contact.created_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span></div>
          </div>
          <button className="btn btn-dark btn-block" style={{ marginTop: 2 }} onClick={onOpen360}><Icon name="eye" size={15} />{lang === "es" ? "Historial completo" : "Full history"}<span className="grow" /><Icon name="arrowr" size={15} /></button>
        </div>

        {/* orders */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Pedidos" : "Orders"} <span className="muted">· {detail.orders.length}</span></h4>
            <Link className="btn btn-sm btn-outline" href={`/orders?new=1&contact=${encodeURIComponent(detail.contact?.name ?? "")}`}><Icon name="plus" size={14} />{lang === "es" ? "Nuevo" : "New"}</Link>
          </div>
          <div className="ws-block-body col gap-2">
            {detail.orders.length === 0 ? <div className="muted t-sm" style={{ padding: "6px 2px" }}>{lang === "es" ? "Sin pedidos." : "No orders."}</div> :
              detail.orders.map((o) => (
                <Link key={o.id} href={`/orders?order=${o.id}`} className="ocard">
                  <div className="ocard-top"><span className="ocard-id mono">{o.code}</span><span className="grow" />{o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}</div>
                  {o.items?.[0]?.name && <div className="t-xs muted truncate">{o.items[0].name}{o.items.length > 1 ? ` +${o.items.length - 1}` : ""}</div>}
                  <div className="ocard-foot">{o.area && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}<span className="grow" /><span className="mono" style={{ fontWeight: 700, color: "var(--text)" }}>${o.total.toLocaleString("es-MX")}</span></div>
                </Link>
              ))}
          </div>
        </div>

        {/* actions */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="sliders" size={16} /><h4>{lang === "es" ? "Acciones" : "Actions"}</h4></div>
          <div className="ws-block-body">
            <div className="actions-grid">
              <StatusControl detail={detail} />
              <SnoozeControl detail={detail} />
              <button className="act" onClick={() => setShowXfer(true)}><Icon name="swap" />{lang === "es" ? "Transferir" : "Transfer"}</button>
              <button className="act" disabled={pending || !detail.contact} onClick={() => { const tg = prompt(lang === "es" ? "Etiqueta:" : "Tag:"); if (tg?.trim() && detail.contact) start(async () => { await addContactTag(detail.contact!.id, tg); router.refresh(); }); }}><Icon name="tag" />{lang === "es" ? "Etiqueta" : "Tag"}</button>
              <button className="act" disabled={pending} onClick={() => start(async () => { await setConvHidden(detail.id, !detail.hidden); router.refresh(); })}>
                <Icon name="eye" />{detail.hidden ? (lang === "es" ? "Mostrar" : "Unhide") : (lang === "es" ? "Ocultar" : "Hide")}
              </button>
              {detail.status === "resolved"
                ? <button className="act full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "open"); router.refresh(); })}><Icon name="dot" />{lang === "es" ? "Reabrir" : "Reopen"}</button>
                : <button className="act good full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "resolved"); router.refresh(); })}><Icon name="check" />{lang === "es" ? "Resolver" : "Resolve"}</button>}
            </div>
          </div>
        </div>

        {/* notes */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="edit" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Internal notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
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
        </div>

        {/* activity */}
        <div className="ws-block">
          <button className="ws-block-head" style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "left" }} onClick={() => setActOpen((v) => !v)}>
            <Icon name="clock" size={16} /><h4 className="grow">{lang === "es" ? "Actividad" : "Activity"}</h4>
            <span style={{ transform: actOpen ? "rotate(180deg)" : "none", transition: "transform .2s", display: "flex", color: "var(--text-muted)" }}><Icon name="chevd" size={16} /></span>
          </button>
          {actOpen && (
            <div className="ws-block-body"><div className="timeline">
              {detail.events.length === 0 ? <div className="muted t-sm">—</div> :
                detail.events.map((e) => (
                  <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{relTime(e.created_at, lang)}</div></div></div>
                ))}
            </div></div>
          )}
        </div>
      </div>
      <div className="col-resizer" onPointerDown={onResizeStart} title="" />
      {showXfer && (
        <TransferModal agents={agents} areas={areas} onClose={() => setShowXfer(false)}
          onConfirm={async (dest) => { await transferConv(detail.id, dest.type, dest.id); router.refresh(); }} />
      )}
    </div>
  );
}

function StatusControl({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="act" onClick={() => setOpen((o) => !o)}><Icon name="dot" />{lang === "es" ? "Estado" : "Status"}</button>
      {open && (
        <div className="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 180, zIndex: 50 }}>
          {(["open", "pending", "resolved"] as const).map((s) => (
            <button className="menu-item" key={s} onClick={() => { setOpen(false); start(async () => { await setConvStatus(detail.id, s); router.refresh(); }); }}>
              <Pill color={STATUS_COLOR[s]} dot>{STATUS_LABEL[s][lang]}</Pill>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function SnoozeControl({ detail }: { detail: ConvDetail }) {
  const { lang } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const snoozed = detail.snoozed_until ? new Date(detail.snoozed_until).getTime() > Date.now() : false;
  const apply = (iso: string | null) => { setOpen(false); start(async () => { await snoozeConv(detail.id, iso); router.refresh(); }); };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className={"act" + (snoozed ? " warn" : "")} onClick={() => setOpen((o) => !o)}><Icon name="clock" />{lang === "es" ? "Posponer" : "Snooze"}</button>
      {open && (
        <div className="menu" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 220, zIndex: 50 }}>
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
      )}
    </span>
  );
}

/** Note composer with @mention autocomplete of agents (fixed-position menu). */
function MentionTextarea({
  value, onChange, agents, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  agents: Agent[];
  placeholder?: string;
}) {
  const { lang } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ q: string; at: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [sel, setSel] = useState(0);

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d]*)$/u);
    if (m) {
      setMenu({ q: m[1], at: caret - m[1].length - 1 });
      setSel(0);
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 270), left: r.left, width: Math.min(300, Math.max(220, r.width)) });
      }
    } else setMenu(null);
  }
  const filtered = menu ? agents.filter((a) => a.name.toLowerCase().includes(menu.q.toLowerCase())) : [];
  function insert(a: Agent) {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart;
    const text = "@" + a.name + " ";
    const next = value.slice(0, menu.at) + text + value.slice(caret);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => { el.focus(); const p = menu.at + text.length; el.setSelectionRange(p, p); });
  }

  return (
    <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
      <textarea ref={ref} className="bare" rows={2} style={{ fontSize: 13, width: "100%" }} placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (menu && filtered.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(filtered[sel]); }
            else if (e.key === "Escape") setMenu(null);
          }
        }}
        onBlur={() => setTimeout(() => setMenu(null), 150)} />
      {menu && filtered.length > 0 && pos && (
        <div className="menu scroll" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: 240, zIndex: 1000 }}>
          <div className="menu-label">{lang === "es" ? "Mencionar" : "Mention"}</div>
          {filtered.map((a, i) => (
            <button type="button" key={a.id} className={"menu-item" + (i === sel ? " on" : "")} style={i === sel ? { background: "var(--surface-2)" } : undefined}
              onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); insert(a); }}>
              <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={22} />{a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
