"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { uploadMedia } from "@/lib/uploadMedia";
import { mediaTypeOf } from "@/lib/mediaUpload";
import { queueFollowUp } from "@/app/(app)/chat/actions";

/**
 * "Mensaje en espera": con la ventana de 24 h cerrada, el agente deja aquí lo que quiere decirle
 * al cliente (texto y archivos). Sale solo, una vez, en cuanto el cliente responda —- a la
 * plantilla o a lo que sea. Solo existe en el chat de clientes: el de equipo no tiene ventana.
 */
export function FollowUpModal({ convId, businessId, onClose, onSaved }: { convId: string; businessId: string; onClose: () => void; onSaved: () => void }) {
  const { lang, personal } = useApp();
  const es = lang === "es";
  const who = personal ? (es ? "el contacto" : "the contact") : (es ? "el cliente" : "the customer");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = (text.trim() || files.length > 0) && !saving;

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
      const r = await queueFollowUp(convId, items);
      if (!r.ok) {
        setErr(r.error === "migration-0095"
          ? (es ? "Falta aplicar la migración 0095 en la base." : "Migration 0095 has not been applied yet.")
          : (es ? "No se pudo guardar el mensaje." : "Couldn't save the message."));
        return;
      }
      onSaved(); onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : (es ? "No se pudo subir el archivo." : "Couldn't upload the file."));
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={saving ? undefined : onClose} />
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="clock" size={18} /></span>
          <h3 className="grow">{es ? "Mensaje en espera" : "Waiting message"}</h3>
          <button className="iconbtn" onClick={onClose} disabled={saving}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          <p className="t-sm muted" style={{ margin: 0 }}>
            {es
              ? `Se enviará solo, una sola vez, en cuanto ${who} responda. Mientras tanto puedes cancelarlo desde el chat.`
              : `It will be sent on its own, once, as soon as ${who} replies. Until then you can cancel it from the chat.`}
          </p>
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
            <Icon name="clock" size={15} />{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Dejar en espera" : "Leave waiting")}
          </button>
        </div>
      </div>
    </div>
  );
}
