"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { CardList, Card, CardTop, CardMeta } from "@/components/MobileCards";
import { useConfirm } from "@/components/Confirm";
import { Pill, Avatar, deriveInitials, avatarColor } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { tagColor } from "@/lib/types";
import type { ContactRow } from "@/lib/queries";
import { setConvMuted, deleteContact } from "@/app/(app)/chat/actions";
import { loadContactsPage } from "@/app/(app)/contacts/actions";

const PAGE = 60;

export function ContactsScreen({ initial, total: totalProp }: { initial: ContactRow[]; total: number }) {
  const { lang, personal } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(initial);
  const [total, setTotal] = useState(totalProp);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setRows(initial); setTotal(totalProp); }, [initial, totalProp]);
  const [, start] = useTransition();

  // La búsqueda corre en el SERVIDOR, con rebote: el cliente solo tiene una ventana del directorio,
  // así que filtrar localmente escondería a todos los que aún no se cargan. El rebote evita un viaje
  // por tecla; la secuencia evita que una respuesta lenta y vieja pise a una nueva.
  const searchSeq = useRef(0);
  const searchMounted = useRef(false);
  useEffect(() => {
    // La primera ventana ya vino del servidor: refetchear con q vacío al montar sería un viaje
    // redundante en el momento más sensible.
    if (!searchMounted.current) { searchMounted.current = true; return; }
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await loadContactsPage({ q: q.trim() || undefined, offset: 0 });
        if (seq === searchSeq.current) { setRows(page.rows); setTotal(page.total); }
      } finally { if (seq === searchSeq.current) setLoading(false); }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Scroll infinito: al acercarse al final de la tabla se pide la siguiente ventana.
  const loadMore = async () => {
    if (loading || rows.length >= total) return;
    setLoading(true);
    try {
      const page = await loadContactsPage({ q: q.trim() || undefined, offset: rows.length });
      setRows((r) => {
        const seen = new Set(r.map((x) => x.id));
        return [...r, ...page.rows.filter((x) => !seen.has(x.id))];
      });
      setTotal(page.total);
    } finally { setLoading(false); }
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) void loadMore();
  };

  const title = personal ? (lang === "es" ? "Contactos" : "Contacts") : (lang === "es" ? "Clientes" : "Customers");
  const objLabel = personal ? (lang === "es" ? "Tareas" : "Tasks") : (lang === "es" ? "Pedidos" : "Orders");

  const toggleMute = (c: ContactRow) => {
    if (!c.conv_id) return;
    setRows((rs) => rs.map((x) => (x.id === c.id ? { ...x, muted: !x.muted } : x)));
    start(async () => { await setConvMuted(c.conv_id!, !c.muted); });
  };
  const removeContact = async (c: ContactRow) => {
    if (!(await ask({ icon: "trash", danger: true, title: lang === "es" ? `Eliminar a ${c.name}` : `Delete ${c.name}`, message: lang === "es" ? "Se borran todos sus chats. Los pedidos se conservan. No se puede deshacer." : "All their chats are deleted. Orders are kept. This can't be undone.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" }))) return;
    setRows((rs) => rs.filter((x) => x.id !== c.id));
    start(async () => { await deleteContact(c.id); });
  };

  const filtered = rows;

  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

  return (
    <div className="page">
      <div className="phead">
        <h1>{title}</h1>
        <Pill color="slate" large>{total}</Pill>
      </div>

      <div className="toolbar">
        <div className="field field-sm" style={{ width: 280 }}>
          <Icon name="search" />
          <input autoFocus placeholder={lang === "es" ? "Buscar por nombre, teléfono o etiqueta…" : "Search by name, phone or tag…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="grow" />
        <span className="t-sm muted">{q ? `${total} ${lang === "es" ? "resultados" : "results"}` : `${rows.length} / ${total}`}</span>
      </div>

      {/* Móvil: nombre + teléfono + etiquetas, y las acciones a la derecha. `onScroll` va también
          aquí porque en móvil quien scrollea es la lista de tarjetas, no la tabla —- sin esto el
          scroll infinito dejaba de pedir páginas. */}
      <CardList onScroll={onScroll} empty={q ? (lang === "es" ? "Sin resultados." : "No matches.") : (lang === "es" ? "Aún no hay contactos." : "No contacts yet.")}>
        {filtered.map((c) => (
          <Card key={c.id} onClick={c.conv_id ? () => router.push(`/chat?c=${c.conv_id}`) : undefined}>
            <CardTop>
              <Avatar name={c.name} initials={deriveInitials(c.name || c.phone || "?")} color={avatarColor(c.phone)} size={36} />
              <span className="grow">
                <span className="card-title truncate" style={{ display: "block" }}>{c.name}</span>
                <span className="mono t-xs muted">{c.phone ?? "—"}</span>
              </span>
              <span className="row gap-1" style={{ flex: "none" }} onClick={(e) => e.stopPropagation()}>
                {c.conv_id && (
                  <button className={"iconbtn sm" + (c.muted ? " active" : "")} title={c.muted ? (lang === "es" ? "Conectar chat" : "Connect chat") : (lang === "es" ? "Desconectar chat (no guardar mensajes)" : "Disconnect chat (don't save messages)")} onClick={() => toggleMute(c)}><Icon name="wifioff" size={15} /></button>
                )}
                <button className="iconbtn sm" title={lang === "es" ? "Eliminar contacto y chats" : "Delete contact and chats"} style={{ color: "var(--red)" }} onClick={() => removeContact(c)}><Icon name="trash" size={15} /></button>
              </span>
            </CardTop>
            {(c.tags.length > 0 || c.orders_count > 0 || c.last_active) && (
              <CardMeta>
                {c.tags.slice(0, 3).map((t) => <Pill key={t} color={tagColor(t)}><Icon name="tag" size={10} />{t}</Pill>)}
                {c.orders_count > 0 && <Pill color="slate">{c.orders_count} {objLabel}</Pill>}
                <span className="grow" />
                <span>{fmtDate(c.last_active)}</span>
              </CardMeta>
            )}
          </Card>
        ))}
      </CardList>

      <div className="tablewrap scroll" onScroll={onScroll}>
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
              <tr key={c.id} onClick={() => { if (c.conv_id) router.push(`/chat?c=${c.conv_id}`); }} onMouseEnter={() => { if (c.conv_id) router.prefetch(`/chat?c=${c.conv_id}`); }} style={{ cursor: c.conv_id ? "pointer" : "default" }}>
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
        {loading && <div className="muted t-sm" style={{ padding: 10, textAlign: "center" }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}
      </div>
    </div>
  );
}
