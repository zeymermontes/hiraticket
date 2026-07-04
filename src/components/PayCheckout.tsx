"use client";
import React, { useState, useRef } from "react";
import { Icon } from "@/components/Icon";
import type { Branch, BankAccount } from "@/lib/types";
import { DAY_ORDER, DAY_LABEL, normalizeHours } from "@/lib/hours";
import { submitPaymentProof } from "@/app/pay/actions";

const money = (n: number) => "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MXN";

type Method = "branch" | "transfer" | "card";

export function PayCheckout({
  token, businessName, contactName, code, total, balance, payStatus,
  branchEnabled, transferEnabled, branches, accounts, hasPending,
}: {
  token: string;
  businessName: string;
  contactName: string | null;
  code: string;
  total: number;
  balance: number;
  payStatus: string;
  branchEnabled: boolean;
  transferEnabled: boolean;
  branches: Branch[];
  accounts: BankAccount[];
  hasPending: boolean;
}) {
  const paid = payStatus === "paid";
  const methods = ([
    branchEnabled ? "branch" : null,
    transferEnabled ? "transfer" : null,
  ].filter(Boolean) as Method[]);
  const [method, setMethod] = useState<Method | null>(methods.length === 1 ? methods[0] : null);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        {/* header */}
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--brand)" }}>{businessName}</div>
          <div className="muted t-sm">Pedido {code}</div>
        </div>

        {/* amount card */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 18px", textAlign: "center", marginBottom: 16 }}>
          {contactName && <div className="muted t-sm" style={{ marginBottom: 4 }}>Hola {contactName.split(" ")[0]} 👋</div>}
          <div className="muted t-xs" style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>{balance < total ? "Saldo a pagar" : "Total a pagar"}</div>
          <div style={{ fontSize: 34, fontWeight: 900, marginTop: 2 }}>{money(paid ? total : balance)}</div>
          {balance < total && !paid && <div className="muted t-xs" style={{ marginTop: 2 }}>Total {money(total)}</div>}
        </div>

        {paid ? (
          <Banner tone="ok" icon="check" title="Este pedido ya está pagado" text="¡Gracias! No necesitas hacer nada más." />
        ) : (
          <>
            {hasPending && <Banner tone="info" icon="clock" title="Comprobante en revisión" text="Ya recibimos tu comprobante. Lo estamos verificando; te confirmaremos pronto." />}

            {methods.length === 0 ? (
              <Banner tone="info" icon="orders" title="Pago no disponible" text="Contacta a la empresa por WhatsApp para coordinar tu pago." />
            ) : (
              <>
                <div className="t-sm" style={{ fontWeight: 700, margin: "4px 2px 8px" }}>Elige cómo pagar</div>
                <div className="col gap-2">
                  {branchEnabled && <MethodRow active={method === "branch"} onClick={() => setMethod("branch")} icon="store" title="Pagar en sucursal" sub="Paga en persona en una de nuestras ubicaciones" />}
                  {transferEnabled && <MethodRow active={method === "transfer"} onClick={() => setMethod("transfer")} icon="orders" title="Transferencia" sub="Transfiere y sube tu comprobante" />}
                  <MethodRow active={false} disabled icon="orders" title="Tarjeta" sub="Próximamente" />
                </div>

                <div style={{ marginTop: 14 }}>
                  {method === "branch" && <BranchPanel branches={branches} />}
                  {method === "transfer" && <TransferPanel token={token} accounts={accounts} balance={balance} alreadyPending={hasPending} />}
                </div>
              </>
            )}
          </>
        )}

        <div className="muted t-xs" style={{ textAlign: "center", marginTop: 24 }}>Pago seguro · Hiraticket</div>
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
