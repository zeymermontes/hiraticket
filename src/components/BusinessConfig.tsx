"use client";
import React, { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { type PillColor, tagColor } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { Area, Stage } from "@/lib/business";
import type { Agent } from "@/lib/chat";
import { ReorderList } from "@/components/ReorderList";
import {
  createArea, updateArea, deleteArea, createStage, updateStage, deleteStage, reorderStages, updateBusinessProfile, setCustomFields, updatePaymentConfig, deleteTagFromCatalog,
} from "@/app/(app)/business/actions";
import type { TagCatalogItem } from "@/lib/tags";
import type { Branch, BankAccount, PayPromoPlacement } from "@/lib/types";
import { DAY_ORDER, DAY_LABEL, defaultHours, normalizeHours, type DayHours } from "@/lib/hours";

const rid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));

const COLORS: PillColor[] = ["slate", "blue", "violet", "teal", "green", "amber", "red", "brand"];

function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const toggle = () => setRect(rect ? null : btn.current?.getBoundingClientRect() ?? null);
  return (
    <span style={{ display: "inline-flex" }}>
      <button ref={btn} className="iconbtn sm" onClick={toggle} title="Color">
        <span style={{ width: 14, height: 14, borderRadius: 5, background: `var(--${value})`, display: "inline-block" }} />
      </button>
      {rect && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRect(null)} />
          <div className="menu" style={{ position: "fixed", top: rect.bottom + 6, left: rect.left, padding: 8, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, zIndex: 201 }}>
            {COLORS.map((c) => (
              <button key={c} onClick={() => { onPick(c); setRect(null); }} style={{ width: 22, height: 22, borderRadius: 6, background: `var(--${c})`, border: c === value ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

const TIMEZONES = [
  "America/Mexico_City", "America/Tijuana", "America/Cancun", "America/Monterrey",
  "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "Europe/Madrid", "UTC",
];

export function BusinessConfig({
  businessId, businessName, stages, areas, agents, tags = [], vertical, objectSingular, customFields, productStages, showTyping, allowGroups, mode, timezone,
  payBranchEnabled, payTransferEnabled, branches: branches0, bankAccounts: bankAccounts0, invoiceAddTax, invoiceTaxRate, manualMarginPct,
  payPromoUrl, payPromoPlacement,
}: {
  businessId: string;
  businessName: string;
  stages: Stage[];
  areas: Area[];
  agents: Agent[];
  tags?: TagCatalogItem[];
  vertical: string | null;
  objectSingular: string;
  customFields: string[];
  productStages: boolean;
  showTyping: boolean;
  allowGroups: boolean;
  mode: "business" | "personal";
  timezone: string;
  payBranchEnabled: boolean;
  payTransferEnabled: boolean;
  branches: Branch[];
  bankAccounts: BankAccount[];
  invoiceAddTax: boolean;
  invoiceTaxRate: number;
  manualMarginPct: number;
  payPromoUrl: string | null;
  payPromoPlacement: PayPromoPlacement;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [newStage, setNewStage] = useState("");
  const [newArea, setNewArea] = useState("");
  const [newField, setNewField] = useState("");
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  // Payment config: keep local copies so text edits don't lose focus; each change persists the
  // whole jsonb list. (Only meaningful in business mode — hidden in personal.)
  const [branches, setBranches] = useState<Branch[]>(branches0);
  const [accounts, setAccounts] = useState<BankAccount[]>(bankAccounts0);
  const saveBranches = (next: Branch[]) => { setBranches(next); start(() => updatePaymentConfig(businessId, { branches: next }).then(() => {})); };
  const saveAccounts = (next: BankAccount[]) => { setAccounts(next); start(() => updatePaymentConfig(businessId, { bank_accounts: next }).then(() => {})); };
  const patchBranch = (id: string, p: Partial<Branch>) => saveBranches(branches.map((b) => (b.id === id ? { ...b, ...p } : b)));
  // Imagen promocional del link de pago (0080). Se sube al bucket público 'media' —- la ve gente
  // sin sesión —- y solo se guarda la URL. Copia local para que la vista previa cambie al momento.
  const [promoUrl, setPromoUrl] = useState<string | null>(payPromoUrl);
  const [promoPlacement, setPromoPlacement] = useState<PayPromoPlacement>(payPromoPlacement);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const promoInput = useRef<HTMLInputElement>(null);
  // Se avisa si el guardado falla en vez de dejar el botón "guardado" a mentiras (p. ej. la
  // migración 0080 todavía sin correr: la columna no existe y Supabase devuelve error).
  const savePromo = (patch: { pay_promo_url?: string | null; pay_promo_placement?: PayPromoPlacement }) =>
    start(() => updatePaymentConfig(businessId, patch).then((r) => {
      setPromoErr(r.ok ? null : (lang === "es" ? "No se pudo guardar el cambio." : "Couldn't save the change."));
    }));
  const setPlacement = (p: PayPromoPlacement) => { setPromoPlacement(p); savePromo({ pay_promo_placement: p }); };
  async function uploadPromo(file: File) {
    if (!file.type.startsWith("image/")) { setPromoErr(lang === "es" ? "Elige una imagen." : "Pick an image file."); return; }
    if (file.size > 5 * 1024 * 1024) { setPromoErr(lang === "es" ? "La imagen pesa más de 5 MB." : "The image is over 5 MB."); return; }
    setPromoErr(null); setPromoBusy(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `promo/${businessId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (error) { setPromoErr(lang === "es" ? "No se pudo subir la imagen." : "Couldn't upload the image."); return; }
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      setPromoUrl(url);
      // Subir una imagen y dejarla apagada no tendría sentido: si estaba en 'off', se enciende.
      const place: PayPromoPlacement = promoPlacement === "off" ? "below" : promoPlacement;
      setPromoPlacement(place);
      savePromo({ pay_promo_url: url, pay_promo_placement: place });
    } finally { setPromoBusy(false); }
  }
  const removePromo = () => { setPromoUrl(null); setPromoPlacement("off"); savePromo({ pay_promo_url: null, pay_promo_placement: "off" }); };
  const patchAccount = (id: string, p: Partial<BankAccount>) => saveAccounts(accounts.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const setBranchDay = (id: string, wd: number, patch: Partial<DayHours>) => {
    const b = branches.find((x) => x.id === id);
    const cur = normalizeHours(b?.hours);
    patchBranch(id, { hours: cur.map((x, i) => (i === wd ? { ...x, ...patch } : x)) });
  };
  // Show each timezone's current local time. Compute only after mount (avoids an SSR/client time
  // mismatch) and tick once a minute to keep it fresh.
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { setMounted(true); const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  const tzTime = (tz: string) => { try { return new Date().toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
  const addStage = () => { if (newStage.trim()) { run(() => createStage(businessId, newStage, stages.length)); setNewStage(""); } };
  const addArea = () => { if (newArea.trim()) { run(() => createArea(businessId, newArea, areas.length)); setNewArea(""); } };


  return (
    <div className="page">
      <div className="phead">
        <h1>{mode === "personal" ? (lang === "es" ? "Espacio" : "Workspace") : (lang === "es" ? "Negocio" : "Business")}</h1>
        <Pill color="slate" large>{businessName}</Pill>
        <span className="t-sm muted hide-narrow" style={{ marginLeft: 8 }}>{lang === "es" ? "Configura tus etapas y áreas" : "Configure your stages and areas"}</span>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
       <div style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Vertical + object name */}
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="store" size={16} /><h4>{lang === "es" ? "Tipo de espacio" : "Workspace type"}</h4></div>
          <div className="ws-block-body col gap-3">
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {([
                { id: "business", icon: "store", title: lang === "es" ? "Negocio" : "Business", desc: lang === "es" ? "Pedidos, productos, precios y pagos" : "Orders, products, prices, payments" },
                { id: "personal", icon: "orders", title: lang === "es" ? "Gestión personal" : "Personal management", desc: lang === "es" ? "Tareas y subtareas, sin dinero" : "Tasks & subtasks, no money" },
              ] as const).map((o) => (
                <button key={o.id} onClick={() => run(() => updateBusinessProfile(businessId, { mode: o.id, object_singular: o.id === "personal" ? "Tarea" : "Pedido", product_stages: o.id === "personal" ? true : productStages }))}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", flex: "1 1 220px",
                    background: mode === o.id ? "var(--brand-50)" : "var(--surface)", border: "2px solid " + (mode === o.id ? "var(--brand)" : "var(--border)") }}>
                  <Icon name={o.icon} size={19} /><span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>{o.title}</span><span className="t-xs muted">{o.desc}</span></span>
                </button>
              ))}
            </div>
            <div className="row gap-2" style={{ alignItems: "center", maxWidth: 420 }}>
              <label className="lbl" style={{ margin: 0 }}>{mode === "personal" ? (lang === "es" ? "¿Cómo le llamas a la tarea?" : "What do you call the task?") : (lang === "es" ? "¿Cómo le llamas al objeto?" : "What do you call the object?")}</label>
              <input className="inp-inline grow" defaultValue={objectSingular} placeholder={mode === "personal" ? "Tarea" : "Pedido"}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== objectSingular) run(() => updateBusinessProfile(businessId, { object_singular: v })); }} />
            </div>
          </div>
        </section>

        {/* Custom fields */}
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="sliders" size={16} /><h4>{lang === "es" ? "Campos personalizados" : "Custom fields"}</h4></div>
          <div className="ws-block-body col gap-2">
            <p className="muted t-sm">{mode === "personal" ? (lang === "es" ? "Datos extra que capturas por tarea." : "Extra data captured per task.") : (lang === "es" ? "Datos extra que capturas por pedido (ej. Placa, Mascota, Tipo de papel)." : "Extra data captured per order (e.g. Plate, Pet, Paper type).")}</p>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {customFields.length === 0 && <span className="muted t-sm">—</span>}
              {customFields.map((f, i) => (
                <span key={i} className="row gap-1" style={{ alignItems: "center", padding: "4px 6px 4px 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 13 }}>
                  {f}<button className="iconbtn sm" style={{ width: 18, height: 18 }} onClick={() => run(() => setCustomFields(businessId, customFields.filter((_, j) => j !== i)))}><Icon name="x" size={12} /></button>
                </span>
              ))}
            </div>
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nuevo campo…" : "New field…"} value={newField} onChange={(e) => setNewField(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newField.trim()) { run(() => setCustomFields(businessId, [...customFields, newField.trim()])); setNewField(""); } }} />
              <button className="btn btn-sm btn-primary" disabled={!newField.trim()} onClick={() => { run(() => setCustomFields(businessId, [...customFields, newField.trim()])); setNewField(""); }}><Icon name="plus" size={14} />{lang === "es" ? "Agregar campo" : "Add field"}</button>
            </div>
          </div>
        </section>

        {/* Customer payments — business mode only (personal has no money). */}
        {mode !== "personal" && (
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="orders" size={16} /><h4 className="grow">{lang === "es" ? "Pagos del cliente" : "Customer payments"}</h4></div>
          <div className="ws-block-body col gap-3">
            <p className="muted t-sm">{lang === "es" ? "Métodos que verá el cliente al abrir su link de pago." : "Methods the customer sees when they open their payment link."}</p>

            {/* Pay at branch */}
            <div className="col gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="row gap-2" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Pago en sucursal" : "Pay at branch"}</div>
                  <div className="t-xs muted">{lang === "es" ? "El cliente ve tus sucursales y su ubicación para pagar en persona." : "The customer sees your branches and their location to pay in person."}</div>
                </div>
                <button className={"chip" + (payBranchEnabled ? " on" : "")} onClick={() => run(() => updatePaymentConfig(businessId, { pay_branch_enabled: !payBranchEnabled }))}>
                  {payBranchEnabled ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}
                </button>
              </div>
              {payBranchEnabled && (
                <div className="col gap-2">
                  {branches.map((b) => (
                    <div key={b.id} className="col gap-1" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                      <div className="row gap-2">
                        <input className="inp-inline grow" defaultValue={b.name} placeholder={lang === "es" ? "Nombre de la sucursal" : "Branch name"} onBlur={(e) => { if (e.target.value !== b.name) patchBranch(b.id, { name: e.target.value }); }} />
                        <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => saveBranches(branches.filter((x) => x.id !== b.id))}><Icon name="x" size={15} /></button>
                      </div>
                      <input className="inp-inline" defaultValue={b.address} placeholder={lang === "es" ? "Dirección" : "Address"} onBlur={(e) => { if (e.target.value !== b.address) patchBranch(b.id, { address: e.target.value }); }} />
                      <div className="row gap-2">
                        <input className="inp-inline grow" defaultValue={b.maps_url ?? ""} placeholder={lang === "es" ? "Link de Maps (opcional)" : "Maps link (optional)"} onBlur={(e) => { if (e.target.value !== (b.maps_url ?? "")) patchBranch(b.id, { maps_url: e.target.value }); }} />
                        <input className="inp-inline" style={{ width: 150 }} defaultValue={b.phone ?? ""} placeholder={lang === "es" ? "Teléfono" : "Phone"} onBlur={(e) => { if (e.target.value !== (b.phone ?? "")) patchBranch(b.id, { phone: e.target.value }); }} />
                      </div>
                      <div className="col gap-1" style={{ marginTop: 4 }}>
                        <label className="lbl" style={{ margin: "2px 0" }}>{lang === "es" ? "Horario de atención" : "Business hours"}</label>
                        {DAY_ORDER.map((wd) => {
                          const d = normalizeHours(b.hours)[wd];
                          return (
                            <div key={wd} className="row gap-2" style={{ alignItems: "center" }}>
                              <span style={{ width: 32, fontSize: 13, fontWeight: 600, flex: "none" }}>{DAY_LABEL[wd][lang === "es" ? "es" : "en"]}</span>
                              <label className="row gap-1" style={{ alignItems: "center", cursor: "pointer", width: 74, flex: "none" }}>
                                <input type="checkbox" checked={d.open} onChange={(e) => setBranchDay(b.id, wd, { open: e.target.checked })} />
                                <span className="t-xs">{lang === "es" ? "Abierto" : "Open"}</span>
                              </label>
                              {d.open ? (
                                <>
                                  <input className="inp-inline" style={{ minWidth: 0, flex: 1 }} type="time" value={d.from} onChange={(e) => setBranchDay(b.id, wd, { from: e.target.value })} />
                                  <span className="muted">–</span>
                                  <input className="inp-inline" style={{ minWidth: 0, flex: 1 }} type="time" value={d.to} onChange={(e) => setBranchDay(b.id, wd, { to: e.target.value })} />
                                </>
                              ) : <span className="t-xs muted grow">{lang === "es" ? "Cerrado" : "Closed"}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <button className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => saveBranches([...branches, { id: rid(), name: "", address: "", hours: defaultHours() }])}><Icon name="plus" size={14} />{lang === "es" ? "Agregar sucursal" : "Add branch"}</button>
                </div>
              )}
            </div>

            {/* Bank transfer */}
            <div className="col gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="row gap-2" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Transferencia" : "Bank transfer"}</div>
                  <div className="t-xs muted">{lang === "es" ? "El cliente ve tus cuentas y sube el comprobante (queda en revisión hasta que lo apruebes)." : "The customer sees your accounts and uploads a receipt (pending your review)."}</div>
                </div>
                <button className={"chip" + (payTransferEnabled ? " on" : "")} onClick={() => run(() => updatePaymentConfig(businessId, { pay_transfer_enabled: !payTransferEnabled }))}>
                  {payTransferEnabled ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}
                </button>
              </div>
              {payTransferEnabled && (
                <div className="col gap-2">
                  {accounts.map((a) => (
                    <div key={a.id} className="col gap-1" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }}>
                      <div className="row gap-2">
                        <input className="inp-inline grow" defaultValue={a.bank} placeholder={lang === "es" ? "Banco" : "Bank"} onBlur={(e) => { if (e.target.value !== a.bank) patchAccount(a.id, { bank: e.target.value }); }} />
                        <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => saveAccounts(accounts.filter((x) => x.id !== a.id))}><Icon name="x" size={15} /></button>
                      </div>
                      <input className="inp-inline" defaultValue={a.holder} placeholder={lang === "es" ? "Titular de la cuenta" : "Account holder"} onBlur={(e) => { if (e.target.value !== a.holder) patchAccount(a.id, { holder: e.target.value }); }} />
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                        <input className="inp-inline grow" style={{ minWidth: 120 }} defaultValue={a.account ?? ""} placeholder={lang === "es" ? "Número de cuenta" : "Account number"} onBlur={(e) => { if (e.target.value !== (a.account ?? "")) patchAccount(a.id, { account: e.target.value }); }} />
                        <input className="inp-inline grow" style={{ minWidth: 120 }} defaultValue={a.clabe ?? ""} placeholder="CLABE" onBlur={(e) => { if (e.target.value !== (a.clabe ?? "")) patchAccount(a.id, { clabe: e.target.value }); }} />
                        <input className="inp-inline grow" style={{ minWidth: 120 }} defaultValue={a.card ?? ""} placeholder={lang === "es" ? "Tarjeta" : "Card"} onBlur={(e) => { if (e.target.value !== (a.card ?? "")) patchAccount(a.id, { card: e.target.value }); }} />
                      </div>
                      {!(a.account?.trim() || a.clabe?.trim() || a.card?.trim()) && (
                        <span className="t-xs" style={{ color: "var(--red)" }}>{lang === "es" ? "Agrega al menos uno: cuenta, CLABE o tarjeta." : "Add at least one: account, CLABE or card."}</span>
                      )}
                      <input className="inp-inline" defaultValue={a.note ?? ""} placeholder={lang === "es" ? "Nota (opcional)" : "Note (optional)"} onBlur={(e) => { if (e.target.value !== (a.note ?? "")) patchAccount(a.id, { note: e.target.value }); }} />
                    </div>
                  ))}
                  <button className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => saveAccounts([...accounts, { id: rid(), bank: "", holder: "" }])}><Icon name="plus" size={14} />{lang === "es" ? "Agregar cuenta" : "Add account"}</button>
                </div>
              )}
            </div>

            {/* Invoice / IVA */}
            <div className="row gap-2" style={{ alignItems: "flex-start", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Requiere factura suma IVA" : "“Needs invoice” adds tax"}</div>
                <div className="t-xs muted">{lang === "es" ? "Al marcar “Requiere factura” en un pedido nuevo, el IVA se suma al total." : "Checking “Needs invoice” on a new order adds the tax to its total."}</div>
              </div>
              {invoiceAddTax && (
                <div className="row gap-1" style={{ alignItems: "center" }}>
                  <input className="inp-inline mono" style={{ width: 64, textAlign: "right" }} type="number" min={0} max={99} step="0.5" defaultValue={String(invoiceTaxRate)}
                    onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== invoiceTaxRate) run(() => updateBusinessProfile(businessId, { invoice_tax_rate: v })); }} />
                  <span className="t-sm muted">%</span>
                </div>
              )}
              <button className={"chip" + (invoiceAddTax ? " on" : "")} onClick={() => run(() => updateBusinessProfile(businessId, { invoice_add_tax: !invoiceAddTax }))}>
                {invoiceAddTax ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}
              </button>
            </div>

            {/* Default profit margin for manually-typed items (reports) */}
            <div className="row gap-2" style={{ alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "% de ganancia en productos manuales" : "Profit % on manual products"}</div>
                <div className="t-xs muted">{lang === "es" ? "Para productos escritos a mano (no del catálogo), los reportes asumen este % de la venta como ganancia. Los del catálogo usan su costo." : "For hand-typed products (not from the catalog), reports assume this % of the sale as profit. Catalog products use their cost."}</div>
              </div>
              <div className="row gap-1" style={{ alignItems: "center" }}>
                <input className="inp-inline mono" style={{ width: 64, textAlign: "right" }} type="number" min={0} max={100} step="1" defaultValue={String(manualMarginPct)}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== manualMarginPct) run(() => updateBusinessProfile(businessId, { manual_margin_pct: v })); }} />
                <span className="t-sm muted">%</span>
              </div>
            </div>

            {/* Gateway — coming soon */}
            <div className="row gap-2" style={{ alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Pago con tarjeta (pasarela)" : "Card payment (gateway)"}</div>
                <div className="t-xs muted">{lang === "es" ? "Cobro con proveedor externo." : "Charge via an external provider."}</div>
              </div>
              <Pill color="slate">{lang === "es" ? "Próximamente" : "Coming soon"}</Pill>
            </div>
          </div>
        </section>
        )}

        {/* Imagen promocional del link de pago (0080). Va en negocio y no en personal por lo mismo
            que los pagos: en personal no hay link de pago que la muestre. */}
        {mode !== "personal" && (
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head"><Icon name="sparkles" size={16} /><h4 className="grow">{lang === "es" ? "Imagen promocional" : "Promotional image"}</h4>{promoPlacement !== "off" && promoUrl && <Pill color="green">{lang === "es" ? "Visible" : "Live"}</Pill>}</div>
          <div className="ws-block-body col gap-3">
            <p className="muted t-sm">{lang === "es" ? "Una imagen tuya —- una promoción, un aviso, tu menú —- que el cliente ve en su link de pago, junto al ticket." : "An image of yours —- a promo, a notice, your menu —- shown to the customer on their payment link, next to the ticket."}</p>

            <div className="row gap-3" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ width: 180, height: 120, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", display: "grid", placeItems: "center", overflow: "hidden", flex: "none" }}>
                {promoUrl
                  ? <img src={promoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : <span className="muted t-xs" style={{ padding: 8, textAlign: "center" }}>{lang === "es" ? "Sin imagen" : "No image"}</span>}
              </div>
              <div className="col gap-2">
                <input ref={promoInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPromo(f); e.target.value = ""; }} />
                <button className="btn btn-sm btn-outline" disabled={promoBusy} onClick={() => promoInput.current?.click()}>
                  <Icon name="sparkles" size={14} />{promoBusy ? (lang === "es" ? "Subiendo…" : "Uploading…") : promoUrl ? (lang === "es" ? "Cambiar imagen" : "Replace image") : (lang === "es" ? "Subir imagen" : "Upload image")}
                </button>
                {promoUrl && <button className="btn btn-sm btn-outline" disabled={promoBusy} onClick={removePromo}><Icon name="trash" size={14} />{lang === "es" ? "Quitar" : "Remove"}</button>}
                <span className="t-xs muted">{lang === "es" ? "JPG o PNG, hasta 5 MB." : "JPG or PNG, up to 5 MB."}</span>
                {promoErr && <span className="t-xs" style={{ color: "var(--red)" }}>{promoErr}</span>}
              </div>
            </div>

            {/* Dónde la ve el cliente. Sin imagen no hay nada que colocar, así que se desactiva. */}
            <div className="col gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "¿Dónde la ve el cliente?" : "Where does the customer see it?"}</label>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {([
                  { id: "off", title: lang === "es" ? "No mostrar" : "Don't show", desc: lang === "es" ? "La imagen se guarda por si la quieres después." : "The image is kept in case you want it later." },
                  { id: "below", title: lang === "es" ? "Abajo del ticket" : "Below the ticket", desc: lang === "es" ? "Al final de la página, después de los métodos de pago." : "At the end of the page, after the payment methods." },
                  { id: "popup", title: lang === "es" ? "Ventana al abrir" : "Popup on open", desc: lang === "es" ? "Aparece encima al abrir el link; el cliente la cierra y sigue." : "Pops up when the link opens; the customer closes it and continues." },
                ] as const).map((o) => (
                  <button key={o.id} disabled={!promoUrl && o.id !== "off"} onClick={() => setPlacement(o.id)}
                    style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, textAlign: "left", flex: "1 1 190px",
                      cursor: !promoUrl && o.id !== "off" ? "default" : "pointer", opacity: !promoUrl && o.id !== "off" ? 0.5 : 1,
                      background: promoPlacement === o.id ? "var(--brand-50)" : "var(--surface)", border: "2px solid " + (promoPlacement === o.id ? "var(--brand)" : "var(--border)") }}>
                    <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 700, fontSize: 13.5 }}>{o.title}</span><span className="t-xs muted">{o.desc}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Stages */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="dot" size={16} /><h4 className="grow">{mode === "personal" ? (lang === "es" ? "Etapas de la tarea" : "Task stages") : (lang === "es" ? "Etapas del pedido" : "Order stages")}</h4>
            <button className={"chip" + (productStages ? " on" : "")} title={mode === "personal" ? (lang === "es" ? "Cada subtarea avanza por su propia etapa; la tarea muestra la menos avanzada" : "Each subtask moves through its own stage; the task shows the least-advanced one") : (lang === "es" ? "Cada producto avanza por su propia etapa; el pedido muestra la menos avanzada" : "Each product moves through its own stage; the order shows the least-advanced one")}
              onClick={() => start(async () => {
                const r = await updateBusinessProfile(businessId, { product_stages: !productStages });
                if (!r.ok) { alert(lang === "es" ? "No se pudo activar. Aplica las migraciones 0019 y 0020 con el pooler.\n\n(" + (r.error ?? "") + ")" : "Couldn't toggle. Apply migrations 0019 and 0020.\n\n(" + (r.error ?? "") + ")"); return; }
                router.refresh();
              })}>
              <Icon name="layers" size={13} />{mode === "personal" ? (lang === "es" ? "Etapas por subtarea" : "Per-subtask stages") : (lang === "es" ? "Etapas por producto" : "Per-product stages")}
            </button>
          </div>
          <div className="ws-block-body col gap-2">
            <ReorderList items={stages} getKey={(s) => s.id} className="col gap-2"
              onReorder={(ids) => run(() => reorderStages(businessId, ids))}
              renderItem={(s, handle) => (
                <div className="row gap-2">
                  <span className="ws-grip" {...handle} title={lang === "es" ? "Arrastra para reordenar" : "Drag to reorder"}><Icon name="grip" size={15} /></span>
                  <ColorPicker value={s.color} onPick={(c) => run(() => updateStage(s.id, { color: c }))} />
                  <input className="inp-inline grow" defaultValue={s.name}
                    onBlur={(e) => { if (e.target.value !== s.name) run(() => updateStage(s.id, { name: e.target.value })); }} />
                  <button className="iconbtn sm" title={lang === "es" ? "Eliminar" : "Delete"} onClick={() => run(() => deleteStage(s.id))}><Icon name="x" size={15} /></button>
                </div>
              )} />
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva etapa…" : "New stage…"} value={newStage} onChange={(e) => setNewStage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStage(); }} />
              <button className="btn btn-sm btn-primary" disabled={!newStage.trim()} onClick={addStage}><Icon name="plus" size={14} />{lang === "es" ? "Agregar etapa" : "Add stage"}</button>
            </div>
          </div>
        </section>

        {/* Tag catalog (0073) */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="tag" size={16} /><h4 className="grow">{lang === "es" ? "Etiquetas" : "Tags"}</h4><Pill color="slate">{tags.length}</Pill></div>
          <div className="ws-block-body col gap-2">
            <div className="t-xs muted">{lang === "es" ? "El catálogo que ofrece el selector al etiquetar un contacto o pedido. Borrar una de aquí solo la quita del catálogo — los contactos que ya la tienen la conservan." : "The catalog offered by the picker when tagging a contact or order. Deleting one here only removes it from the catalog — contacts that already have it keep it."}</div>
            {tags.length === 0 ? (
              <div className="muted t-sm">{lang === "es" ? "Sin etiquetas todavía. Se agregan solas la primera vez que se usan." : "No tags yet. They're added automatically the first time one is used."}</div>
            ) : (
              <div className="row gap-1" style={{ flexWrap: "wrap" }}>
                {tags.map((t) => (
                  <span key={t.id} style={{ display: "inline-flex", alignItems: "center" }}>
                    <Pill color={tagColor(t.name)}>{t.name}
                      <button onClick={() => run(() => deleteTagFromCatalog(t.id))} aria-label="remove" title={lang === "es" ? "Quitar del catálogo" : "Remove from catalog"}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, marginLeft: 4, padding: 0, border: "none", background: "transparent", color: "currentColor", opacity: 0.75, cursor: "pointer" }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}>
                        <Icon name="x" size={12} />
                      </button>
                    </Pill>
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* WhatsApp privacy */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="whatsapp" size={16} /><h4 className="grow">{lang === "es" ? "WhatsApp" : "WhatsApp"}</h4></div>
          <div className="ws-block-body col gap-2">
            <div className="row gap-2" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Ver cuándo el cliente escribe" : "See when the customer is typing"}</div>
                <div className="t-xs muted">{lang === "es" ? "Muestra \"escribiendo…\". Requiere que tu número aparezca en línea mientras el worker está conectado." : "Shows \"typing…\". Requires your number to appear online while the worker is connected."}</div>
              </div>
              <button className={"chip" + (showTyping ? " on" : "")} onClick={() => run(() => updateBusinessProfile(businessId, { show_typing: !showTyping }))}>
                {showTyping ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}
              </button>
            </div>
            <div className="row gap-2" style={{ alignItems: "flex-start", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Chats de grupo" : "Group chats"}</div>
                <div className="t-xs muted">{lang === "es" ? "Muestra y permite responder conversaciones de grupos de WhatsApp. Solo para conversar — los grupos no crean ni se vinculan a pedidos." : "Show and reply to WhatsApp group conversations. Chat-only — groups don't create or link to orders."}</div>
              </div>
              <button className={"chip" + (allowGroups ? " on" : "")} onClick={() => start(async () => {
                const r = await updateBusinessProfile(businessId, { allow_groups: !allowGroups });
                if (!r.ok) { alert(lang === "es" ? "No se pudo activar. Aplica la migración 0032 (o reinicia el worker).\n\n(" + (r.error ?? "") + ")" : "Couldn't toggle. Apply migration 0032 (or restart the worker).\n\n(" + (r.error ?? "") + ")"); return; }
                router.refresh();
              })}>
                {allowGroups ? (lang === "es" ? "Activado" : "On") : (lang === "es" ? "Desactivado" : "Off")}
              </button>
            </div>
            <div className="row gap-2" style={{ alignItems: "flex-start", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{lang === "es" ? "Zona horaria" : "Timezone"}</div>
                <div className="t-xs muted">{lang === "es" ? "Usada por los flujos de horario y asueto para saber qué hora es donde estás." : "Used by schedule & holiday flows to know your local time."}</div>
              </div>
              <select className="select" style={{ width: 220 }} value={TIMEZONES.includes(timezone) ? timezone : "America/Mexico_City"}
                onChange={(e) => run(() => updateBusinessProfile(businessId, { timezone: e.target.value }))}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}{mounted ? ` · ${tzTime(tz)}` : ""}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Areas */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="layers" size={16} /><h4 className="grow">{lang === "es" ? "Áreas y ruteo" : "Areas & routing"}</h4></div>
          <div className="ws-block-body col gap-2">
            {areas.map((a) => (
              <div key={a.id} className="row gap-2">
                <ColorPicker value={a.color} onPick={(c) => run(() => updateArea(a.id, { color: c }))} />
                <input className="inp-inline grow" defaultValue={a.name}
                  onBlur={(e) => { if (e.target.value !== a.name) run(() => updateArea(a.id, { name: e.target.value })); }} />
                <select className="select select-sm" defaultValue={a.route_to ?? ""}
                  onChange={(e) => run(() => updateArea(a.id, { route_to: e.target.value || null }))} title={lang === "es" ? "Asignado por defecto" : "Default assignee"}>
                  <option value="">{lang === "es" ? "Sin ruteo" : "No routing"}</option>
                  {agents.filter((ag) => ag.role !== "viewer").map((ag) => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
                </select>
                <button className="iconbtn sm" onClick={() => run(() => deleteArea(a.id))}><Icon name="x" size={15} /></button>
              </div>
            ))}
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Nueva área…" : "New area…"} value={newArea} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addArea(); }} />
              <button className="btn btn-sm btn-primary" disabled={!newArea.trim()} onClick={addArea}><Icon name="plus" size={14} />{lang === "es" ? "Agregar área" : "Add area"}</button>
            </div>
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}
