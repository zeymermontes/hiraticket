"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { getWaTemplates, sendWaTemplate, type WaTemplateOption } from "@/app/(app)/chat/actions";
import { WaTemplatePreview } from "@/components/WaTemplatePreview";

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
  onSent: (renderedBody: string, meta: Record<string, unknown>) => void;
}) {
  const { lang } = useApp();
  const [templates, setTemplates] = useState<WaTemplateOption[] | null>(null);
  const [picked, setPicked] = useState<WaTemplateOption | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerParam, setHeaderParam] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getWaTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const preview = useMemo(() => {
    if (!picked) return "";
    return picked.body.replace(VAR_RE, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
  }, [picked, params]);

  const previewHeader = picked?.header ? picked.header.replace(VAR_RE, (_, n) => headerParam || `{{${n}}}`) : null;

  const ready =
    picked &&
    !picked.blocked &&
    (!picked.headerVar || headerParam.trim()) &&
    (picked.varCount === 0 || params.slice(0, picked.varCount).every((p) => p?.trim()));

  async function send() {
    if (!picked || sending) return;
    setSending(true);
    setErr(null);
    const res = await sendWaTemplate(
      convId,
      { name: picked.name, language: picked.language, body: picked.body, header: picked.header, footer: picked.footer, buttons: picked.buttons },
      params.slice(0, picked.varCount).map((p) => p.trim()),
      picked.headerVar ? headerParam.trim() : "",
    );
    setSending(false);
    if (res.ok) {
      onSent(preview, { template: { name: picked.name, lang: picked.language, params: params.slice(0, picked.varCount), header: previewHeader, footer: picked.footer, buttons: picked.buttons } });
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
                    ? "No hay plantillas aprobadas todavía. Créalas en Plantillas → Plantillas oficiales de WhatsApp (Meta tarda en aprobarlas)."
                    : "No approved templates yet. Create them in Templates → Official WhatsApp templates (Meta takes a while to approve)."}
                </div>
              )}
              {(templates ?? []).map((t) => (
                <button key={t.name + t.language} className="col gap-1" style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 10, background: "var(--surface)", cursor: "pointer" }}
                  onClick={() => { setPicked(t); setParams(Array(t.varCount).fill("")); setHeaderParam(""); setErr(null); }}>
                  <div className="row gap-2"><strong className="mono t-sm">{t.name}</strong><span className="muted t-xs">{t.language}</span></div>
                  <WaTemplatePreview header={t.header} mediaHeader={t.mediaHeader} body={t.body} footer={t.footer} buttons={t.buttons} />
                </button>
              ))}
            </>
          )}
          {picked && (
            <>
              <button className="btn btn-sm btn-outline" style={{ width: "fit-content" }} onClick={() => setPicked(null)}>
                <Icon name="swap" size={14} />{lang === "es" ? "Otra plantilla" : "Another template"}
              </button>
              {picked.blocked && (
                <div className="t-xs" style={{ color: "var(--amber, #d97706)" }}>
                  {picked.blocked === "media-header"
                    ? (lang === "es"
                      ? "Esta plantilla lleva una imagen, video o documento en el encabezado, y todavía no se puede mandar desde Hiraticket."
                      : "This template has an image, video or document header, which can't be sent from Hiraticket yet.")
                    : (lang === "es"
                      ? "Esta plantilla tiene un botón que pide un dato en cada envío (enlace con variable, código o flujo), y todavía no se puede mandar desde Hiraticket."
                      : "This template has a button that needs a value on every send (link with a variable, code or flow), which can't be sent from Hiraticket yet.")}
                </div>
              )}
              {picked.headerVar && (
                <div className="field field-filled">
                  <span className="t-xs muted">{lang === "es" ? "Encabezado" : "Header"}</span>
                  <input value={headerParam} autoFocus
                    placeholder={lang === "es" ? "Valor de la variable del encabezado" : "Value for the header variable"}
                    onChange={(e) => setHeaderParam(e.target.value)} />
                </div>
              )}
              {Array.from({ length: picked.varCount }, (_, i) => (
                <div key={i} className="field field-filled">
                  <span className="mono t-xs muted">{`{{${i + 1}}}`}</span>
                  <input value={params[i] ?? ""} autoFocus={i === 0 && !picked.headerVar}
                    placeholder={lang === "es" ? `Valor de la variable ${i + 1}` : `Value for variable ${i + 1}`}
                    onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n; })} />
                </div>
              ))}
              <WaTemplatePreview header={previewHeader} mediaHeader={picked.mediaHeader} body={preview} footer={picked.footer} buttons={picked.buttons} />
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
