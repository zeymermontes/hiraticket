"use client";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Product } from "@/lib/extras";
import type { PriceTier } from "@/lib/types";
import type { CatalogFiscal } from "@/lib/facturacionOps";
import type { SatKey } from "@/lib/facturacion";
import { createProduct, updateProduct, deleteProduct, syncCatalog, searchSatKeys } from "@/app/(app)/features-actions";

const HOUR = 3600_000;

export function CatalogScreen({ businessId, products, fiscal = null }: {
  businessId: string; products: Product[];
  /** Con el plugin Hiraticket Facturación activo: claves SAT por producto y estado de la sincronización. */
  fiscal?: CatalogFiscal | null;
}) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Columnas fiscales y sincronización: solo en modo negocio y con el plugin activo.
  const fx = !personal && fiscal ? fiscal : null;
  const syncOn = !!fx && fx.mode !== "off";
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const doSync = async (full: boolean, quiet = false) => {
    setSyncing(true); if (!quiet) setSyncMsg(null);
    const r = await syncCatalog(businessId, full);
    setSyncing(false);
    const es = lang === "es";
    if (!r.ok) {
      if (!quiet) setSyncMsg({ ok: false, text: r.error && !["off", "list", "migration"].includes(r.error) ? r.error : (es ? "No se pudo sincronizar con Facturación. Intenta de nuevo." : "Couldn't sync with the invoicing account. Try again.") });
      return;
    }
    const parts = [
      r.pushed ? (es ? `${r.pushed} enviados` : `${r.pushed} sent`) : "",
      r.created ? (es ? `${r.created} nuevos` : `${r.created} new`) : "",
      r.updated ? (es ? `${r.updated} actualizados` : `${r.updated} updated`) : "",
      r.deactivated ? (es ? `${r.deactivated} desactivados` : `${r.deactivated} deactivated`) : "",
    ].filter(Boolean);
    if (!quiet || parts.length) setSyncMsg({ ok: true, text: parts.length ? parts.join(" · ") : (es ? "Todo al día." : "Everything is up to date.") });
    router.refresh();
  };
  // Al abrir el catálogo, si la última sincronización tiene más de una hora, se corre una en silencio.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!syncOn || autoRan.current) return;
    autoRan.current = true;
    const last = fx?.lastSync ? Date.parse(fx.lastSync) : 0;
    if (!last || Date.now() - last > HOUR) void doSync(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOn]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [kind, setKind] = useState("product");
  const [q, setQ] = useState("");
  const [tiersFor, setTiersFor] = useState<string | null>(null);
  const [fiscalFor, setFiscalFor] = useState<string | null>(null); // producto con los datos fiscales abiertos
  // Alta: claves SAT opcionales desde el principio, para no tener que volver a abrir el producto.
  const [newFiscal, setNewFiscal] = useState(false);
  const [newSat, setNewSat] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const view = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <div className="phead"><h1>{personal ? (lang === "es" ? "Tareas repetitivas" : "Recurring tasks") : (lang === "es" ? "Catálogo" : "Catalog")}</h1><Pill color="slate" large>{products.length}</Pill></div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
       <div className="page-grid" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="store" size={16} /><h4 className="grow">{personal ? (lang === "es" ? "Tareas repetitivas" : "Recurring tasks") : (lang === "es" ? "Productos y servicios" : "Products & services")}</h4>
            <div className="field field-sm" style={{ width: 180 }}><Icon name="search" /><input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {syncOn && (
            <div className="row gap-2" style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
              <Icon name="refresh" size={14} />
              <span className="t-xs muted grow" style={{ minWidth: 160 }}>
                {lang === "es" ? "Sincronizado con Hiraticket Facturación" : "Synced with Hiraticket Facturación"}
                {" · "}
                {fx!.mode === "push" ? (lang === "es" ? "de aquí hacia allá" : "from here to there") : fx!.mode === "pull" ? (lang === "es" ? "de allá hacia aquí" : "from there to here") : (lang === "es" ? "en los dos sentidos" : "both ways")}
                {fx!.lastSync ? ` · ${lang === "es" ? "última" : "last"} ${new Date(fx!.lastSync).toLocaleString(lang === "es" ? "es-MX" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                {syncMsg ? <span style={{ color: syncMsg.ok ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{` · ${syncMsg.text}`}</span> : null}
              </span>
              <button className="btn btn-sm btn-outline" disabled={syncing} onClick={() => doSync(false)}>{syncing ? (lang === "es" ? "Sincronizando…" : "Syncing…") : (lang === "es" ? "Sincronizar ahora" : "Sync now")}</button>
              <button className="btn btn-sm btn-ghost" disabled={syncing} onClick={() => doSync(true)}
                title={lang === "es" ? "Compara los dos catálogos completos. Lo que ya no exista en Facturación se desactiva aquí (no se borra)." : "Compares both full catalogs. What no longer exists in the invoicing account is deactivated here (not deleted)."}>
                {lang === "es" ? "Sincronización completa" : "Full sync"}
              </button>
            </div>
          )}
          <div className="tablewrap keep-table scroll">
            <table className="tbl">
              <thead><tr><th>{lang === "es" ? "Nombre" : "Name"}</th>{!personal && <th>{lang === "es" ? "Tipo" : "Type"}</th>}{!personal && <th>{lang === "es" ? "Precio" : "Price"}</th>}{!personal && <th title={lang === "es" ? "Lo que te cuesta — se usa para calcular la ganancia en reportes" : "What it costs you — used to compute profit in reports"}>{lang === "es" ? "Costo" : "Cost"}</th>}<th></th></tr></thead>
              <tbody>
                {view.map((p) => (
                  <React.Fragment key={p.id}>
                  <tr style={p.active === false ? { opacity: 0.55 } : undefined}>
                    <td><input key={p.name} className="inp-inline grow" defaultValue={p.name} style={{ width: "100%" }} onBlur={(e) => { if (e.target.value !== p.name) run(() => updateProduct(p.id, { name: e.target.value })); }} /></td>
                    {!personal && <td>{p.active === false
                      ? <span title={lang === "es" ? "No se ofrece al armar pedidos. Se desactiva solo cuando el producto se borra en Facturación." : "Not offered when building orders. It's turned off automatically when the product is deleted in the invoicing account."}><Pill color="slate">{lang === "es" ? "Inactivo" : "Inactive"}</Pill></span>
                      : <Pill color={p.kind === "service" ? "violet" : "blue"}>{p.kind === "service" ? (lang === "es" ? "Servicio" : "Service") : (lang === "es" ? "Producto" : "Product")}</Pill>}</td>}
                    {!personal && <td><input key={p.price} className="inp-inline mono" style={{ width: 90 }} defaultValue={String(p.price)} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v !== p.price) run(() => updateProduct(p.id, { price: v })); }} /></td>}
                    {!personal && <td><input className="inp-inline mono" style={{ width: 90 }} placeholder="—" defaultValue={p.cost == null ? "" : String(p.cost)} onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === "" ? null : Number(raw); if (raw !== "" && Number.isNaN(v)) return; if (v !== p.cost) run(() => updateProduct(p.id, { cost: v })); }} /></td>}
                    <td className="row gap-1">
                      {!personal && <button className={"iconbtn sm" + (tiersFor === p.id ? " active" : "")} title={lang === "es" ? "Precios por cantidad" : "Quantity pricing"} onClick={() => setTiersFor(tiersFor === p.id ? null : p.id)}>
                        <Icon name="layers" size={15} />{p.price_tiers.length > 0 && <span className="badge badge-soft" style={{ marginLeft: 2 }}>{p.price_tiers.length}</span>}
                      </button>}
                      {fx && <button className={"iconbtn sm" + (fiscalFor === p.id ? " active" : "")} title={lang === "es" ? "Datos para facturar: clave SAT, unidad e IVA" : "Invoicing data: SAT key, unit and tax"} onClick={() => setFiscalFor(fiscalFor === p.id ? null : p.id)}>
                        <Icon name="file" size={15} />{fx.byId[p.id]?.sat_code && fx.byId[p.id]!.sat_code !== "01010101" && <span className="badge badge-soft" style={{ marginLeft: 2 }}>SAT</span>}
                      </button>}
                      {p.active === false && <button className="iconbtn sm" title={lang === "es" ? "Reactivar: vuelve a ofrecerse al armar pedidos" : "Reactivate: offer it again when building orders"} onClick={() => run(() => updateProduct(p.id, { active: true }))}><Icon name="refresh" size={15} /></button>}
                      <a className="iconbtn sm" href="/orders?new=1" title={personal ? (lang === "es" ? "A tarea" : "To task") : (lang === "es" ? "A pedido" : "To order")}><Icon name="orders" size={15} /></a>
                      <button className="iconbtn sm" onClick={() => run(() => deleteProduct(p.id))}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                  {!personal && tiersFor === p.id && (
                    <tr><td colSpan={5} style={{ background: "var(--surface-2)" }}>
                      <TierEditor product={p} lang={lang} onSave={(tiers) => run(() => updateProduct(p.id, { price_tiers: tiers }))} />
                    </td></tr>
                  )}
                  {fx && fiscalFor === p.id && (() => {
                    const f = fx.byId[p.id] ?? { sat_code: null, sat_unit: null, iva: null, linked: false };
                    return (
                      <tr><td colSpan={5} style={{ background: "var(--surface-2)" }}>
                        <div className="col gap-2" style={{ padding: "10px 4px" }}>
                          <div className="row gap-3" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                            <div className="col gap-1" style={{ flex: "1 1 260px", minWidth: 0 }}>
                              <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Clave SAT (8 dígitos)" : "SAT key (8 digits)"}</label>
                              <input key={f.sat_code ?? ""} className="inp-inline mono" style={{ width: 120 }} placeholder="01010101" maxLength={8} inputMode="numeric" defaultValue={f.sat_code ?? ""}
                                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (f.sat_code ?? "")) { if (v && !/^\d{8}$/.test(v)) { e.target.value = f.sat_code ?? ""; return; } run(() => updateProduct(p.id, { sat_code: v || null })); } }} />
                              <SatSearch businessId={businessId} kind="productos" lang={lang} onPick={(k) => run(() => updateProduct(p.id, { sat_code: k.clave }))} />
                            </div>
                            <div className="col gap-1" style={{ flex: "1 1 220px", minWidth: 0 }}>
                              <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Unidad SAT" : "SAT unit"}</label>
                              <input key={f.sat_unit ?? ""} className="inp-inline mono" style={{ width: 80 }} placeholder="E48" maxLength={3} defaultValue={f.sat_unit ?? ""}
                                onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== (f.sat_unit ?? "")) { if (v && !/^[A-Z0-9]{1,3}$/.test(v)) { e.target.value = f.sat_unit ?? ""; return; } run(() => updateProduct(p.id, { sat_unit: v || null })); } }} />
                              <SatSearch businessId={businessId} kind="unidades" lang={lang} onPick={(k) => run(() => updateProduct(p.id, { sat_unit: k.clave }))} />
                            </div>
                            <div className="col gap-1">
                              <label className="lbl" style={{ margin: 0 }}>IVA</label>
                              <select className="select" style={{ width: 170 }} value={f.iva == null ? "" : String(f.iva)}
                                onChange={(e) => run(() => updateProduct(p.id, { iva: e.target.value === "" ? null : Number(e.target.value) }))}>
                                <option value="">{lang === "es" ? "El del negocio" : "Business rate"}</option>
                                <option value="0.16">16%</option><option value="0.08">8%</option><option value="0">0%</option>
                              </select>
                              {f.linked && <span className="t-xs" style={{ color: "var(--green)", fontWeight: 600 }}>✓ {lang === "es" ? "Vinculado con Facturación" : "Linked to the invoicing account"}</span>}
                            </div>
                          </div>
                          <div className="t-xs muted">
                            {lang === "es"
                              ? "Con esto sale el concepto en la factura. Sin clave se usa 01010101 («No existe en el catálogo») y sin unidad E48 (servicio); H87 es pieza."
                              : "This is how the line appears on the invoice. With no key 01010101 is used, and with no unit E48 (service); H87 is piece."}
                          </div>
                        </div>
                      </td></tr>
                    );
                  })()}
                  </React.Fragment>
                ))}
                {view.length === 0 && <tr><td colSpan={personal ? 2 : 5} className="muted" style={{ textAlign: "center", padding: 24 }}>{personal ? (lang === "es" ? "Sin tareas repetitivas." : "No recurring tasks.") : (lang === "es" ? "Sin productos." : "No products.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nuevo" : "New"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={personal ? (lang === "es" ? "Nombre de la tarea" : "Task name") : (lang === "es" ? "Nombre" : "Name")} value={name} onChange={(e) => setName(e.target.value)} />
            {!personal && (
              <div className="row gap-2">
                <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="product">{lang === "es" ? "Producto" : "Product"}</option>
                  <option value="service">{lang === "es" ? "Servicio" : "Service"}</option>
                </select>
                <input className="inp-inline mono" style={{ width: 100 }} placeholder={lang === "es" ? "$ precio" : "$ price"} value={price} onChange={(e) => setPrice(e.target.value)} />
                <input className="inp-inline mono" style={{ width: 100 }} placeholder={lang === "es" ? "$ costo" : "$ cost"} title={lang === "es" ? "Lo que te cuesta (opcional) — se usa para la ganancia en reportes" : "What it costs you (optional) — used for profit in reports"} value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
            )}
            {fx && (
              <div className="col gap-2">
                <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start", color: "var(--text-muted)" }} onClick={() => setNewFiscal((v) => !v)}>
                  <Icon name="file" size={13} />{lang === "es" ? "Datos para facturar (opcional)" : "Invoicing data (optional)"}{(newSat || newUnit) ? ` · ${[newSat, newUnit].filter(Boolean).join(" / ")}` : ""}
                </button>
                {newFiscal && (
                  <div className="col gap-2" style={{ padding: 10, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                    <div className="col gap-1">
                      <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Clave SAT (8 dígitos)" : "SAT key (8 digits)"}</label>
                      <input className="inp-inline mono" style={{ width: 120 }} placeholder="01010101" maxLength={8} inputMode="numeric" value={newSat} onChange={(e) => setNewSat(e.target.value.replace(/\D/g, ""))} />
                      <SatSearch businessId={businessId} kind="productos" lang={lang} onPick={(k) => setNewSat(k.clave)} />
                    </div>
                    <div className="col gap-1">
                      <label className="lbl" style={{ margin: 0 }}>{lang === "es" ? "Unidad SAT" : "SAT unit"}</label>
                      <input className="inp-inline mono" style={{ width: 80 }} placeholder="E48" maxLength={3} value={newUnit} onChange={(e) => setNewUnit(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                      <SatSearch businessId={businessId} kind="unidades" lang={lang} onPick={(k) => setNewUnit(k.clave)} />
                    </div>
                  </div>
                )}
              </div>
            )}
            <button className="btn btn-primary btn-block" disabled={pending || !name.trim() || (!!fx && newSat.length > 0 && newSat.length !== 8)}
              onClick={() => {
                const fiscalNew = fx ? { sat_code: newSat.length === 8 ? newSat : null, sat_unit: newUnit || null } : {};
                run(() => createProduct(businessId, { name, kind, price: Number(price) || 0, cost: cost.trim() === "" ? null : Number(cost) || 0, ...fiscalNew }));
                setName(""); setPrice(""); setCost(""); setNewSat(""); setNewUnit(""); setNewFiscal(false);
              }}>
              <Icon name="plus" size={15} />{lang === "es" ? "Agregar" : "Add"}
            </button>
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}

/**
 * Buscador de claves del SAT por nombre ("playera", "pieza"). El SAT publica miles de claves y nadie
 * se las sabe: se escribe lo que se vende y se elige de la lista. La consulta sale del servidor
 * (la llave de Facturación nunca llega al navegador), con una pausa para no preguntar en cada
 * tecla. La lista va en línea, debajo del campo, así no hay nada flotante que se salga o se tape.
 */
function SatSearch({ businessId, kind, lang, onPick }: { businessId: string; kind: "productos" | "unidades"; lang: "es" | "en"; onPick: (k: SatKey) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SatKey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    const id = ++seq.current; // una respuesta vieja no pisa a la de lo último que se escribió
    if (text.length < 3) { setHits(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await searchSatKeys(businessId, kind, text).catch(() => [] as SatKey[]);
      if (seq.current === id) { setHits(r); setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, businessId, kind]);
  const es = lang === "es";
  return (
    <div className="col gap-1" style={{ maxWidth: 360 }}>
      <div className="field field-sm"><Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "productos" ? (es ? "Buscar clave por nombre: playera, lona…" : "Search key by name…") : (es ? "Buscar unidad: pieza, hora, metro…" : "Search unit: piece, hour…")} />
      </div>
      {q.trim().length >= 3 && (
        <div className="col scroll" style={{ maxHeight: 190, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
          {busy && !hits ? <span className="t-xs muted" style={{ padding: "8px 10px" }}>{es ? "Buscando…" : "Searching…"}</span>
            : !hits || hits.length === 0 ? <span className="t-xs muted" style={{ padding: "8px 10px" }}>{es ? "Sin resultados. Prueba con otra palabra." : "No results. Try another word."}</span>
            : hits.map((h) => (
              <button key={h.clave} type="button" className="row gap-2" onClick={() => { onPick(h); setQ(""); setHits(null); }}
                style={{ padding: "7px 10px", background: "none", border: "none", borderBottom: "1px solid var(--border)", textAlign: "left", cursor: "pointer", alignItems: "baseline", color: "var(--text)" }}>
                <span className="mono t-xs" style={{ fontWeight: 700, flex: "none" }}>{h.clave}</span>
                <span className="t-xs" style={{ minWidth: 0 }}>{h.nombre}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Quantity price tiers for a product: from N units, charge $X each. */
function TierEditor({ product, lang, onSave }: { product: Product; lang: "es" | "en"; onSave: (tiers: PriceTier[]) => void }) {
  const [tiers, setTiers] = useState<PriceTier[]>(product.price_tiers);
  const commit = (next: PriceTier[]) => onSave(next.filter((t) => t.min > 0).sort((a, b) => a.min - b.min));
  const update = (i: number, patch: Partial<PriceTier>) => { const next = tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)); setTiers(next); commit(next); };

  return (
    <div className="col gap-2" style={{ padding: "10px 4px" }}>
      <div className="t-xs muted">
        {lang === "es"
          ? `Base: $${product.price} c/u. A partir de la cantidad indicada se aplica el precio del tramo (gana el tramo más alto que alcance la cantidad).`
          : `Base: $${product.price} ea. From the given quantity, the tier price applies (the highest matching tier wins).`}
      </div>
      {tiers.map((t, i) => (
        <div className="row gap-2" key={i} style={{ alignItems: "center" }}>
          <span className="t-sm muted">{lang === "es" ? "Desde" : "From"}</span>
          <input className="inp-inline mono" style={{ width: 70 }} type="number" min={1} defaultValue={t.min || ""} placeholder="10" onBlur={(e) => update(i, { min: Number(e.target.value) || 0 })} />
          <span className="t-sm muted">{lang === "es" ? "unid. →" : "units →"}</span>
          <span className="t-sm muted">$</span>
          <input className="inp-inline mono" style={{ width: 90 }} type="number" min={0} defaultValue={t.price} onBlur={(e) => update(i, { price: Number(e.target.value) || 0 })} />
          <span className="t-sm muted">c/u</span>
          <button className="iconbtn sm" title={lang === "es" ? "Quitar" : "Remove"} onClick={() => { const next = tiers.filter((_, j) => j !== i); setTiers(next); commit(next); }}><Icon name="x" size={14} /></button>
        </div>
      ))}
      <button className="btn btn-sm btn-outline" style={{ alignSelf: "flex-start" }} onClick={() => setTiers([...tiers, { min: 0, price: product.price }])}><Icon name="plus" size={13} />{lang === "es" ? "Agregar tramo" : "Add tier"}</button>
    </div>
  );
}
