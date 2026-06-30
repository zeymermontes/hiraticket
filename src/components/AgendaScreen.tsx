"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Appointment } from "@/lib/extras";
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

export function AgendaScreen({ businessId, appointments }: { businessId: string; appointments: Appointment[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [filter, setFilter] = useState<"all" | "scheduled" | "done" | "canceled">("all");
  const [past, setPast] = useState(false); // false = upcoming (today onward), true = past
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
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

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Agenda" : "Agenda"}</h1><Pill color="slate" large>{appointments.length}</Pill></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
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
          {visible.length === 0 && <section className="ws-block"><div className="ws-block-body"><div className="muted t-sm">{lang === "es" ? "Sin citas." : "No appointments."}</div></div></section>}
          {[...new Set(visible.map((a) => dayBucket(a.starts_at, lang)))].map((bucket) => (
            <section className="ws-block" key={bucket}>
              <div className="ws-block-head"><Icon name="calendar" size={16} /><h4 className="grow" style={{ textTransform: "capitalize" }}>{bucket}</h4><span className="badge badge-soft">{visible.filter((a) => dayBucket(a.starts_at, lang) === bucket).length}</span></div>
              <div className="ws-block-body col gap-2">
                {visible.filter((a) => dayBucket(a.starts_at, lang) === bucket).map((a) => (
                  <div key={a.id} className="row gap-3" style={{ alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
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
                      onClick={() => { if (confirm(lang === "es" ? `¿Eliminar la cita "${a.title}"? No se puede deshacer.` : `Delete the appointment "${a.title}"? This can't be undone.`)) run(() => deleteAppointment(a.id)); }}><Icon name="trash" size={15} /></button>
                  </div>
                ))}
              </div>
            </section>
          ))}
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
  );
}
