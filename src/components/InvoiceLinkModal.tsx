"use client";
import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import { sendInvoiceLink, type LinkResult } from "@/app/(app)/invoicing/actions";
import { InvoiceSummaryView, useInvoicePreview, satIncomplete } from "@/components/InvoiceSummary";

// Antes de mandar el link para que el cliente se facture: qué va a decir esa factura (conceptos,
// impuestos y total) y, si a algún concepto le faltan la clave o la unidad del SAT, se piden aquí.
// El link se crea con lo que se ve en esta ventana.

export function InvoiceLinkModal({ orderId, hasChat, lang, errText, onClose, onDone }: {
  orderId: string;
  /** El pedido tiene chat: el link se manda por ahí. Sin chat solo se crea, para copiarlo. */
  hasChat: boolean;
  lang: "es" | "en";
  /** Texto para un fallo, con las mismas palabras que usa el pedido. */
  errText: (code?: string, error?: string) => string;
  onClose: () => void;
  onDone: (r: LinkResult) => void;
}) {
  const es = lang === "es";
  const { preview, missing, sat, patch } = useInvoicePreview(orderId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    // El aviso de que la factura lleva IVA de más está a la vista en el resumen: mandar es aceptarlo.
    const r = await sendInvoiceLink(orderId, { confirmTax: true, sat });
    setBusy(false);
    if (!r.ok) { setErr(errText(r.code, r.error)); return; }
    onDone(r);
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 600 }}>
        <div className="modal-head">
          <span className="t-ic" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-50)", color: "var(--brand-700)" }}><Icon name="file" /></span>
          <h3 className="grow">{es ? "Link para facturar" : "Invoicing link"}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-2">
          <div className="t-sm muted">
            {es
              ? "El cliente abre el link, captura su RFC y recibe su factura. Esto es lo que dirá:"
              : "The customer opens the link, enters their tax ID and gets the invoice. This is what it will say:"}
          </div>
          {!preview ? <span className="t-sm muted">…</span>
            : preview.error === "order" ? <div className="t-xs" style={{ color: "var(--red)" }}>{es ? "No se pudo leer el pedido." : "Couldn't read the order."}</div>
            : <InvoiceSummaryView preview={preview} missing={missing} sat={sat} onSat={patch} lang={lang} search />}
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy || !preview?.ok || satIncomplete(sat)} onClick={submit}>
            <Icon name={hasChat ? "send" : "file"} size={14} />
            {busy ? (es ? "Creando…" : "Creating…") : hasChat ? (es ? "Enviar link al cliente" : "Send link to customer") : (es ? "Crear link" : "Create link")}
          </button>
        </div>
      </div>
    </div>
  );
}
