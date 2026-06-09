"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor } from "@/lib/types";
import type { ConvDetail, Agent } from "@/lib/chat";

/** Full customer context takeover: stats + Orders / History / Notes tabs. */
export function CustomerOverlay({ detail, agents, onClose }: { detail: ConvDetail; agents: Agent[]; onClose: () => void }) {
  const { lang } = useApp();
  const [tab, setTab] = useState<"orders" | "history" | "notes">("orders");
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const c = detail.contact;
  const lifetime = detail.orders.reduce((s, o) => s + (o.total || 0), 0);
  const openCount = detail.orders.filter((o) => o.stage && !/entreg|deliver|pagad|paid|cerrad|closed/i.test(o.stage.name)).length;
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "numeric" });
  const dateTime = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="modal-wrap" style={{ alignItems: "stretch", justifyContent: "stretch" }}>
      <div className="scrim" onClick={onClose} />
      <div className="modal" style={{ width: "min(860px, 96vw)", maxHeight: "92vh", margin: "auto", display: "flex", flexDirection: "column" }}>
        <div className="modal-head">
          <Avatar name={c?.name} initials={deriveInitials(c?.name || c?.phone || "?")} color={avatarColor(c?.phone)} size={44} />
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="truncate" style={{ margin: 0 }}>{c?.name}</h3>
            <div className="row gap-2"><Icon name="whatsapp" size={13} /><span className="mono t-sm muted">{c?.phone}</span></div>
          </div>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>

        {/* stats */}
        <div className="row gap-3" style={{ padding: "0 20px 6px", flexWrap: "wrap" }}>
          {[
            { k: lang === "es" ? "Total gastado" : "Lifetime", v: `$${lifetime.toLocaleString("es-MX")}` },
            { k: lang === "es" ? "Pedidos" : "Orders", v: detail.orders.length },
            { k: lang === "es" ? "Abiertos" : "Open", v: openCount },
            { k: lang === "es" ? "Primer contacto" : "First seen", v: c?.created_at ? date(c.created_at) : "—" },
          ].map((s) => (
            <div key={s.k} className="ws-block" style={{ flex: 1, minWidth: 150, padding: 12 }}>
              <div className="t-xs muted">{s.k}</div>
              <div className="mono" style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{ padding: "8px 20px 0" }}>
          <div className="seg">
            {([["orders", lang === "es" ? "Pedidos" : "Orders", detail.orders.length], ["history", lang === "es" ? "Historial" : "History", detail.events.length], ["notes", lang === "es" ? "Notas" : "Notes", detail.notes.length]] as const).map(([id, lbl, n]) => (
              <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{lbl}{n > 0 && <span className="badge badge-soft">{n}</span>}</button>
            ))}
          </div>
        </div>

        <div className="modal-body scroll" style={{ flex: 1 }}>
          {tab === "orders" && (
            <div className="col gap-2">
              {detail.orders.length === 0 ? <div className="muted t-sm">{lang === "es" ? "Sin pedidos." : "No orders."}</div> :
                detail.orders.map((o) => (
                  <Link key={o.id} href={`/orders?order=${o.id}`} className="ws-block" style={{ padding: 12, textDecoration: "none", color: "inherit", display: "block" }}>
                    <div className="row gap-2"><span className="mono" style={{ fontWeight: 700 }}>{o.code}</span>{o.stage && <Pill color={o.stage.color as PillColor} dot>{o.stage.name}</Pill>}<span className="grow" /><span className="mono" style={{ fontWeight: 700 }}>${o.total.toLocaleString("es-MX")}</span></div>
                    {o.items?.[0]?.name && <div className="t-xs muted" style={{ marginTop: 4 }}>{o.items.map((i) => i.name).join(", ")}</div>}
                    <div className="row gap-2" style={{ marginTop: 6 }}>{o.area && <Pill color={o.area.color as PillColor}>{o.area.name}</Pill>}</div>
                  </Link>
                ))}
            </div>
          )}
          {tab === "history" && (
            <div className="timeline">
              {detail.events.length === 0 ? <div className="muted t-sm">—</div> : detail.events.map((e) => (
                <div className="tl" key={e.id}><div className="tl-dot"><div className="tl-ic"><Icon name={e.kind === "swap" ? "swap" : e.kind === "check" ? "check" : e.kind === "plus" ? "plus" : "clock"} size={13} /></div></div><div className="tl-body">{e.text}<div className="tl-time">{dateTime(e.created_at)}</div></div></div>
              ))}
            </div>
          )}
          {tab === "notes" && (
            <div className="col gap-2">
              {detail.notes.length === 0 ? <div className="muted t-sm">{lang === "es" ? "Sin notas." : "No notes."}</div> :
                detail.notes.map((n) => { const au = n.author_id ? agentMap.get(n.author_id) : null; return (
                  <div className="note" key={n.id}><Avatar name={au?.name} initials={deriveInitials(au?.name ?? "?")} color={au?.color} size={28} /><div className="note-body note-yellow"><div className="note-head"><span className="note-author">{au?.name ?? "Agente"}</span><span className="note-time">{dateTime(n.created_at)}</span></div><div className="note-text">{n.body}</div></div></div>
                ); })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
