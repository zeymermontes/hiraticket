"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Agent } from "@/lib/chat";
import type { InternalThread, InternalMsg } from "@/lib/internal";
import { loadInternalThreads, loadInternalMessages, sendInternalMessage, markInternalRead } from "@/app/(app)/internal/actions";

function clock(iso: string, lang: "es" | "en") {
  return new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

export function InternalChat({ initial, businessId }: { initial: { threads: InternalThread[]; agents: Agent[]; meId: string }; businessId: string }) {
  const { lang } = useApp();
  const [threads, setThreads] = useState(initial.threads);
  const [sel, setSel] = useState<string>(initial.threads[0]?.key ?? "team");
  const [msgs, setMsgs] = useState<InternalMsg[]>([]);
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const meId = initial.meId;
  const agentMap = useMemo(() => new Map(initial.agents.map((a) => [a.id, a])), [initial.agents]);
  const selRef = useRef(sel); selRef.current = sel;
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const teamLabel = lang === "es" ? "Equipo" : "Team";
  const title = (t: InternalThread) => (t.kind === "team" ? teamLabel : t.title);

  const refreshThreads = useCallback(() => { loadInternalThreads().then((r) => { if (r) setThreads(r.threads); }).catch(() => {}); }, []);
  const openChannel = useCallback((ch: string) => {
    setSel(ch);
    loadInternalMessages(ch).then(setMsgs).catch(() => {});
    start(async () => { await markInternalRead(ch); refreshThreads(); });
  }, [refreshThreads]);

  // Initial load of the first thread's messages.
  useEffect(() => { openChannel(selRef.current); /* eslint-disable-next-line */ }, []);

  // Realtime: any internal message → refresh threads; if it's the open channel, refresh its messages + mark read.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`internal-${businessId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, (p) => {
        const row = p.new as { channel?: string };
        refreshThreads();
        if (row.channel && row.channel === selRef.current) {
          loadInternalMessages(selRef.current).then(setMsgs).catch(() => {});
          markInternalRead(selRef.current).catch(() => {});
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId, refreshThreads]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  function send() {
    const body = text.trim();
    if (!body) return;
    const ch = sel;
    setText("");
    const optimistic: InternalMsg = { id: "tmp" + msgs.length, channel: ch, author_id: meId, body, mentions: [], created_at: new Date().toISOString() };
    setMsgs((m) => [...m, optimistic]);
    start(async () => { await sendInternalMessage(ch, body); refreshThreads(); });
  }

  const selThread = threads.find((t) => t.key === sel);

  return (
    <div className="chat" style={{ gridTemplateColumns: "300px minmax(300px,1fr)" }}>
      {/* threads list */}
      <div className="chatcol list">
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
      <div className="chatcol center" style={{ background: "var(--bg)" }}>
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
            return (
              <div className={"msg " + (mine ? "out" : "in")} key={m.id}>
                <div className="bubble">
                  {!mine && selThread?.kind === "team" && <div style={{ fontSize: 11.5, fontWeight: 700, color: au?.color ?? "var(--brand-700)", marginBottom: 2 }}>{au?.name ?? "Agente"}</div>}
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                  <div className="bubble-meta"><span>{clock(m.created_at, lang)}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="composer">
          <div className="composer-box">
            <div className="composer-input">
              <textarea ref={taRef} className="bare" rows={1} style={{ resize: "none" }} placeholder={lang === "es" ? "Mensaje interno…" : "Internal message…"} value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            </div>
            <div className="composer-actions">
              <span className="grow" />
              <button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}><Icon name="send" size={15} /> {lang === "es" ? "Enviar" : "Send"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
