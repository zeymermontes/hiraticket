"use client";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Agent, ConvListItem, ConvDetail, ChatMessage } from "@/lib/chat";
import type { Area } from "@/lib/business";
import {
  sendMessage, setConvStatus, acceptConv, addConvNote, transferConv,
} from "@/app/(app)/chat/actions";

const STATUS_COLOR: Record<string, PillColor> = { open: "blue", pending: "amber", resolved: "green" };
const STATUS_LABEL: Record<string, { es: string; en: string }> = {
  open: { es: "Abierto", en: "Open" },
  pending: { es: "Pendiente", en: "Pending" },
  resolved: { es: "Resuelto", en: "Resolved" },
};

export function ChatScreen({
  list, detail, selectedId, agents, areas, meId, connected,
}: {
  list: ConvListItem[];
  detail: ConvDetail | null;
  selectedId: string | null;
  agents: Agent[];
  areas: Area[];
  meId: string;
  connected: boolean;
}) {
  const { lang } = useApp();
  const [tab, setTab] = useState<"mine" | "unassigned" | "all">("mine");
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string | null>(null);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const filtered = useMemo(() => {
    return list.filter((c) => {
      if (tab === "mine" && c.assignee_id !== meId) return false;
      if (tab === "unassigned" && c.assignee_id != null) return false;
      if (statusF && c.status !== statusF) return false;
      if (q) {
        const hay = (c.contact?.name ?? "") + " " + c.preview;
        if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [list, tab, statusF, q, meId]);

  const mineN = list.filter((c) => c.assignee_id === meId).length;
  const unN = list.filter((c) => c.assignee_id == null).length;

  return (
    <div className="chat" style={{ position: "relative" }}>
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
          </div>
        </div>
        <div className="col-scroll scroll">
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: "56px 24px" }}>
              <div className="empty-art"><Icon name="chat" /></div>
              <h3>{lang === "es" ? "Sin conversaciones" : "No conversations"}</h3>
            </div>
          ) : (
            filtered.map((c) => {
              const a = c.assignee_id ? agentMap.get(c.assignee_id) : null;
              return (
                <Link key={c.id} href={`/chat?c=${c.id}`} className={"conv" + (c.id === selectedId ? " sel" : "") + (c.unread ? " unread" : "")}>
                  <Avatar name={c.contact?.name} initials={deriveInitials(c.contact?.name ?? "?")} size={42} />
                  <div className="conv-body">
                    <div className="conv-top">
                      <span className="conv-name truncate">{c.contact?.name ?? "—"}</span>
                      <span className="conv-time">{relTime(c.last_message_at, lang)}</span>
                    </div>
                    <div className="conv-prev truncate">{c.preview}</div>
                    <div className="conv-meta">
                      <Pill color={STATUS_COLOR[c.status]} dot>{STATUS_LABEL[c.status][lang]}</Pill>
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
          <Workspace detail={detail} agents={agents} areas={areas} />
          <Thread detail={detail} agents={agents} areas={areas} connected={connected} />
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
function Thread({ detail, agents, areas, connected }: { detail: ConvDetail; agents: Agent[]; areas: Area[]; connected: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [extra, setExtra] = useState<ChatMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => { setExtra([]); }, [detail.id, detail.messages.length]);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; });

  const assignee = detail.assignee_id ? agentMap.get(detail.assignee_id) : null;
  const messages = [...detail.messages, ...extra];

  function doSend() {
    const body = text.trim();
    if (!body) return;
    setExtra((e) => [...e, { id: "tmp" + e.length, direction: "out", type: "text", body, state: "sent", author_id: null, created_at: new Date().toISOString() }]);
    setText("");
    start(async () => { await sendMessage(detail.id, body); router.refresh(); });
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
    <div className="chatcol">
      <div className="thread-head">
        <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name ?? "?")} size={38} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2">
            <span style={{ fontWeight: 700 }} className="truncate">{detail.contact?.name}</span>
            <span className="pill pill-green" style={{ height: 18, padding: "0 6px" }}><Icon name="whatsapp" size={11} />WhatsApp</span>
          </div>
          <div className="t-xs muted">{assignee ? (lang === "es" ? "Atiende " : "Handled by ") + assignee.name : lang === "es" ? "Sin asignar" : "Unassigned"}</div>
        </div>
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
        {messages.map((m) => {
          const out = m.direction === "out";
          const author = out && m.author_id ? agentMap.get(m.author_id) : null;
          return (
            <div className={"msg " + (out ? "out" : "in")} key={m.id}>
              <div className="bubble">
                {author && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-700)", marginBottom: 2 }}>{author.name}</div>}
                <div>{m.body}</div>
                <div className="bubble-meta">{relTime(m.created_at, lang)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        <div className="composer-box">
          <div className="composer-input">
            <textarea className="bare" rows={1} placeholder={lang === "es" ? "Escribe un mensaje…" : "Type a message…"} value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }} />
          </div>
          <div className="composer-actions">
            <span className="grow" />
            <button className="btn btn-primary btn-sm" onClick={doSend} disabled={!text.trim() || pending}><Icon name="send" size={15} /> {lang === "es" ? "Enviar" : "Send"}</button>
          </div>
        </div>
      </div>
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
function Workspace({ detail, agents, areas }: { detail: ConvDetail; agents: Agent[]; areas: Area[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  function postNote() {
    const body = note.trim();
    if (!body) return;
    setNote("");
    start(async () => { await addConvNote(detail.id, body); router.refresh(); });
  }

  return (
    <div className="chatcol ctx">
      <div className="ws scroll">
        <div className="ws-contact">
          <div className="row gap-3">
            <Avatar name={detail.contact?.name} initials={deriveInitials(detail.contact?.name ?? "?")} size={52} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }} className="truncate">{detail.contact?.name}</div>
              <div className="row gap-2" style={{ marginTop: 3 }}><Icon name="whatsapp" size={14} /><span className="mono t-sm muted nowrap">{detail.contact?.phone}</span></div>
            </div>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            {(detail.contact?.tags ?? []).map((tg) => <Pill key={tg} color="brand"><Icon name="dot" size={10} />{tg}</Pill>)}
            {detail.area && <Pill color={detail.area.color as PillColor}>{detail.area.name}</Pill>}
          </div>
        </div>

        {/* orders */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Pedidos" : "Orders"} <span className="muted">· {detail.orders.length}</span></h4></div>
          <div className="ws-block-body col gap-2">
            {detail.orders.length === 0 ? <div className="muted t-sm" style={{ padding: "6px 2px" }}>{lang === "es" ? "Sin pedidos." : "No orders."}</div> :
              detail.orders.map((o) => (
                <Link key={o.id} href="/orders" className="ocard">
                  <div className="ocard-top"><span className="ocard-id mono">{o.code}</span><span className="grow" />{o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}</div>
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
              {detail.status === "resolved"
                ? <button className="act full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "open"); router.refresh(); })}><Icon name="dot" />{lang === "es" ? "Reabrir" : "Reopen"}</button>
                : <button className="act good full" disabled={pending} onClick={() => start(async () => { await setConvStatus(detail.id, "resolved"); router.refresh(); })}><Icon name="check" />{lang === "es" ? "Resolver" : "Resolve"}</button>}
            </div>
          </div>
        </div>

        {/* notes */}
        <div className="ws-block">
          <div className="ws-block-head"><Icon name="dot" size={16} /><h4 className="grow">{lang === "es" ? "Notas internas" : "Internal notes"}</h4><Pill color="amber"><Icon name="lock" size={11} />{lang === "es" ? "Interno" : "Internal"}</Pill></div>
          <div className="ws-block-body">
            <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px", marginBottom: 8 }}>
              <textarea className="bare" rows={2} placeholder={lang === "es" ? "Agregar nota…" : "Add a note…"} value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 13 }} />
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
          <div className="ws-block-head"><Icon name="clock" size={16} /><h4>{lang === "es" ? "Actividad" : "Activity"}</h4></div>
          <div className="ws-block-body"><div className="timeline">
            {detail.events.length === 0 ? <div className="muted t-sm">—</div> :
              detail.events.map((e) => (
                <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{relTime(e.created_at, lang)}</div></div></div>
              ))}
          </div></div>
        </div>
      </div>
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

function relTime(iso: string | null, lang: "es" | "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return lang === "es" ? "ahora" : "now";
  if (diff < 60) return `${Math.floor(diff)}m`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h`;
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" });
}
