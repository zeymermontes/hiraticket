"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Product } from "@/lib/extras";
import type { PriceTier } from "@/lib/types";
import { createProduct, updateProduct, deleteProduct } from "@/app/(app)/features-actions";

export function CatalogScreen({ businessId, products }: { businessId: string; products: Product[] }) {
  const { lang, personal } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState("product");
  const [q, setQ] = useState("");
  const [tiersFor, setTiersFor] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const view = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <div className="phead"><h1>{personal ? (lang === "es" ? "Tareas repetitivas" : "Recurring tasks") : (lang === "es" ? "Catálogo" : "Catalog")}</h1><Pill color="slate" large>{products.length}</Pill></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="store" size={16} /><h4 className="grow">{personal ? (lang === "es" ? "Tareas repetitivas" : "Recurring tasks") : (lang === "es" ? "Productos y servicios" : "Products & services")}</h4>
            <div className="field field-sm" style={{ width: 180 }}><Icon name="search" /><input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>{lang === "es" ? "Nombre" : "Name"}</th>{!personal && <th>{lang === "es" ? "Tipo" : "Type"}</th>}{!personal && <th>{lang === "es" ? "Precio" : "Price"}</th>}<th></th></tr></thead>
              <tbody>
                {view.map((p) => (
                  <React.Fragment key={p.id}>
                  <tr>
                    <td><input className="inp-inline grow" defaultValue={p.name} style={{ width: "100%" }} onBlur={(e) => { if (e.target.value !== p.name) run(() => updateProduct(p.id, { name: e.target.value })); }} /></td>
                    {!personal && <td><Pill color={p.kind === "service" ? "violet" : "blue"}>{p.kind === "service" ? (lang === "es" ? "Servicio" : "Service") : (lang === "es" ? "Producto" : "Product")}</Pill></td>}
                    {!personal && <td><input className="inp-inline mono" style={{ width: 90 }} defaultValue={String(p.price)} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v !== p.price) run(() => updateProduct(p.id, { price: v })); }} /></td>}
                    <td className="row gap-1">
                      {!personal && <button className={"iconbtn sm" + (tiersFor === p.id ? " active" : "")} title={lang === "es" ? "Precios por cantidad" : "Quantity pricing"} onClick={() => setTiersFor(tiersFor === p.id ? null : p.id)}>
                        <Icon name="layers" size={15} />{p.price_tiers.length > 0 && <span className="badge badge-soft" style={{ marginLeft: 2 }}>{p.price_tiers.length}</span>}
                      </button>}
                      <a className="iconbtn sm" href="/orders?new=1" title={personal ? (lang === "es" ? "A tarea" : "To task") : (lang === "es" ? "A pedido" : "To order")}><Icon name="orders" size={15} /></a>
                      <button className="iconbtn sm" onClick={() => run(() => deleteProduct(p.id))}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                  {!personal && tiersFor === p.id && (
                    <tr><td colSpan={4} style={{ background: "var(--surface-2)" }}>
                      <TierEditor product={p} lang={lang} onSave={(tiers) => run(() => updateProduct(p.id, { price_tiers: tiers }))} />
                    </td></tr>
                  )}
                  </React.Fragment>
                ))}
                {view.length === 0 && <tr><td colSpan={personal ? 2 : 4} className="muted" style={{ textAlign: "center", padding: 24 }}>{personal ? (lang === "es" ? "Sin tareas repetitivas." : "No recurring tasks.") : (lang === "es" ? "Sin productos." : "No products.")}</td></tr>}
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
                <input className="inp-inline mono" style={{ width: 100 }} placeholder="$" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            )}
            <button className="btn btn-primary btn-block" disabled={pending || !name.trim()}
              onClick={() => { run(() => createProduct(businessId, { name, kind, price: Number(price) || 0 })); setName(""); setPrice(""); }}>
              <Icon name="plus" size={15} />{lang === "es" ? "Agregar" : "Add"}
            </button>
          </div>
        </section>
      </div>
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
