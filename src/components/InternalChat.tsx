"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import type { Agent } from "@/lib/chat";
import type { InternalThread, InternalMsg } from "@/lib/internal";
import { loadInternalThreads, loadInternalMessages, sendInternalMessage, markInternalRead, editInternalMessage, deleteInternalMessage, reactInternalMessage } from "@/app/(app)/internal/actions";

const QUICK = ["👍", "❤️", "😂", "🙌", "✅", "🔥"];
function clock(iso: string, lang: "es" | "en") {
  return new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

export function InternalChat({ initial, businessId }: { initial: { threads: InternalThread[]; agents: Agent[]; meId: string }; businessId: string }) {
  const { lang } = useApp();
  const [threads, setThreads] = useState(initial.threads);
  const [sel, setSel] = useState<string>(initial.threads[0]?.key ?? "team");
  const [msgs, setMsgs] = useState<InternalMsg[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<InternalMsg | null>(null);
  const [editing, setEditing] = useState<InternalMsg | null>(null);
  const [emojiRect, setEmojiRect] = useState<DOMRect | null>(null);
  const [reactTarget, setReactTarget] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [, start] = useTransition();
  const meId = initial.meId;
  const agentMap = useMemo(() => new Map(initial.agents.map((a) => [a.id, a])), [initial.agents]);
  const msgMap = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const selRef = useRef(sel); selRef.current = sel;
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);

  const teamLabel = lang === "es" ? "Equipo" : "Team";
  const title = (t: InternalThread) => (t.kind === "team" ? teamLabel : t.title);

  const refreshThreads = useCallback(() => { loadInternalThreads().then((r) => { if (r) setThreads(r.threads); }).catch(() => {}); }, []);
  const refreshMsgs = useCallback((ch: string) => { loadInternalMessages(ch).then(setMsgs).catch(() => {}); }, []);
  const openChannel = useCallback((ch: string) => {
    setSel(ch); setReply(null); setEditing(null); setText("");
    refreshMsgs(ch);
    start(async () => { await markInternalRead(ch); refreshThreads(); });
  }, [refreshThreads, refreshMsgs]);

  useEffect(() => { openChannel(selRef.current); /* eslint-disable-next-line */ }, []);

  // Realtime: any internal message change → refresh threads; if it's the open channel, refresh it + mark read.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`internal-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, (p) => {
        const row = (p.new ?? p.old) as { channel?: string };
        refreshThreads();
        if (row?.channel && row.channel === selRef.current) { refreshMsgs(selRef.current); markInternalRead(selRef.current).catch(() => {}); }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId, refreshThreads, refreshMsgs]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  function submit() {
    const body = text.trim();
    if (!body) return;
    if (editing) { const id = editing.id; setEditing(null); setText(""); start(async () => { await editInternalMessage(id, body); refreshMsgs(selRef.current); }); return; }
    const ch = sel; const rt = reply?.id ?? null;
    setText(""); setReply(null);
    const optimistic: InternalMsg = { id: "tmp" + msgs.length, channel: ch, author_id: meId, body, mentions: [], created_at: new Date().toISOString(), reply_to: rt, edited: false, deleted: false, reactions: [] };
    setMsgs((m) => [...m, optimistic]);
    start(async () => { await sendInternalMessage(ch, body, rt); refreshThreads(); });
  }
  const startEdit = (m: InternalMsg) => { setEditing(m); setReply(null); setText(m.body); taRef.current?.focus(); };
  const del = (m: InternalMsg) => { if (!confirm(lang === "es" ? "¿Eliminar este mensaje?" : "Delete this message?")) return; start(async () => { await deleteInternalMessage(m.id); refreshMsgs(selRef.current); }); };
  const react = (id: string, emoji: string) => { setReactTarget(null); start(async () => { await reactInternalMessage(id, emoji); refreshMsgs(selRef.current); }); };

  const selThread = threads.find((t) => t.key === sel);

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* threads list */}
      <div className="chatcol" style={{ width: 300, flex: "none" }}>
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
      <div className="chatcol" style={{ flex: 1, minWidth: 0, background: "var(--bg)" }}>
        <div className="thread-head">
          {selThread?.kind === "team"
            ? <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="agents" size={18} /></span>
            : <Avatar name={selThread?.title} initials={deriveInitials(selThread?.title ?? "?")} color={selThread?.color} size={36} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{selThread ? title(selThread) : teamLabel}</div>
            <div className="t-xs muted">{selThread?.kind === "team" ? (lang === "es" ? "Todo el equipo" : "Whole team") : (lang === "es" ? "Mensaje directo · interno" : "Direct message · internal")}</div>
          </div>
        </div>

        <div className="thread scroll" ref={endRef}>
          {msgs.length === 0 ? (
            <div className="empty" style={{ padding: "56px 24px" }}><div className="empty-art"><Icon name="chat" /></div><p className="muted t-sm">{lang === "es" ? "Inicia la conversación interna." : "Start the internal conversation."}</p></div>
          ) : msgs.map((m) => {
            const mine = m.author_id === meId;
            const au = m.author_id ? agentMap.get(m.author_id) : null;
            const quoted = m.reply_to ? msgMap.get(m.reply_to) : null;
            return (
              <div className={"msg " + (mine ? "out" : "in")} key={m.id}>
                <div className="bubble">
                  {!mine && selThread?.kind === "team" && !m.deleted && <div style={{ fontSize: 11.5, fontWeight: 700, color: au?.color ?? "var(--brand-700)", marginBottom: 2 }}>{au?.name ?? "Agente"}</div>}
                  {quoted && !m.deleted && (
                    <div style={{ borderLeft: "3px solid var(--brand)", padding: "2px 8px", margin: "0 0 4px", background: "rgba(0,0,0,.05)", borderRadius: 6, fontSize: 12 }}>
                      <div style={{ fontWeight: 700, color: "var(--brand-700)" }}>{quoted.author_id === meId ? (lang === "es" ? "Tú" : "You") : (agentMap.get(quoted.author_id ?? "")?.name ?? "Agente")}</div>
                      <div className="truncate" style={{ opacity: 0.8 }}>{quoted.deleted ? "—" : quoted.body}</div>
                    </div>
                  )}
                  {m.deleted
                    ? <div className="row gap-1" style={{ fontStyle: "italic", opacity: 0.6 }}><Icon name="x" size={12} />{lang === "es" ? "Mensaje eliminado" : "Message deleted"}</div>
                    : <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>}
                  <div className="bubble-meta">{m.edited && !m.deleted && <span style={{ marginRight: 4, fontSize: 10.5, opacity: 0.7 }}>{lang === "es" ? "editado" : "edited"}</span>}<span>{clock(m.created_at, lang)}</span></div>
                  {!m.deleted && m.reactions.length > 0 && (
                    <div className="msg-reacts">
                      {m.reactions.map((r, i) => <button key={i} className={"msg-react" + (r.by === meId ? " mine" : "")} onClick={() => react(m.id, r.emoji)}>{r.emoji}</button>)}
                    </div>
                  )}
                  {!m.deleted && !m.id.startsWith("tmp") && <InternalMsgMenu m={m} mine={mine} lang={lang} onReply={() => { setReply(m); setEditing(null); taRef.current?.focus(); }} onCopy={() => navigator.clipboard?.writeText(m.body).catch(() => {})} onEdit={() => startEdit(m)} onDelete={() => del(m)} onReact={(rect) => setReactTarget({ id: m.id, rect })} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="composer">
          {(reply || editing) && (
            <div className="row gap-2" style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: 8, marginBottom: 6 }}>
              <Icon name={editing ? "edit" : "swap"} size={14} />
              <span className="t-xs muted grow truncate">{(editing ? (lang === "es" ? "Editando: " : "Editing: ") : (lang === "es" ? "Respondiendo: " : "Replying: ")) + ((editing || reply)?.body ?? "")}</span>
              <button className="iconbtn sm" onClick={() => { setEditing(null); setReply(null); if (editing) setText(""); }}><Icon name="x" size={14} /></button>
            </div>
          )}
          <div className="composer-box">
            <div className="composer-input">
              <textarea ref={taRef} className="bare" rows={1} style={{ resize: "none" }} placeholder={lang === "es" ? "Mensaje interno…" : "Internal message…"} value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            </div>
            <div className="composer-actions">
              <span style={{ display: "inline-flex" }}>
                <button ref={emojiBtn} className="iconbtn" title="Emoji" style={{ fontSize: 16 }} onClick={() => setEmojiRect(emojiRect ? null : emojiBtn.current?.getBoundingClientRect() ?? null)}>😀</button>
                {emojiRect && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setEmojiRect(null)} />
                    <EmojiPicker rect={emojiRect} onPick={(e) => setText((v) => v + e)} />
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
          <div className="menu" style={{ position: "fixed", top: reactTarget.rect.bottom + 4, left: Math.max(8, reactTarget.rect.left - 80), zIndex: 201, display: "flex", gap: 4, padding: 6 }}>
            {QUICK.map((e) => <button key={e} className="iconbtn" style={{ fontSize: 18 }} onClick={() => react(reactTarget.id, e)}>{e}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

/** Per-message hover menu for internal chat: reply / copy / react / edit (own) / delete (own). */
function InternalMsgMenu({ m, mine, lang, onReply, onCopy, onEdit, onDelete, onReact }: { m: InternalMsg; mine: boolean; lang: "es" | "en"; onReply: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void; onReact: (rect: DOMRect) => void }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  void m;
  return (
    <>
      <button ref={btn} className="msg-menu-btn" aria-label="Menu" onClick={() => { setRect(btn.current?.getBoundingClientRect() ?? null); setOpen((o) => !o); }}><Icon name="dots" size={14} /></button>
      {open && rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setOpen(false)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 4, left: Math.max(8, rect.left - 150), width: 180, zIndex: 201 }}>
            <button className="menu-item" onClick={() => { setOpen(false); onReact(rect); }}><Icon name="at" size={15} />{lang === "es" ? "Reaccionar" : "React"}</button>
            <button className="menu-item" onClick={() => { setOpen(false); onReply(); }}><Icon name="swap" size={15} />{lang === "es" ? "Responder" : "Reply"}</button>
            <button className="menu-item" onClick={() => { setOpen(false); onCopy(); }}><Icon name="file" size={15} />{lang === "es" ? "Copiar" : "Copy"}</button>
            {mine && <button className="menu-item" onClick={() => { setOpen(false); onEdit(); }}><Icon name="edit" size={15} />{lang === "es" ? "Editar" : "Edit"}</button>}
            {mine && <button className="menu-item danger" onClick={() => { setOpen(false); onDelete(); }}><Icon name="trash" size={15} />{lang === "es" ? "Eliminar" : "Delete"}</button>}
          </div>
        </>
      )}
    </>
  );
}
