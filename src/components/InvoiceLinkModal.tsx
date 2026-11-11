"use client";
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { sendInvoiceLink, type LinkResult } from "@/app/(app)/invoicing/actions";
import { InvoiceSummaryView, InvoiceKindPicker, useInvoicePreview, satIncomplete, groupIncomplete, suggestedAdvance } from "@/components/InvoiceSummary";
import type { KindChoice } from "@/lib/invoiceKinds";

// Antes de mandar el link para que el cliente se facture: qué va a decir esa factura (conceptos,
// impuestos y total) y, si a algún concepto le faltan la clave o la unidad del SAT, se piden aquí.
// El link se crea con lo que se ve en esta ventana.
//
// Por el link se factura el total del pedido o un anticipo por un monto. El finiquito y la PPD se
// emiten desde «Emitir factura»: uno relaciona folios y la otra recibe complementos de pago, y
// nada de eso lo puede hacer el cliente desde la liga.

export function InvoiceLinkModal({ orderId, hasChat, lang, errText, openCode = null, openUntil = null, onClose, onDone }: {
  orderId: string;
  /** El pedido ya tiene un link abierto con este código: se reenvía, o se cambia por uno nuevo si
   *  aquí se capturan datos o si ya no dice lo mismo que el pedido. */
  openCode?: string | null;
  /** Hasta cuándo sirve ese link abierto (YYYY-MM-DD), para partir de ahí al cambiarle la fecha. */
  openUntil?: string | null;
  /** El pedido tiene chat: el link se manda por ahí. Sin chat solo se crea, para copiarlo. */
  hasChat: boolean;
  lang: "es" | "en";
  /** Texto para un fallo, con las mismas palabras que usa el pedido. */
  errText: (code?: string, error?: string) => string;
  onClose: () => void;
  onDone: (r: LinkResult) => void;
}) {
  const es = lang === "es";
  const [choice, setChoice] = useState<KindChoice>({ kind: "total" });
  const touched = useRef(false);
  const pick = (c: KindChoice) => { touched.current = true; setChoice(c); };
  const { preview, missing, sat, patch, group, setGroup, groupChoice, saveDefault, setSaveDefault } = useInvoicePreview(orderId, choice);
  // Con anticipos ya facturados, el link solo puede ser de otro anticipo.
  useEffect(() => {
    if (touched.current || !preview) return;
    if (preview.anticipos.count > 0 && choice.kind !== "anticipo") setChoice({ kind: "anticipo", amount: suggestedAdvance(preview) });
  }, [preview, choice.kind]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Algo cambió aquí (datos del SAT, cómo se agrupa, qué factura es): el link se va a poner al día, no solo a reenviar.
  const captured = Object.values(sat).some((v) => !!v.code || !!v.unit) || group !== null || touched.current;
  // Hasta cuándo se puede facturar con el link. Empieza con los días del plugin; se puede cambiar
  // para este link. Con uno ya abierto se parte de su fecha actual.
  const [until, setUntil] = useState("");
  useEffect(() => { if (!until && preview?.linkUntil) setUntil(openUntil ?? preview.linkUntil); }, [preview?.linkUntil, openUntil, until]);
  const today = new Date().toISOString().slice(0, 10);
  const maxDay = new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10);
  const untilOk = !until || (until >= today && until <= maxDay);
  const untilChanged = !!openCode && !!until && until !== (openUntil ?? "");
  const advance = choice.kind === "anticipo";
  const advanceBad = advance && (!((choice.amount ?? 0) > 0) || (!!preview && (choice.amount ?? 0) > preview.orderTotal - preview.anticipos.total + 0.005));

  const submit = async () => {
    setBusy(true); setErr(null);
    // El aviso de que la factura lleva IVA de más está a la vista en el resumen: mandar es aceptarlo.
    const r = await sendInvoiceLink(orderId, { confirmTax: true, sat, until: until || null, group: groupChoice, saveGroupAsDefault: saveDefault, choice });
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
            {advance
              ? (es ? "El cliente abre el link, captura su RFC y recibe la factura de su anticipo. Esto es lo que dirá:" : "The customer opens the link, enters their tax ID and gets the invoice for their advance. This is what it will say:")
              : (es ? "El cliente abre el link, captura su RFC y recibe su factura. Esto es lo que dirá:" : "The customer opens the link, enters their tax ID and gets the invoice. This is what it will say:")}
          </div>
          <InvoiceKindPicker choice={choice} onChange={pick} preview={preview} lang={lang} allow={["total", "anticipo"]} />
          {!!preview && preview.anticipos.count > 0 && (
            <div className="t-xs muted">{es ? "El finiquito (el resto del pedido, relacionando los anticipos) se emite desde «Emitir factura», no por link." : "The final invoice (the rest of the order, relating the advances) is issued from \"Issue invoice\", not by link."}</div>
          )}
          {openCode && (
            <div className="t-xs muted" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              {es
                ? `Este pedido ya tiene un link (${openCode}). Si capturas datos aquí, o el pedido cambió desde que se creó, ese mismo link se pone al día: la liga que ya tiene el cliente sigue sirviendo. Si nada cambió, se reenvía tal cual.`
                : `This order already has a link (${openCode}). If you enter data here, or the order changed since it was created, that same link is updated: the link the customer already has keeps working. If nothing changed, it's sent again as is.`}
            </div>
          )}
          {!preview ? <span className="t-sm muted">…</span>
            : preview.error === "order" ? <div className="t-xs" style={{ color: "var(--red)" }}>{es ? "No se pudo leer el pedido." : "Couldn't read the order."}</div>
            : <InvoiceSummaryView preview={preview} missing={missing} sat={sat} onSat={patch} lang={lang} search onGroup={advance ? undefined : setGroup} saveDefault={saveDefault} onSaveDefault={setSaveDefault} />}
          {preview?.ok && (
            <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <label className="lbl" style={{ margin: 0 }}>{es ? "El cliente puede facturarse hasta el" : "The customer can invoice until"}</label>
              <input className="inp-inline" type="date" min={today} max={maxDay} value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 160, borderColor: untilOk ? undefined : "var(--red)" }} />
              <span className="t-xs muted">
                {untilChanged
                  ? (es ? "Se le cambia la fecha al link abierto." : "The open link gets the new date.")
                  : (es ? "Después se puede cambiar desde el pedido." : "You can change it later from the order.")}
              </span>
            </div>
          )}
          {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{es ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={busy || !preview?.ok || advanceBad || satIncomplete(sat) || groupIncomplete(preview) || !untilOk} onClick={submit}>
            <Icon name={hasChat ? "send" : "file"} size={14} />
            {busy ? (es ? "Enviando…" : "Sending…")
              : openCode && !captured ? (hasChat ? (es ? "Reenviar link" : "Resend link") : (es ? "Copiar link" : "Copy link"))
              : openCode ? (hasChat ? (es ? "Actualizar y reenviar" : "Update and resend") : (es ? "Actualizar link" : "Update link"))
              : advance ? (hasChat ? (es ? "Enviar link del anticipo" : "Send advance link") : (es ? "Crear link del anticipo" : "Create advance link"))
              : hasChat ? (es ? "Enviar link al cliente" : "Send link to customer") : (es ? "Crear link" : "Create link")}
          </button>
        </div>
      </div>
    </div>
  );
}
