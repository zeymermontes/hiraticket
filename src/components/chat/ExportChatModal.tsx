"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { exportChat, type ExportMsg } from "@/lib/chatExport";

/**
 * "Exportar chat": resumen del tramo elegido (cuántos mensajes, cuántos archivos), la opción de
 * incluir o no la multimedia, y el botón que baja el .zip (o el .md si no hay archivos).
 *
 * Lo comparten el chat de clientes y el de equipo (skill chat-parity): cada uno le pasa `load`,
 * que trae el tramo ya traducido a `ExportMsg`, y el encabezado que va arriba de la transcripción.
 */
export function ExportChatModal({ lang, title, header, fileBase, load, onClose }: {
  lang: "es" | "en";
  title: string;
  header: { label: string; value: string }[];
  fileBase: string;
  load: () => Promise<ExportMsg[]>;
  onClose: () => void;
}) {
  const es = lang === "es";
  const { push } = useToast();
  const [msgs, setMsgs] = useState<ExportMsg[] | null>(null);
  const [error, setError] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    load().then((m) => { if (alive) setMsgs(m); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const media = (msgs ?? []).filter((m) => m.media && !m.deleted);
  const bytes = media.reduce((n, m) => n + (m.media?.size ?? 0), 0);
  const unknownSize = media.some((m) => m.media?.size == null);
  const sizeLabel = bytes ? `${unknownSize ? "≥ " : "~"}${bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"}` : null;
  const busy = progress !== null;

  async function run() {
    if (!msgs || busy) return;
    setProgress({ done: 0, total: includeMedia ? media.length : 0 });
    try {
      const r = await exportChat({ lang, title, header, msgs, includeMedia, fileBase, onProgress: (done, total) => setProgress({ done, total }) });
      push({
        kind: r.failed ? "warn" : "success",
        title: es ? "Chat exportado" : "Chat exported",
        message: r.failed
          ? (es ? `${r.files} archivo(s) incluidos; ${r.failed} no se pudieron descargar.` : `${r.files} file(s) included; ${r.failed} could not be downloaded.`)
          : (r.zipped ? (es ? `${r.messages} mensajes y ${r.files} archivo(s) en un .zip.` : `${r.messages} messages and ${r.files} file(s) in a .zip.`) : (es ? `${r.messages} mensajes en un .md.` : `${r.messages} messages in a .md.`)),
      });
      onClose();
    } catch {
      setProgress(null);
      push({ kind: "warn", message: es ? "No se pudo exportar el chat." : "Couldn't export the chat." });
    }
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="download" size={18} /></span>
          <h3 className="grow">{es ? "Exportar chat" : "Export chat"}</h3>
          <button className="iconbtn" onClick={onClose} disabled={busy}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          <div className="t-sm muted">{title}</div>
          {error ? (
            <div className="t-sm" style={{ color: "var(--red)" }}>{es ? "No se pudieron cargar los mensajes del tramo." : "Couldn't load the messages in that range."}</div>
          ) : !msgs ? (
            <div className="t-sm muted">{es ? "Contando mensajes…" : "Counting messages…"}</div>
          ) : (
            <>
              <div className="row gap-2" style={{ padding: 12, borderRadius: 10, background: "var(--surface-2)", alignItems: "flex-start" }}>
                <Icon name="chat" size={18} />
                <div className="col gap-1 t-sm" style={{ minWidth: 0 }}>
                  <div><b>{msgs.length}</b> {es ? "mensajes" : "messages"}</div>
                  <div className="muted">{media.length
                    ? (es ? `${media.length} archivo(s) adjunto(s)` : `${media.length} attached file(s)`) + (sizeLabel ? ` · ${sizeLabel}` : "")
                    : (es ? "Sin archivos adjuntos" : "No attached files")}</div>
                </div>
              </div>
              {media.length > 0 && (
                <label className="row gap-2" style={{ alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} disabled={busy} style={{ marginTop: 3 }} />
                  <span className="t-sm">
                    <b>{es ? "Incluir multimedia" : "Include media"}</b>
                    <div className="muted t-xs">{es ? "Fotos, audios, videos y documentos van en una carpeta media/ dentro del .zip, citados desde la transcripción." : "Photos, audio, video and documents go in a media/ folder inside the .zip, referenced from the transcript."}</div>
                  </span>
                </label>
              )}
              <div className="t-xs muted">{es
                ? "La transcripción es un archivo chat.md: una línea por mensaje con fecha, remitente y texto. Listo para pegarlo o adjuntarlo como contexto a una IA."
                : "The transcript is a chat.md file: one line per message with date, sender and text. Ready to paste or attach as context for an AI."}</div>
              {busy && progress && progress.total > 0 && (
                <div className="col gap-1">
                  <div className="t-xs muted">{es ? `Descargando archivos… ${progress.done}/${progress.total}` : `Downloading files… ${progress.done}/${progress.total}`}</div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((progress.done / progress.total) * 100)}%`, background: "var(--brand)", transition: "width .2s" }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={!msgs || !msgs.length || busy} onClick={run}>
            <Icon name="download" size={15} />{busy ? (es ? "Exportando…" : "Exporting…") : (es ? "Descargar" : "Download")}
          </button>
        </div>
      </div>
    </div>
  );
}
