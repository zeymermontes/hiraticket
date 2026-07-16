"use client";
import React, { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { testSendMessage, testCreateTemplate } from "@/app/(app)/settings/cloud-actions";

// App Review test panel (gated). Two flows to record the required demo videos:
//   • Send message  → whatsapp_business_messaging
//   • Create template → whatsapp_business_management
// Uses the shared WHATSAPP_CLOUD_* test credentials via server actions.
type Res = { ok: boolean; text: string } | null;

function ResultLine({ res }: { res: Res }) {
  if (!res) return null;
  return (
    <div className="t-xs" style={{ color: res.ok ? "var(--green, #16a34a)" : "var(--red, #dc2626)", marginTop: 4, wordBreak: "break-word" }}>
      {res.text}
    </div>
  );
}

export function WaCloudTester() {
  const { lang } = useApp();
  const [pending, start] = useTransition();

  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  const [sendRes, setSendRes] = useState<Res>(null);

  const [tplName, setTplName] = useState("");
  const [tplCat, setTplCat] = useState("UTILITY");
  const [tplBody, setTplBody] = useState("");
  const [tplRes, setTplRes] = useState<Res>(null);

  const send = () =>
    start(async () => {
      setSendRes(null);
      const r = await testSendMessage(to, msg);
      setSendRes(
        r.ok
          ? { ok: true, text: (lang === "es" ? "Enviado ✓ id: " : "Sent ✓ id: ") + (((r.data as { messages?: { id: string }[] })?.messages?.[0]?.id) ?? "") }
          : { ok: false, text: r.error },
      );
    });

  const create = () =>
    start(async () => {
      setTplRes(null);
      const r = await testCreateTemplate(tplName, tplCat, tplBody);
      setTplRes(
        r.ok
          ? { ok: true, text: (lang === "es" ? "Plantilla creada ✓ estado: " : "Template created ✓ status: ") + (((r.data as { status?: string })?.status) ?? "") }
          : { ok: false, text: r.error },
      );
    });

  return (
    <div className="col gap-3" style={{ border: "1px dashed var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
      <div className="row gap-2">
        <Icon name="sliders" size={15} />
        <strong>{lang === "es" ? "WhatsApp API (oficial) · pruebas" : "WhatsApp API (official) · testing"}</strong>
      </div>
      <div className="t-xs muted">
        {lang === "es"
          ? "Panel para la Revisión de la app: envía un mensaje y crea una plantilla por la Cloud API."
          : "App Review panel: send a message and create a template via the Cloud API."}
      </div>

      {/* whatsapp_business_messaging */}
      <div className="col gap-2">
        <span className="t-sm"><strong>{lang === "es" ? "1. Enviar mensaje" : "1. Send message"}</strong></span>
        <input className="inp-inline" placeholder={lang === "es" ? "Número con país, ej. 5215512345678" : "Number with country code"} value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="inp-inline" placeholder={lang === "es" ? "Mensaje (si no hay ventana abierta, se envía hello_world)" : "Message (falls back to hello_world)"} value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn btn-sm btn-primary" style={{ width: "fit-content" }} disabled={pending} onClick={send}>
          <Icon name="send" size={14} />{lang === "es" ? "Enviar" : "Send"}
        </button>
        <ResultLine res={sendRes} />
      </div>

      {/* whatsapp_business_management */}
      <div className="col gap-2">
        <span className="t-sm"><strong>{lang === "es" ? "2. Crear plantilla" : "2. Create template"}</strong></span>
        <input className="inp-inline" placeholder={lang === "es" ? "Nombre (a-z, _), ej. confirmacion_pedido" : "Name (a-z, _)"} value={tplName} onChange={(e) => setTplName(e.target.value)} />
        <select className="inp-inline" value={tplCat} onChange={(e) => setTplCat(e.target.value)}>
          <option value="UTILITY">UTILITY</option>
          <option value="MARKETING">MARKETING</option>
        </select>
        <textarea className="inp-inline" rows={2} placeholder={lang === "es" ? "Cuerpo del mensaje" : "Message body"} value={tplBody} onChange={(e) => setTplBody(e.target.value)} />
        <button className="btn btn-sm btn-primary" style={{ width: "fit-content" }} disabled={pending} onClick={create}>
          <Icon name="plus" size={14} />{lang === "es" ? "Crear plantilla" : "Create template"}
        </button>
        <ResultLine res={tplRes} />
      </div>
    </div>
  );
}
