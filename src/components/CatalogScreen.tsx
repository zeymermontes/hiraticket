"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Product } from "@/lib/extras";
import { createProduct, updateProduct, deleteProduct } from "@/app/(app)/features-actions";

export function CatalogScreen({ businessId, products }: { businessId: string; products: Product[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState("product");
  const [q, setQ] = useState("");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });
  const view = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Catálogo" : "Catalog"}</h1><Pill color="slate" large>{products.length}</Pill></div>
      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="store" size={16} /><h4 className="grow">{lang === "es" ? "Productos y servicios" : "Products & services"}</h4>
            <div className="field field-sm" style={{ width: 180 }}><Icon name="search" /><input placeholder={lang === "es" ? "Buscar…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>{lang === "es" ? "Nombre" : "Name"}</th><th>{lang === "es" ? "Tipo" : "Type"}</th><th>{lang === "es" ? "Precio" : "Price"}</th><th></th></tr></thead>
              <tbody>
                {view.map((p) => (
                  <tr key={p.id}>
                    <td><input className="inp-inline grow" defaultValue={p.name} style={{ width: "100%" }} onBlur={(e) => { if (e.target.value !== p.name) run(() => updateProduct(p.id, { name: e.target.value })); }} /></td>
                    <td><Pill color={p.kind === "service" ? "violet" : "blue"}>{p.kind === "service" ? (lang === "es" ? "Servicio" : "Service") : (lang === "es" ? "Producto" : "Product")}</Pill></td>
                    <td><input className="inp-inline mono" style={{ width: 90 }} defaultValue={String(p.price)} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v !== p.price) run(() => updateProduct(p.id, { price: v })); }} /></td>
                    <td className="row gap-1">
                      <a className="iconbtn sm" href="/orders?new=1" title={lang === "es" ? "A pedido" : "To order"}><Icon name="orders" size={15} /></a>
                      <button className="iconbtn sm" onClick={() => run(() => deleteProduct(p.id))}><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
                {view.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>{lang === "es" ? "Sin productos." : "No products."}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nuevo" : "New"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Nombre" : "Name"} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="row gap-2">
              <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="product">{lang === "es" ? "Producto" : "Product"}</option>
                <option value="service">{lang === "es" ? "Servicio" : "Service"}</option>
              </select>
              <input className="inp-inline mono" style={{ width: 100 }} placeholder="$" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
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
