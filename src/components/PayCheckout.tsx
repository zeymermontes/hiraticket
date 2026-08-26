"use client";
import React, { useState, useRef, useEffect } from "react";
import { Icon } from "@/components/Icon";
import type { Branch, BankAccount, PayPromoPlacement } from "@/lib/types";
import { DAY_ORDER, DAY_LABEL, normalizeHours } from "@/lib/hours";
import { submitPaymentProof, startCardPayment } from "@/app/pay/actions";

const money = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MXN";
/** Sin "MXN": dentro del desglose la moneda ya se dijo arriba y repetirla lo vuelve ilegible. */
const amount = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Method = "branch" | "transfer" | "card";

/** Un renglón del pedido tal como lo ve el cliente. A propósito NO trae costo, margen ni la nota
 *  interna del renglón —- y las mermas ni siquiera viven en esta tabla (0074, `order_waste`). */
export type PayItem = { id: string; name: string; qty: number; unitPrice: number; subtotal: number };

/** Un renglón del estado de cuenta: una orden de cobro del pedido (0089), ya sin las anuladas. */
export type PayCharge = {
  id: string; seq: number; title: string; amount: number; paid: number;
  status: string; dueAt: string | null;
  /** true = es el cobro que este link está pidiendo. Es lo que deja marcarlo en la lista. */
  current: boolean;
};

export function PayCheckout({
  token, businessName, contactName, code, total, balance, payStatus,
  orderBalance, paid: paidTotal, charges, chargeTitle, chargeSeq, chargeCount, chargeSettled,
  branchEnabled, transferEnabled, cardEnabled, branches, accounts, hasPending, mpResult,
  items, discount, discountPct, discountNote, taxRate, promoUrl, promoPlacement,
}: {
  token: string;
  businessName: string;
  contactName: string | null;
  code: string;
  total: number;
  /** Lo que ESTE link pide: el monto del cobro, o el saldo entero si es el link del pedido. */
  balance: number;
  payStatus: string;
  /** Lo que le falta al pedido COMPLETO. Distinto de `balance` cuando esto es un cobro parcial. */
  orderBalance?: number;
  /** Lo que el cliente lleva pagado del pedido. */
  paid?: number;
  charges?: PayCharge[];
  /** Concepto del cobro que se está viendo ("Anticipo"); null = es el link del pedido. */
  chargeTitle?: string | null;
  chargeSeq?: number | null;
  chargeCount?: number;
  /** Este cobro en concreto ya está cubierto (aunque al pedido le falte). */
  chargeSettled?: boolean;
  branchEnabled: boolean;
  transferEnabled: boolean;
  cardEnabled: boolean;
  branches: Branch[];
  accounts: BankAccount[];
  hasPending: boolean;
  mpResult?: "success" | "pending" | "failure" | null;
  items: PayItem[];
  discount: number;
  discountPct: number | null;
  discountNote: string | null;
  taxRate: number; // % de IVA congelado en el pedido; 0 = no lleva
  promoUrl: string | null;
  promoPlacement: PayPromoPlacement;
}) {
  const orderPaid = payStatus === "paid";
  // "Ya no hay nada que hacer aquí" es del COBRO, no del pedido: un anticipo cubierto cierra esta
  // página aunque al pedido le falten dos pagos más.
  const settled = orderPaid || !!chargeSettled;
  const list = charges ?? [];
  const already = paidTotal ?? 0;
  const left = orderBalance ?? Math.max(0, total - already);
  /**
   * El estado de cuenta solo aparece cuando hay algo que contar: más de un cobro, o dinero ya
   * abonado. Con un pago único sería repetir el total con otras palabras —- ruido en la única
   * pantalla donde el cliente tiene que entender de un vistazo cuánto y por qué.
   */
  const showStatement = list.length > 1 || already > 0;
  const promo = promoUrl && promoPlacement !== "off" ? promoUrl : null;
  const [showPromo, setShowPromo] = useState(promoPlacement === "popup" && !!promo);
  const methods = ([
    branchEnabled ? "branch" : null,
    transferEnabled ? "transfer" : null,
    cardEnabled ? "card" : null,
  ].filter(Boolean) as Method[]);
  const [method, setMethod] = useState<Method | null>(methods.length === 1 ? methods[0] : null);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {/* header */}
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--brand)" }}>{businessName}</div>
          <div className="muted t-sm">
            Pedido {code}
            {/* "Pago 2 de 3" solo si de verdad hay varios: en un cobro suelto diría "1 de 1". */}
            {chargeSeq != null && (chargeCount ?? 0) > 1 && <> · Pago {chargeSeq} de {chargeCount}</>}
          </div>
        </div>

        {/* amount card */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 18px", textAlign: "center", marginBottom: 16 }}>
          {contactName && <div className="muted t-sm" style={{ marginBottom: 4 }}>Hola {contactName.split(" ")[0]} 👋</div>}
          <div className="muted t-xs" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
            {chargeTitle ? chargeTitle : balance < total ? "Saldo a pagar" : "Total a pagar"}
          </div>
          <div style={{ fontSize: 34, fontWeight: 900, marginTop: 2 }}>{money(orderPaid ? total : balance)}</div>
          {balance < total && !orderPaid && <div className="muted t-xs" style={{ marginTop: 2 }}>Total del pedido {money(total)}</div>}
        </div>

        {showStatement && <Statement charges={list} total={total} paid={already} left={left} />}

        <ItemsBreakdown items={items} total={total} discount={discount} discountPct={discountPct} discountNote={discountNote} taxRate={taxRate} />

        {settled ? (
          <Banner
            tone="ok" icon="check"
            title={orderPaid ? "Este pedido ya está pagado" : `${chargeTitle ?? "Este cobro"} ya está cubierto`}
            text={orderPaid
              ? "¡Gracias! No necesitas hacer nada más."
              : `¡Gracias! Quedan ${money(left)} del pedido, y te los cobraremos por separado.`}
          />
        ) : (
          <>
            {mpResult === "success" && <Banner tone="ok" icon="check" title="¡Pago recibido!" text="Tu pago con tarjeta fue aprobado. Se está acreditando al pedido — recarga en unos segundos." />}
            {mpResult === "pending" && <Banner tone="info" icon="clock" title="Pago en proceso" text="Tu pago está siendo procesado. Te confirmaremos en cuanto se acredite." />}
            {mpResult === "failure" && <Banner tone="info" icon="x" title="El pago no se completó" text="No se realizó ningún cargo. Puedes intentarlo de nuevo o elegir otro método." />}
            {hasPending && <Banner tone="info" icon="clock" title="Comprobante en revisión" text="Ya recibimos tu comprobante. Lo estamos verificando; te confirmaremos pronto." />}

            {methods.length === 0 ? (
              <Banner tone="info" icon="orders" title="Pago no disponible" text="Contacta a la empresa por WhatsApp para coordinar tu pago." />
            ) : (
              <>
                <div className="t-sm" style={{ fontWeight: 700, margin: "4px 2px 8px" }}>Elige cómo pagar</div>
                <div className="col gap-2">
                  {branchEnabled && <MethodRow active={method === "branch"} onClick={() => setMethod("branch")} icon="store" title="Pagar en sucursal" sub="Paga en persona en una de nuestras ubicaciones" />}
                  {transferEnabled && <MethodRow active={method === "transfer"} onClick={() => setMethod("transfer")} icon="orders" title="Transferencia" sub="Transfiere y sube tu comprobante" />}
                  {cardEnabled
                    ? <MethodRow active={method === "card"} onClick={() => setMethod("card")} icon="orders" title="Tarjeta" sub="Débito, crédito o meses sin intereses (MercadoPago)" />
                    : <MethodRow active={false} disabled icon="orders" title="Tarjeta" sub="Próximamente" />}
                </div>

                <div style={{ marginTop: 14 }}>
                  {method === "branch" && <BranchPanel branches={branches} />}
                  {method === "transfer" && <TransferPanel token={token} accounts={accounts} balance={balance} alreadyPending={hasPending} />}
                  {method === "card" && <CardPanel token={token} balance={balance} />}
                </div>
              </>
            )}
          </>
        )}

        {promo && promoPlacement === "below" && (
          <div style={{ marginTop: 18, borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={promo} alt="" style={{ display: "block", width: "100%", height: "auto" }} />
          </div>
        )}

        <div className="muted t-xs" style={{ textAlign: "center", marginTop: 24 }}>Pago seguro · Hiraticket</div>
      </div>

      {promo && showPromo && <PromoPopup url={promo} onClose={() => setShowPromo(false)} />}
    </div>
  );
}

/** Desglose del pedido. El Total siempre es el del pedido (la cifra que se cobra); el IVA se deriva
 *  de esa cifra —- igual que en el drawer interno —- para que las líneas siempre sumen exacto aunque
 *  algún ajuste viejo no cuadre al centavo. Subtotal y descuento solo salen si hay algo que explicar. */
/**
 * Estado de cuenta: lo que ya se pagó y lo que falta.
 *
 * Es la mitad del problema que resuelven las órdenes de cobro. Sin esto, quien dio un anticipo
 * abría el link de su parcialidad y veía un número suelto —- ni de dónde salía, ni cuánto llevaba,
 * ni cuánto faltaba después—, y la siguiente pregunta llegaba por WhatsApp cinco minutos más tarde.
 *
 * Se pinta solo cuando hay más de un cobro o ya hay dinero abonado; con un pago único sería el
 * total dicho dos veces.
 */
function Statement({ charges, total, paid, left }: { charges: PayCharge[]; total: number; paid: number; left: number }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "14px 16px", marginBottom: 16 }}>
      <div className="t-sm" style={{ fontWeight: 700, marginBottom: 10 }}>Estado de cuenta</div>

      <div style={{ display: "flex", gap: 10, marginBottom: charges.length ? 10 : 0 }}>
        <span className="grow t-sm muted">Total del pedido</span>
        <span className="mono t-sm">{amount(total)}</span>
      </div>

      {charges.length > 0 && (
        <div className="col" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          {charges.map((c) => {
            const done = c.status === "paid" || c.paid >= c.amount - 0.01;
            return (
              <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span className="grow t-sm" style={{ minWidth: 0 }}>
                  {/* El cobro que este link está pidiendo va en negritas: en una lista de tres,
                      saber "cuál de estos es el que me acaban de mandar" es la primera pregunta. */}
                  <span style={{ fontWeight: c.current ? 700 : 400 }}>{c.title}</span>
                  {c.dueAt && <span className="muted t-xs"> · {new Date(c.dueAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>}
                  {c.current && <span className="muted t-xs"> · este cobro</span>}
                </span>
                <span className="mono t-sm" style={{ flex: "none", textDecoration: done ? "none" : undefined, color: done ? "var(--green)" : undefined }}>
                  {amount(c.amount)}
                </span>
                <span className="t-xs" style={{ flex: "none", width: 62, textAlign: "right", color: done ? "var(--green)" : "var(--muted)" }}>
                  {done ? "pagado" : "pendiente"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <span className="grow t-sm muted">Pagado</span>
          <span className="mono t-sm" style={{ color: "var(--green)" }}>-{amount(paid)}</span>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <span className="grow t-sm" style={{ fontWeight: 700 }}>Falta por pagar</span>
          <span className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{amount(left)}</span>
        </div>
      </div>
    </div>
  );
}

function ItemsBreakdown({ items, total, discount, discountPct, discountNote, taxRate }: {
  items: PayItem[]; total: number; discount: number; discountPct: number | null; discountNote: string | null; taxRate: number;
}) {
  if (items.length === 0) return null;
  const base = items.reduce((s, it) => s + it.subtotal, 0);
  const disc = Math.min(base, Math.max(0, discount || 0));
  const tax = taxRate > 0 ? Math.max(0, total - (base - disc)) : 0;
  const showSummary = taxRate > 0 || disc > 0;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "14px 16px", marginBottom: 16 }}>
      <div className="t-xs muted" style={{ textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Detalle del pedido</div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: 13.5, wordBreak: "break-word" }}>{it.name}</span>
              {it.qty !== 1 && <span className="t-xs muted">{it.qty} × {amount(it.unitPrice)}</span>}
            </span>
            <span className="mono" style={{ fontSize: 13.5, flex: "none" }}>{amount(it.subtotal)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
        {showSummary && (
          <div style={{ display: "flex", gap: 10 }}><span className="grow t-sm muted">Subtotal</span><span className="mono t-sm">{amount(base)}</span></div>
        )}
        {disc > 0 && (
          <div style={{ display: "flex", gap: 10 }}>
            <span className="grow t-sm" style={{ color: "var(--green)" }}>Descuento{discountPct != null ? ` ${discountPct}%` : ""}{discountNote ? ` — ${discountNote}` : ""}</span>
            <span className="mono t-sm" style={{ color: "var(--green)" }}>−{amount(disc)}</span>
          </div>
        )}
        {taxRate > 0 && (
          <div style={{ display: "flex", gap: 10 }}><span className="grow t-sm muted">IVA {taxRate}%</span><span className="mono t-sm">{amount(tax)}</span></div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span className="grow" style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
          <span className="mono" style={{ fontWeight: 800, fontSize: 16 }}>{amount(total)}</span>
        </div>
      </div>
    </div>
  );
}

/** Imagen promocional en ventana emergente. Se cierra con la X, tocando fuera o con Escape —- nunca
 *  puede dejar al cliente atorado sin poder pagar. La imagen se limita a la pantalla (nada de
 *  desbordarse en un teléfono): ancho al 100 % del contenedor y alto tope 78dvh. */
function PromoPopup({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "min(520px, 100%)", maxHeight: "90dvh" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" style={{ display: "block", width: "100%", maxHeight: "78dvh", objectFit: "contain", borderRadius: 14 }} />
        <button onClick={onClose} aria-label="Cerrar"
          style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, borderRadius: 999, border: "none", cursor: "pointer",
            background: "rgba(0,0,0,.6)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={17} />
        </button>
      </div>
    </div>
  );
}

function MethodRow({ active, disabled, icon, title, sub, onClick }: { active: boolean; disabled?: boolean; icon: string; title: string; sub: string; onClick?: () => void }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", borderRadius: 12, textAlign: "left", width: "100%", cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1, background: active ? "var(--brand-50)" : "var(--surface)", border: "2px solid " + (active ? "var(--brand)" : "var(--border)") }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={icon} size={18} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span className="t-xs muted">{sub}</span>
      </span>
      {!disabled && <Icon name={active ? "check" : "arrowr"} size={16} />}
    </button>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} };
  return (
    <div className="row gap-2" style={{ alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div className="t-xs muted">{label}</div>
        <div className="mono" style={{ fontWeight: 700, fontSize: 14, wordBreak: "break-all" }}>{value}</div>
      </div>
      <button className="btn btn-sm btn-outline" onClick={copy} style={{ flex: "none" }}>{done && <Icon name="check" size={13} />}{done ? "Copiado" : "Copiar"}</button>
    </div>
  );
}

function BranchPanel({ branches }: { branches: Branch[] }) {
  if (branches.length === 0) return <Banner tone="info" icon="store" title="Sin sucursales" text="Contacta a la empresa por WhatsApp para coordinar tu pago en persona." />;
  return (
    <div className="col gap-2">
      {branches.map((b) => (
        <div key={b.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{b.name || "Sucursal"}</div>
          {b.address && <div className="t-sm" style={{ marginTop: 2 }}>{b.address}</div>}
          {Array.isArray(b.hours) && (
            <div className="col" style={{ marginTop: 6, gap: 1 }}>
              {DAY_ORDER.map((wd) => { const d = normalizeHours(b.hours)[wd]; return (
                <div key={wd} className="row t-xs" style={{ gap: 8, color: d.open ? "var(--text-muted)" : "var(--text-faint)" }}>
                  <span style={{ width: 30, fontWeight: 600 }}>{DAY_LABEL[wd].es}</span>
                  <span>{d.open ? `${d.from}–${d.to}` : "Cerrado"}</span>
                </div>
              ); })}
            </div>
          )}
          {b.phone && <div className="t-xs muted" style={{ marginTop: 4 }}>📞 {b.phone}</div>}
          {b.maps_url && <a href={b.maps_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline" style={{ marginTop: 8, display: "inline-flex" }}><Icon name="pin" size={13} />Ver ubicación</a>}
        </div>
      ))}
    </div>
  );
}

function TransferPanel({ token, accounts, balance, alreadyPending }: { token: string; accounts: BankAccount[]; balance: number; alreadyPending: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(balance ? String(balance) : "");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<string>(accounts[0]?.bank ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(alreadyPending);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) { setErr("Sube la foto del comprobante."); return; }
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("file", file);
    if (amount.trim()) fd.set("amount", amount);
    if (note.trim()) fd.set("note", note);
    if (account) fd.set("account_ref", account);
    const r = await submitPaymentProof(fd);
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr(r.error === "too-large" ? "La imagen es muy grande (máx. 10 MB)." : r.error === "bad-type" ? "Sube una imagen o PDF." : "No se pudo enviar. Intenta de nuevo.");
  };

  if (done) return <Banner tone="ok" icon="check" title="¡Comprobante enviado!" text="Lo estamos revisando. Te confirmaremos tu pago pronto. Gracias 🙌" />;

  return (
    <div className="col gap-3">
      {/* accounts */}
      <div className="col gap-2">
        {accounts.length === 0 && <Banner tone="info" icon="orders" title="Sin cuentas" text="Contacta a la empresa por WhatsApp para los datos de pago." />}
        {accounts.map((a) => (
          <div key={a.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px 12px" }}>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.bank || "Banco"}</div>
              {accounts.length > 1 && (
                <label className="t-xs muted" style={{ marginLeft: "auto", display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                  <input type="radio" name="acct" checked={account === a.bank} onChange={() => setAccount(a.bank)} />Usar esta
                </label>
              )}
            </div>
            <div className="t-sm">{a.holder}</div>
            {a.account && <CopyField label="Número de cuenta" value={a.account} />}
            {a.clabe && <CopyField label="CLABE" value={a.clabe} />}
            {a.card && <CopyField label="Tarjeta" value={a.card} />}
            {a.note && <div className="t-xs muted" style={{ marginTop: 4 }}>{a.note}</div>}
          </div>
        ))}
      </div>

      {/* upload receipt */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px" }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Sube tu comprobante</div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }} />
        <button className="btn btn-outline" style={{ width: "100%", justifyContent: "center" }} onClick={() => inputRef.current?.click()}>
          <Icon name={file ? "check" : "paperclip"} size={15} />{file ? file.name.slice(0, 32) : "Elegir foto o PDF"}
        </button>

        <div className="row gap-2" style={{ marginTop: 10 }}>
          <div className="field field-sm field-filled grow"><span className="t-sm muted">$</span><input type="number" min={0} placeholder="Monto pagado" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <textarea className="inp-inline" style={{ marginTop: 8, width: "100%", minHeight: 52, resize: "vertical" }} placeholder="Referencia o nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />

        {err && <div className="t-xs" style={{ color: "var(--red)", marginTop: 8 }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} disabled={busy || !file} onClick={submit}>
          <Icon name="send" size={15} />{busy ? "Enviando…" : "Enviar comprobante"}
        </button>
      </div>
    </div>
  );
}

function CardPanel({ token, balance }: { token: string; balance: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    const r = await startCardPayment(token);
    if (r.ok && r.url) { window.location.href = r.url; return; } // → MercadoPago checkout
    setBusy(false);
    setErr(r.error === "nothing-due" ? "Este pedido ya no tiene saldo pendiente." : r.error === "not-configured" ? "El pago con tarjeta no está disponible por ahora." : "No se pudo iniciar el pago. Intenta de nuevo.");
  };
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 }} className="col gap-2">
      <div className="t-sm">Serás dirigido a <b>MercadoPago</b> para pagar {money(balance)} de forma segura. Al aprobarse, tu pago se acredita automáticamente.</div>
      {err && <div className="t-xs" style={{ color: "var(--red)" }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy} onClick={go}>
        <Icon name="arrowr" size={15} />{busy ? "Abriendo MercadoPago…" : "Pagar con tarjeta"}
      </button>
      <div className="t-xs muted" style={{ textAlign: "center" }}>Procesado por MercadoPago · aceptamos débito, crédito y MSI</div>
    </div>
  );
}

function Banner({ tone, icon, title, text }: { tone: "ok" | "info"; icon: string; title: string; text: string }) {
  const c = tone === "ok" ? "var(--green)" : "var(--brand)";
  return (
    <div style={{ display: "flex", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${c}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
      <span style={{ color: c, flex: "none", marginTop: 1 }}><Icon name={icon} size={18} /></span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        <div className="t-sm muted" style={{ marginTop: 1 }}>{text}</div>
      </div>
    </div>
  );
}
