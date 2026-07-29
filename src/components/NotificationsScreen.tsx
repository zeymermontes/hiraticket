"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { loadNotificationFeed } from "@/app/(app)/chat/live-actions";
import type { Notif, NotifFilter } from "@/lib/notifications";

const PAGE = 20;

function when(at: string | null, lang: "es" | "en") {
  if (!at) return "";
  const d = new Date(at);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return lang === "es" ? "ahora" : "now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h";
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function NotifIcon({ kind }: { kind: Notif["kind"] }) {
  if (kind === "mention") return <span className="nf-ic" style={{ background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="at" size={16} /></span>;
  if (kind === "internal") return <span className="nf-ic" style={{ background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="chat" size={16} /></span>;
  return <span className="nf-ic" style={{ background: "var(--wa)", color: "#fff" }}><Icon name="whatsapp" size={16} /></span>;
}

export function NotificationsScreen({ initial }: { initial: Notif[] }) {
  const { lang } = useApp();
  const [filter, setFilter] = useState<NotifFilter>("all");
  const [items, setItems] = useState<Notif[]>(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const firstRender = useRef(true);

  const loadFirst = (f: NotifFilter) => {
    setLoading(true);
    loadNotificationFeed(undefined, f).then((r) => { setItems(r); setDone(r.length < PAGE); }).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; } // initial 'all' page came from the server
    loadFirst(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const loadMore = () => {
    if (loading || done) return;
    const last = items[items.length - 1];
    setLoading(true);
    loadNotificationFeed(last?.at ?? undefined, filter).then((r) => {
      setItems((prev) => { const seen = new Set(prev.map((x) => x.id)); return [...prev, ...r.filter((x) => !seen.has(x.id))]; });
      setDone(r.length < PAGE);
    }).finally(() => setLoading(false));
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 220) loadMore();
  };

  const tabs: { id: NotifFilter; label: string }[] = [
    { id: "all", label: lang === "es" ? "Todas" : "All" },
    { id: "internal", label: lang === "es" ? "Chats internos" : "Internal chats" },
    { id: "mentions", label: lang === "es" ? "Menciones" : "Mentions" },
  ];

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Notificaciones" : "Notifications"}</h1></div>
      <div className="toolbar">
        <div className="seg seg-sm">
          {tabs.map((t) => <button key={t.id} className={filter === t.id ? "on" : ""} onClick={() => setFilter(t.id)}>{t.label}</button>)}
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }} onScroll={onScroll}>
        {items.length === 0 && !loading ? (
          <div className="empty" style={{ padding: "56px 24px" }}><div className="empty-art"><Icon name="bell" /></div><p className="muted t-sm">{lang === "es" ? "Sin notificaciones." : "No notifications."}</p></div>
        ) : (
          <div className="nf-list">
            {items.map((n) => (
              <Link key={n.id} href={n.href} prefetch={false} className="nf-row">
                <NotifIcon kind={n.kind} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600 }} className="truncate">{n.text ?? ((lang === "es" ? "Nuevo mensaje de " : "New message from ") + n.name)}</div>
                  <div className="t-xs muted">{when(n.at, lang)}{n.kind === "chat" && n.unread > 1 ? ` · ${n.unread}` : ""}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {loading && <div className="muted t-sm" style={{ textAlign: "center", padding: 16 }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}
        {done && items.length > 0 && <div className="muted t-xs" style={{ textAlign: "center", padding: 16 }}>{lang === "es" ? "No hay más." : "Nothing more."}</div>}
      </div>
    </div>
  );
}
