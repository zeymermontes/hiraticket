"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Appointment } from "@/lib/extras";
import { createAppointment, setAppointmentStatus } from "@/app/(app)/features-actions";

const ST_COLOR = { scheduled: "blue", done: "green", canceled: "red" } as const;

export function AgendaScreen({ businessId, appointments }: { businessId: string; appointments: Appointment[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Agenda" : "Agenda"}</h1><Pill color="slate" large>{appointments.length}</Pill></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="calendar" size={16} /><h4>{lang === "es" ? "Citas" : "Appointments"}</h4></div>
          <div className="ws-block-body col gap-2">
            {appointments.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin citas." : "No appointments."}</div>}
            {appointments.map((a) => (
              <div key={a.id} className="row gap-3" style={{ alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="calendar" size={18} /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }} className="truncate">{a.title}</div>
                  <div className="t-xs muted">{fmt(a.starts_at)}{a.contact ? ` · ${a.contact.name}` : ""}</div>
                </div>
                <Pill color={ST_COLOR[a.status as keyof typeof ST_COLOR] ?? "slate"} dot>{a.status}</Pill>
                {a.status === "scheduled" && (
                  <button className="iconbtn sm" title={lang === "es" ? "Marcar hecha" : "Mark done"} style={{ color: "var(--green)" }} onClick={() => run(() => setAppointmentStatus(a.id, "done"))}><Icon name="check" size={15} /></button>
                )}
              </div>
            ))}
          </div>
        </section>

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
