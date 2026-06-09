"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { CannedMessage } from "@/lib/canned";
import { createCanned, updateCanned, deleteCanned } from "@/app/(app)/canned/actions";

export function CannedScreen({ businessId, items }: { businessId: string; items: CannedMessage[] }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("General");
  const [shortcut, setShortcut] = useState("");

  function add() {
    if (!title.trim() || !body.trim()) return;
    start(async () => {
      await createCanned(businessId, { title, body, category, shortcut });
      setTitle(""); setBody(""); setShortcut("");
      router.refresh();
    });
  }

  return (
    <div className="page">
      <div className="phead">
        <h1>{lang === "es" ? "Plantillas" : "Templates"}</h1>
        <Pill color="slate" large>{items.length}</Pill>
      </div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="canned" size={16} /><h4>{lang === "es" ? "Mensajes guardados" : "Saved messages"}</h4></div>
          <div className="ws-block-body col gap-2">
            {items.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin plantillas." : "No templates."}</div>}
            {items.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 12 }}>
                <div className="row gap-2">
                  <strong>{c.title}</strong>
                  {c.category && <Pill color="violet">{c.category}</Pill>}
                  {c.shortcut && <span className="mono t-xs muted">{c.shortcut}</span>}
                  <span className="grow" />
                  <button className="iconbtn sm" onClick={() => start(async () => { await deleteCanned(c.id); router.refresh(); })}><Icon name="trash" size={15} /></button>
                </div>
                <textarea className="inp-inline" style={{ width: "100%", marginTop: 8, height: "auto", padding: 8 }} rows={2} defaultValue={c.body}
                  onBlur={(e) => { if (e.target.value !== c.body) start(async () => { await updateCanned(c.id, { body: e.target.value }); router.refresh(); }); }} />
              </div>
            ))}
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="plus" size={16} /><h4>{lang === "es" ? "Nueva plantilla" : "New template"}</h4></div>
          <div className="ws-block-body col gap-2">
            <input className="inp-inline" placeholder={lang === "es" ? "Título" : "Title"} value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="row gap-2">
              <input className="inp-inline grow" placeholder={lang === "es" ? "Categoría" : "Category"} value={category} onChange={(e) => setCategory(e.target.value)} />
              <input className="inp-inline" style={{ width: 100 }} placeholder="/atajo" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
            </div>
            <textarea className="inp-inline" style={{ height: "auto", padding: 8 }} rows={4} placeholder={lang === "es" ? "Cuerpo… usa {{name}}, {{order_number}}" : "Body… use {{name}}, {{order_number}}"} value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="btn btn-primary btn-block" disabled={pending || !title.trim() || !body.trim()} onClick={add}><Icon name="plus" size={15} />{lang === "es" ? "Crear" : "Create"}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
