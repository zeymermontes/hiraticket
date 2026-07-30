"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useConfirm } from "@/components/Confirm";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Appointment, DueOrder, Product } from "@/lib/extras";
import type { OrderDetail } from "@/lib/orders";
import type { Stage, Area } from "@/lib/business";
import type { Agent, ConvDetail } from "@/lib/chat";
import { OrderDrawer } from "@/components/OrderDrawer";
import { createAppointment, setAppointmentStatus, deleteAppointment } from "@/app/(app)/features-actions";

const ST_COLOR = { scheduled: "blue", done: "green", canceled: "red" } as const;
const ST_LABEL: Record<string, { es: string; en: string }> = {
  scheduled: { es: "Programada", en: "Scheduled" },
  done: { es: "Hecha", en: "Done" },
  canceled: { es: "Cancelada", en: "Canceled" },
};

function dayBucket(iso: string, lang: "es" | "en"): string {
  const d = new Date(iso), today = new Date(), tom = new Date(); tom.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return lang === "es" ? "Hoy" : "Today";
  if (d.toDateString() === tom.toDateString()) return lang === "es" ? "Mañana" : "Tomorrow";
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "long", day: "2-digit", month: "long" });
}

/** Los datos de apoyo del OrderDrawer — solo llegan cuando hay un ?order= abierto. */
export interface AgendaDrawerData {
  areas: Area[]; agents: Agent[]; products: Product[]; connected: boolean;
  shipping: string | null; invoicing: boolean; convDetail: ConvDetail | null;
}

export function AgendaScreen({ businessId, appointments, dueOrders = [], stages = [], openOrder = null, drawer = null, doneFromStageId = null }: {
  businessId: string; appointments: Appointment[];
  dueOrders?: DueOrder[]; stages?: Stage[]; openOrder?: OrderDetail | null; drawer?: AgendaDrawerData | null;
  doneFromStageId?: string | null;
}) {
  const { lang, personal } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [filter, setFilter] = useState<"all" | "scheduled" | "done" | "canceled">("all");
  const [past, setPast] = useState(false); // false = upcoming (today onward), true = past
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  // Pedidos con fecha límite: vencido = antes de HOY (día local). Uno para hoy con la hora pasada
  // sigue siendo "para hoy" —- todavía se puede entregar hoy.
  const overdueOrders = dueOrders.filter((o) => new Date(o.due_at) < startOfToday);
  const upcomingOrders = dueOrders.filter((o) => new Date(o.due_at) >= startOfToday);
  const missedAppts = appointments.filter((a) => a.status === "scheduled" && new Date(a.starts_at) < startOfToday);
  const openOrderRow = (o: DueOrder) => router.push(`/agenda?order=${o.id}`);
  // El mismo semáforo que las banderitas del TopBar, ahora en el borde de cada tarjeta: rojo hoy,
  // naranja mañana, amarillo pasado mañana. Más lejos, el borde normal — el color es urgencia, y
  // pintarlo todo sería no pintar nada.
  const toneOf = (iso: string): string | null => {
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const now = new Date();
    const k = key(new Date(iso));
    if (k === key(now)) return "#DC2626";
    if (k === key(new Date(now.getTime() + 86400000))) return "#EA580C";
    if (k === key(new Date(now.getTime() + 2 * 86400000))) return "#D97706";
    return null;
  };
  const fmtMoney = (n: number) => "$" + n.toLocaleString(lang === "es" ? "es-MX" : "en-US");
  const daysLate = (iso: string) => Math.max(1, Math.floor((startOfToday.getTime() - new Date(iso).getTime()) / 86400000) + 1);
  const inTime = (a: Appointment) => (past ? new Date(a.starts_at) < startOfToday : new Date(a.starts_at) >= startOfToday);
  const counts = {
    all: appointments.filter(inTime).length,
    scheduled: appointments.filter((a) => inTime(a) && a.status === "scheduled").length,
    done: appointments.filter((a) => inTime(a) && a.status === "done").length,
    canceled: appointments.filter((a) => inTime(a) && a.status === "canceled").length,
  };
  const visible = appointments.filter((a) => inTime(a) && (filter === "all" || a.status === filter));
  const CHIPS: { key: typeof filter; label: { es: string; en: string } }[] = [
    { key: "all", label: { es: "Todas", en: "All" } },
    { key: "scheduled", label: ST_LABEL.scheduled },
    { key: "done", label: ST_LABEL.done },
    { key: "canceled", label: ST_LABEL.canceled },
  ];

  const orderRow = (o: DueOrder, late: boolean) => (
    <div key={o.id} className="row gap-3" role="button" onClick={() => openOrderRow(o)}
      style={{ alignItems: "center", border: "1px solid " + (late ? "var(--red)" : (toneOf(o.due_at) ?? "var(--border)")), borderRadius: "var(--r-md)", padding: 12, cursor: "pointer" }}>
      <div style={{ textAlign: "center", minWidth: 52, borderRight: "1px solid var(--border)", paddingRight: 10 }}>
        <div className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{new Date(o.due_at).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      <span style={{ width: 32, height: 32, borderRadius: 10, background: late ? "var(--red)" : "var(--brand-50)", color: late ? "#fff" : "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="orders" size={16} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }} className="truncate">{o.code}{o.contact ? ` · ${o.contact.name}` : ""}</div>
        <div className="t-xs muted">
          {late
            ? (lang === "es" ? `Venció hace ${daysLate(o.due_at)} día(s) — ${new Date(o.due_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}` : `${daysLate(o.due_at)} day(s) late — ${new Date(o.due_at).toLocaleDateString("en-US", { day: "2-digit", month: "short" })}`)
            : (personal ? (lang === "es" ? "Tarea con fecha límite" : "Task due") : (lang === "es" ? "Entrega de pedido" : "Order delivery"))}
        </div>
      </div>
      {/* Dinero solo en modo negocio: en personal las tareas no tienen importe. */}
      {!personal && o.total > 0 && <span className="mono t-sm" style={{ fontWeight: 700 }}>{fmtMoney(o.total)}</span>}
      {late && <Pill color="red" dot>{lang === "es" ? "Vencido" : "Overdue"}</Pill>}
      <Icon name="arrowr" size={14} />
    </div>
  );

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Agenda" : "Agenda"}</h1><Pill color="slate" large>{appointments.length + dueOrders.length}</Pill></div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
       <div style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <div className="col gap-3" style={{ minWidth: 0 }}>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <div className="seg">
              <button className={past ? "" : "on"} onClick={() => setPast(false)}>{lang === "es" ? "Próximas" : "Upcoming"}</button>
              <button className={past ? "on" : ""} onClick={() => setPast(true)}>{lang === "es" ? "Pasadas" : "Past"}</button>
            </div>
            <div className="chip-row grow">
              {CHIPS.map((c) => (
                <button key={c.key} className={"chip" + (filter === c.key ? " on" : "")} onClick={() => setFilter(c.key)}>
                  {c.label[lang]}<span className="chip-n">{counts[c.key]}</span>
                </button>
              ))}
            </div>
          </div>
          {!past && (overdueOrders.length > 0 || missedAppts.length > 0) && (
            <section className="ws-block" style={{ borderColor: "var(--red)" }}>
              <div className="ws-block-head" style={{ color: "var(--red)" }}>
                <Icon name="flag" size={16} /><h4 className="grow">{lang === "es" ? "Vencidos" : "Overdue"}</h4>
                <span className="badge badge-red">{overdueOrders.length + missedAppts.length}</span>
              </div>
              <div className="ws-block-body col gap-2">
                {overdueOrders.map((o) => orderRow(o, true))}
                {missedAppts.map((a) => (
                  <div key={a.id} className="row gap-3" style={{ alignItems: "center", border: "1px solid var(--red)", borderRadius: "var(--r-md)", padding: 12 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--red)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar" size={16} /></span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }} className="truncate">{a.title}</div>
                      <div className="t-xs muted">{new Date(a.starts_at).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short" })}{a.contact ? ` · ${a.contact.name}` : ""}</div>
                    </div>
                    <button className="iconbtn sm" title={lang === "es" ? "Marcar hecha" : "Mark done"} style={{ color: "var(--green)" }} onClick={() => run(() => setAppointmentStatus(a.id, "done"))}><Icon name="check" size={15} /></button>
                    <button className="iconbtn sm" title={lang === "es" ? "Cancelar" : "Cancel"} style={{ color: "var(--amber)" }} onClick={() => run(() => setAppointmentStatus(a.id, "canceled"))}><Icon name="x" size={15} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {visible.length === 0 && upcomingOrders.length === 0 && <section className="ws-block"><div className="ws-block-body"><div className="muted t-sm">{lang === "es" ? "Sin citas." : "No appointments."}</div></div></section>}
          {(() => {
            // Citas y pedidos con fecha límite comparten los cubos por día, ordenados por hora.
            // Los pedidos solo aparecen con el chip "Todas": los otros chips filtran por estado de
            // cita, que un pedido no tiene —- mostrarlos ahí sería mezclar preguntas distintas.
            type Item = { at: string; a?: Appointment; o?: DueOrder };
            const items: Item[] = [
              ...visible.map((a) => ({ at: a.starts_at, a })),
              ...(!past && filter === "all" ? upcomingOrders.map((o) => ({ at: o.due_at, o })) : []),
            ].sort((x, y) => (x.at < y.at ? -1 : 1));
            return [...new Set(items.map((i) => dayBucket(i.at, lang)))].map((bucket) => (
            <section className="ws-block" key={bucket}>
              <div className="ws-block-head"><Icon name="calendar" size={16} /><h4 className="grow" style={{ textTransform: "capitalize" }}>{bucket}</h4><span className="badge badge-soft">{items.filter((i) => dayBucket(i.at, lang) === bucket).length}</span></div>
              <div className="ws-block-body col gap-2">
                {/* Intercalados por hora: la agenda del día se lee de arriba a abajo, sin importar
                    si lo de las 11 es una cita y lo de las 12 una entrega. */}
                {items.filter((i) => dayBucket(i.at, lang) === bucket).map((i) => i.o ? orderRow(i.o, false) : ((a) => (
                  <div key={a.id} className="row gap-3" style={{ alignItems: "center", border: "1px solid " + ((!past && toneOf(a.starts_at)) || "var(--border)"), borderRadius: "var(--r-md)", padding: 12 }}>
                    <div style={{ textAlign: "center", minWidth: 52, borderRight: "1px solid var(--border)", paddingRight: 10 }}>
                      <div className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{new Date(a.starts_at).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    {a.contact ? <Avatar name={a.contact.name} initials={deriveInitials(a.contact.name)} size={32} /> : <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar" size={16} /></span>}
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }} className="truncate">{a.title}</div>
                      {a.contact && <div className="t-xs muted">{a.contact.name}</div>}
                    </div>
                    <Pill color={ST_COLOR[a.status as keyof typeof ST_COLOR] ?? "slate"} dot>{ST_LABEL[a.status]?.[lang] ?? a.status}</Pill>
                    {a.status === "scheduled" && (
                      <>
                        <button className="iconbtn sm" title={lang === "es" ? "Marcar hecha" : "Mark done"} style={{ color: "var(--green)" }} onClick={() => run(() => setAppointmentStatus(a.id, "done"))}><Icon name="check" size={15} /></button>
                        <button className="iconbtn sm" title={lang === "es" ? "Cancelar" : "Cancel"} style={{ color: "var(--amber)" }} onClick={() => run(() => setAppointmentStatus(a.id, "canceled"))}><Icon name="x" size={15} /></button>
                      </>
                    )}
                    <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} style={{ color: "var(--red)" }}
                      onClick={async () => { if (await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar cita" : "Delete appointment", message: lang === "es" ? `"${a.title}" — no se puede deshacer.` : `"${a.title}" — this can't be undone.`, confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) run(() => deleteAppointment(a.id)); }}><Icon name="trash" size={15} /></button>
                  </div>
                ))(i.a!))}
              </div>
            </section>
            ));
          })()}
        </div>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nueva cita" : "New appointment"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Título" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="inp-inline" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button className="btn btn-primary btn-block" disabled={pending || !title.trim() || !when}
              onClick={() => { run(() => createAppointment(businessId, { title, starts_at: new Date(when).toISOString() })); setTitle(""); setWhen(""); }}>
              <Icon name="plus" size={15} />{lang === "es" ? "Agendar" : "Schedule"}
            </button>
          </div>
        </section>
       </div>
      </div>

      {openOrder && drawer && (
        <OrderDrawer
          detail={openOrder}
          stages={stages}
          areas={drawer.areas}
          agents={drawer.agents}
          products={drawer.products}
          businessId={businessId}
          convDetail={drawer.convDetail}
          connected={drawer.connected}
          shipping={drawer.shipping}
          invoicing={drawer.invoicing}
          doneFromStageId={doneFromStageId}
          onClose={() => router.push("/agenda")}
        />
      )}
    </div>
  );
}
