"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { tagColor } from "@/lib/types";
import type { ContactRow } from "@/lib/queries";
import { setConvMuted, deleteContact } from "@/app/(app)/chat/actions";

export function ContactsScreen({ contacts }: { contacts: ContactRow[] }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(contacts);
  useEffect(() => { setRows(contacts); }, [contacts]);
  const [, start] = useTransition();

  const title = personal ? (lang === "es" ? "Contactos" : "Contacts") : (lang === "es" ? "Clientes" : "Customers");
  const objLabel = personal ? (lang === "es" ? "Tareas" : "Tasks") : (lang === "es" ? "Pedidos" : "Orders");

  const toggleMute = (c: ContactRow) => {
    if (!c.conv_id) return;
    setRows((rs) => rs.map((x) => (x.id === c.id ? { ...x, muted: !x.muted } : x)));
    start(async () => { await setConvMuted(c.conv_id!, !c.muted); });
  };
  const removeContact = (c: ContactRow) => {
    if (!confirm(lang === "es" ? `¿Eliminar a ${c.name} y todos sus chats? Los pedidos se conservan. No se puede deshacer.` : `Delete ${c.name} and all their chats? Orders are kept. This can't be undone.`)) return;
    setRows((rs) => rs.filter((x) => x.id !== c.id));
    start(async () => { await deleteContact(c.id); });
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((c) =>
      c.name.toLowerCase().includes(s) ||
      (c.phone ?? "").toLowerCase().includes(s) ||
      c.tags.some((t) => t.toLowerCase().includes(s)));
  }, [rows, q]);

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

  return (
    <div className="page">
      <div className="phead">
        <h1>{title}</h1>
        <Pill color="slate" large>{rows.length}</Pill>
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 280 }}>
          <Icon name="search" />
          <input autoFocus placeholder={lang === "es" ? "Buscar por nombre, teléfono o etiqueta…" : "Search by name, phone or tag…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="grow" />
        <span className="t-sm muted">{filtered.length} {lang === "es" ? "resultados" : "results"}</span>
      </div>

      <div className="tablewrap scroll">
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>{lang === "es" ? "Contacto" : "Contact"}</th>
              <th>{lang === "es" ? "Teléfono" : "Phone"}</th>
              <th>{lang === "es" ? "Etiquetas" : "Tags"}</th>
              <th>{objLabel}</th>
              <th>{lang === "es" ? "Última actividad" : "Last active"}</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6}><div className="muted t-sm" style={{ padding: "24px 2px", textAlign: "center" }}>{q ? (lang === "es" ? "Sin resultados." : "No matches.") : (lang === "es" ? "Aún no hay contactos." : "No contacts yet.")}</div></td></tr>
            ) : filtered.map((c) => (
              <tr key={c.id} onClick={() => { if (c.conv_id) router.push(`/chat?c=${c.conv_id}`); }} style={{ cursor: c.conv_id ? "pointer" : "default" }}>
                <td>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <Avatar name={c.name} initials={deriveInitials(c.name || c.phone || "?")} color={avatarColor(c.phone)} size={32} />
                    <span style={{ fontWeight: 600 }} className="truncate">{c.name}</span>
                  </div>
                </td>
                <td className="mono t-sm muted">{c.phone ?? "—"}</td>
                <td>
                  <div className="row gap-1" style={{ flexWrap: "wrap" }}>
                    {c.tags.slice(0, 4).map((t) => <Pill key={t} color={tagColor(t)}><Icon name="tag" size={10} />{t}</Pill>)}
                  </div>
                </td>
                <td>{c.orders_count > 0 ? <Pill color="slate">{c.orders_count}</Pill> : <span className="muted">—</span>}</td>
                <td className="t-sm muted">{fmtDate(c.last_active)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                    {c.conv_id && (
                      <>
                        <button className="iconbtn sm" title={lang === "es" ? "Abrir chat" : "Open chat"} onClick={() => router.push(`/chat?c=${c.conv_id}`)}><Icon name="whatsapp" size={15} /></button>
                        <button className={"iconbtn sm" + (c.muted ? " active" : "")} title={c.muted ? (lang === "es" ? "Conectar chat" : "Connect chat") : (lang === "es" ? "Desconectar chat (no guardar mensajes)" : "Disconnect chat (don't save messages)")} onClick={() => toggleMute(c)}><Icon name="wifioff" size={15} /></button>
                      </>
                    )}
                    <button className="iconbtn sm" title={lang === "es" ? "Eliminar contacto y chats" : "Delete contact and chats"} style={{ color: "var(--red)" }} onClick={() => removeContact(c)}><Icon name="trash" size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
