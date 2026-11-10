"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { uploadMedia } from "@/lib/uploadMedia";
import { mediaTypeOf } from "@/lib/mediaUpload";
import { queueFollowUp, scheduleMessage } from "@/app/(app)/chat/actions";

/**
 * Dos usos, misma ventana:
 *  - "Mensaje en espera" (`mode: "wait"`): con la ventana de 24 h cerrada, el agente deja aquí lo que
 *    quiere decirle al cliente (texto y archivos). Sale solo, una vez, en cuanto el cliente responda.
 *  - "Programar mensaje" (`mode: "schedule"`): el agente elige fecha y hora; sale a esa hora, a uno o
 *    a varios chats (desde la selección múltiple de la lista). Si son varios, el worker los suelta uno
 *    tras otro con 10 segundos entre cada chat para que WhatsApp no lo tome como spam.
 * Solo existe en el chat de clientes: el de equipo no tiene ventana ni riesgo de spam.
 */
export function FollowUpModal({ convIds, businessId, mode = "wait", initialText = "", onClose, onSaved }: {
  convIds: string[]; businessId: string; mode?: "wait" | "schedule"; initialText?: string; onClose: () => void; onSaved: () => void;
}) {
  const { lang, personal } = useApp();
  const es = lang === "es";
  const who = personal ? (es ? "el contacto" : "the contact") : (es ? "el cliente" : "the customer");
  const schedule = mode === "schedule";
  const n = convIds.length;
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<File[]>([]);
  const [when, setWhen] = useState(() => toLocalInput(defaultWhen()));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const whenDate = when ? new Date(when) : null;
  const whenOk = !schedule || (whenDate && !isNaN(whenDate.getTime()) && whenDate.getTime() > Date.now() - 60 * 1000);
  const ready = (text.trim() || files.length > 0) && whenOk && !saving;

  async function save() {
    if (!ready) return;
    setSaving(true); setErr(null);
    try {
      const items: Parameters<typeof queueFollowUp>[1] = [];
      for (let i = 0; i < files.length; i++) {
        const up = await uploadMedia(businessId, "out", files[i]);
        items.push({ type: mediaTypeOf(up.mime), mediaUrl: up.path, mime: up.mime, name: up.name, size: up.size, thumb: up.thumb, body: i === 0 ? text.trim() || undefined : undefined });
      }
      if (!files.length) items.push({ type: "text", body: text.trim() });
      const r = schedule ? await scheduleMessage(convIds, items, whenDate!.toISOString()) : await queueFollowUp(convIds[0], items);
      if (!r.ok) {
        setErr(r.error === "migration-0095" || r.error === "migration-0098"
          ? (es ? `Falta aplicar la migración ${r.error.slice(10)} en la base.` : `Migration ${r.error.slice(10)} has not been applied yet.`)
          : r.error === "past" ? (es ? "Esa hora ya pasó." : "That time has already passed.")
          : (es ? "No se pudo guardar el mensaje." : "Couldn't save the message."));
        return;
      }
      onSaved(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : (es ? "No se pudo subir el archivo." : "Couldn't upload the file."));
    } finally { setSaving(false); }
  }

  // Atajos de hora: lo que más se programa es "en un rato" y "mañana temprano".
  const presets: { label: string; at: () => Date }[] = [
    { label: es ? "En 1 hora" : "In 1 hour", at: () => roundUp(new Date(Date.now() + 60 * 60 * 1000)) },
    { label: es ? "Hoy 18:00" : "Today 6 PM", at: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; } },
    { label: es ? "Mañana 9:00" : "Tomorrow 9 AM", at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: es ? "Lunes 9:00" : "Monday 9 AM", at: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
  ].filter((p) => p.at().getTime() > Date.now());

  const title = schedule ? (es ? "Programar mensaje" : "Schedule message") : (es ? "Mensaje en espera" : "Waiting message");
  const chats = n === 1 ? (es ? "1 chat" : "1 chat") : (es ? `${n} chats` : `${n} chats`);

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={saving ? undefined : onClose} />
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={schedule ? "calendar" : "clock"} size={18} /></span>
          <h3 className="grow">{title}{schedule && n > 1 ? ` · ${chats}` : ""}</h3>
          <button className="iconbtn" onClick={onClose} disabled={saving}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          {schedule ? (
            <>
              <div className="col gap-2">
                <label className="t-xs" style={{ fontWeight: 700, color: "var(--text-2)" }}>{es ? "Enviar el" : "Send on"}</label>
                <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                  <div className="field field-sm field-filled" style={{ width: "fit-content" }}>
                    <Icon name="calendar" size={14} />
                    <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} style={{ fontSize: 14 }} data-testid="schedule-when" />
                  </div>
                  {presets.map((p) => (
                    <button key={p.label} type="button" className="pill" style={{ height: 26, padding: "0 10px", cursor: "pointer" }} onClick={() => setWhen(toLocalInput(p.at()))}>{p.label}</button>
                  ))}
                </div>
              </div>
              <p className="t-sm muted" style={{ margin: 0 }}>
                {whenDate && whenOk
                  ? (n > 1
                    ? (es
                      ? `Saldrá ${whenLabel(whenDate.toISOString(), lang, true)} a ${chats}, uno tras otro con 10 segundos entre cada chat para que WhatsApp no lo tome como spam.`
                      : `Goes out ${whenLabel(whenDate.toISOString(), lang, true)} to ${chats}, one after another with 10 seconds between chats so WhatsApp doesn't flag it as spam.`)
                    : (es
                      ? `Saldrá ${whenLabel(whenDate.toISOString(), lang, true)} · hasta entonces puedes cancelarlo desde el chat.`
                      : `Goes out ${whenLabel(whenDate.toISOString(), lang, true)} · until then you can cancel it from the chat.`))
                  : (es ? "Elige una fecha y hora que todavía no hayan pasado." : "Pick a date and time that hasn't passed yet.")}
              </p>
            </>
          ) : (
            <p className="t-sm muted" style={{ margin: 0 }}>
              {es
                ? `Se enviará solo, una sola vez, en cuanto ${who} responda. Mientras tanto puedes cancelarlo desde el chat.`
                : `It will be sent on its own, once, as soon as ${who} replies. Until then you can cancel it from the chat.`}
            </p>
          )}
          <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
            <textarea className="bare" rows={4} style={{ width: "100%", fontSize: 14, resize: "vertical" }} autoFocus
              placeholder={es ? "Escribe el mensaje…" : "Write the message…"} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {files.length > 0 && (
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {files.map((f, i) => (
                <span key={i} className="pill" style={{ height: 26, padding: "0 8px", gap: 6, maxWidth: "100%" }}>
                  <Icon name="file" size={13} /><span className="truncate" style={{ maxWidth: 200 }}>{f.name}</span>
                  <button className="iconbtn sm" style={{ width: 18, height: 18 }} onClick={() => setFiles((s) => s.filter((_, j) => j !== i))} disabled={saving}><Icon name="x" size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) setFiles((s) => [...s, ...f]); e.target.value = ""; }} />
          <button className="btn btn-sm btn-outline" style={{ width: "fit-content" }} onClick={() => fileRef.current?.click()} disabled={saving}>
            <Icon name="paperclip" size={14} />{es ? "Adjuntar archivos" : "Attach files"}
          </button>
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={!ready} onClick={save}>
            <Icon name={schedule ? "calendar" : "clock"} size={15} />
            {saving ? (es ? "Guardando…" : "Saving…")
              : schedule ? (n > 1 ? (es ? `Programar a ${chats}` : `Schedule to ${chats}`) : (es ? "Programar" : "Schedule"))
              : (es ? "Dejar en espera" : "Leave waiting")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dentro de una hora, redondeado a la siguiente media hora: una hora "limpia" por defecto. */
function defaultWhen(): Date { return roundUp(new Date(Date.now() + 60 * 60 * 1000)); }
function roundUp(d: Date): Date {
  const r = new Date(d); r.setSeconds(0, 0);
  const m = r.getMinutes();
  r.setMinutes(m <= 30 ? (m === 0 ? 0 : 30) : 60);
  return r;
}
/** Hora LOCAL del navegador en el formato de <input type="datetime-local"> (sin zona). */
function toLocalInput(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "hoy a las 18:00" · "mañana a las 9:00" · "el lun 17 nov a las 9:00" (con `prose`) o sin "el/a las". */
export function whenLabel(iso: string, lang: "es" | "en", prose = false): string {
  const d = new Date(iso);
  const es = lang === "es";
  const time = d.toLocaleTimeString(es ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" });
  const today = new Date(); const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  let day: string;
  if (d.toDateString() === today.toDateString()) day = es ? "hoy" : "today";
  else if (d.toDateString() === tomorrow.toDateString()) day = es ? "mañana" : "tomorrow";
  else day = (prose && es ? "el " : "") + d.toLocaleDateString(es ? "es-MX" : "en-US", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
  if (!prose) return `${day.charAt(0).toUpperCase() + day.slice(1)} · ${time}`;
  return es ? `${day} a las ${time}` : `${day} at ${time}`;
}
