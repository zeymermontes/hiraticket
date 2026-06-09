"use client";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { sendMessage } from "@/app/(app)/chat/actions";

interface Msg {
  id: string; direction: string; body: string | null; type: string;
  media_url: string | null; created_at: string; deleted?: boolean;
}

/** Floating phone-style chat panel (docked beside the order drawer), like the prototype. */
export function MobileChatPanel({
  conversationId, contactName, phone, onClose,
}: {
  conversationId: string;
  contactName: string;
  phone?: string | null;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const supabase = useRef(createClient()).current;

  async function load() {
    const { data } = await supabase
      .from("messages")
      .select("id, direction, body, type, media_url, created_at, deleted")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setMsgs((data ?? []) as Msg[]);
  }
  useEffect(() => {
    load();
    const ch = supabase
      .channel("mchat-" + conversationId)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [msgs.length]);

  function send() {
    const b = text.trim();
    if (!b) return;
    setText("");
    start(async () => { await sendMessage(conversationId, b); load(); });
  }

  return (
    <div className="mchat" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("mchat")) onClose(); }}>
      <div className="mchat-phone">
        <div className="mchat-notch" />
        <div className="mchat-head">
          <Avatar name={contactName} initials={deriveInitials(contactName || phone || "?")} color={avatarColor(phone)} size={32} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="nm truncate">{contactName}</div>
            <div className="st row gap-1"><Icon name="whatsapp" size={11} />{lang === "es" ? "en línea" : "online"}</div>
          </div>
          <button className="iconbtn" style={{ color: "#fff" }} onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mchat-thread scroll" ref={endRef}>
          {msgs.map((m) => (
            <div className={"msg " + (m.direction === "out" ? "out" : "in")} key={m.id}>
              <div className="bubble">
                {m.deleted ? <span style={{ fontStyle: "italic", opacity: 0.6 }}>{lang === "es" ? "Mensaje eliminado" : "Deleted"}</span> : (
                  <>
                    {m.type !== "text" && m.media_url && (m.type === "image" || m.type === "sticker"
                      ? <img src={m.media_url} alt="" style={{ maxWidth: 160, borderRadius: 8, display: "block" }} />
                      : <a href={m.media_url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>📎 {m.type}</a>)}
                    {m.body && <div>{m.body}</div>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mchat-composer">
          <div className="field field-filled"><input placeholder={lang === "es" ? "Escribe…" : "Type…"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} /></div>
          <button className="iconbtn active" onClick={send} aria-label="send"><Icon name="send" /></button>
        </div>
      </div>
    </div>
  );
}
