"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { getWaTemplates, sendWaTemplate, type WaTemplateOption } from "@/app/(app)/chat/actions";

// Picker de plantillas aprobadas de Meta para cuando la ventana de 24 h está cerrada (API oficial).
// Elegir → rellenar variables ({{1}}…{{n}}) con vista previa → enviar. El envío real lo hace
// cloud-outbox como template; aquí solo se arma la selección.

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

export function WaTemplateModal({
  convId,
  onClose,
  onSent,
}: {
  convId: string;
  onClose: () => void;
  onSent: (renderedBody: string) => void;
}) {
  const { lang } = useApp();
  const [templates, setTemplates] = useState<WaTemplateOption[] | null>(null);
  const [picked, setPicked] = useState<WaTemplateOption | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getWaTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const preview = useMemo(() => {
    if (!picked) return "";
    return picked.body.replace(VAR_RE, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
  }, [picked, params]);

  const ready = picked && (picked.varCount === 0 || params.slice(0, picked.varCount).every((p) => p?.trim()));

  async function send() {
    if (!picked || sending) return;
    setSending(true);
    setErr(null);
    const res = await sendWaTemplate(
      convId,
      { name: picked.name, language: picked.language, body: picked.body },
      params.slice(0, picked.varCount).map((p) => p.trim()),
    );
    setSending(false);
    if (res.ok) {
      onSent(preview);
      onClose();
    } else {
      setErr(res.error ?? (lang === "es" ? "No se pudo enviar." : "Could not send."));
    }
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h3 className="grow">{lang === "es" ? "Enviar plantilla" : "Send template"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3" style={{ maxHeight: 420, overflowY: "auto" }}>
          {!picked && (
            <>
              {templates === null && <div className="muted t-sm">{lang === "es" ? "Cargando plantillas…" : "Loading templates…"}</div>}
              {templates !== null && templates.length === 0 && (
                <div className="muted t-sm">
                  {lang === "es"
                    ? "No hay plantillas aprobadas todavía. Créalas en Ajustes → Plantillas de WhatsApp (Meta tarda en aprobarlas)."
                    : "No approved templates yet. Create them in Settings → WhatsApp templates (Meta takes a while to approve)."}
                </div>
              )}
              {(templates ?? []).map((t) => (
                <button key={t.name + t.language} className="col gap-1" style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 10, background: "var(--surface)", cursor: "pointer" }}
                  onClick={() => { setPicked(t); setParams(Array(t.varCount).fill("")); }}>
                  <div className="row gap-2"><strong className="mono t-sm">{t.name}</strong><span className="muted t-xs">{t.language}</span></div>
                  <div className="muted t-xs" style={{ whiteSpace: "pre-wrap" }}>{t.body.slice(0, 140)}</div>
                </button>
              ))}
            </>
          )}
          {picked && (
            <>
              <button className="btn btn-sm btn-outline" style={{ width: "fit-content" }} onClick={() => setPicked(null)}>
                <Icon name="swap" size={14} />{lang === "es" ? "Otra plantilla" : "Another template"}
              </button>
              {Array.from({ length: picked.varCount }, (_, i) => (
                <div key={i} className="field field-filled">
                  <span className="mono t-xs muted">{`{{${i + 1}}}`}</span>
                  <input value={params[i] ?? ""} autoFocus={i === 0}
                    placeholder={lang === "es" ? `Valor de la variable ${i + 1}` : `Value for variable ${i + 1}`}
                    onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
                </div>
              ))}
              <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 10, background: "var(--surface-2)", whiteSpace: "pre-wrap", fontSize: 13 }}>
                {picked.header && <div style={{ fontWeight: 700, marginBottom: 4 }}>{picked.header}</div>}
                {preview}
                {picked.footer && <div className="muted t-xs" style={{ marginTop: 4 }}>{picked.footer}</div>}
              </div>
            </>
          )}
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={!ready || sending} onClick={send}>
            <Icon name="send" size={15} />{sending ? (lang === "es" ? "Enviando…" : "Sending…") : (lang === "es" ? "Enviar" : "Send")}
          </button>
        </div>
      </div>
    </div>
  );
}
