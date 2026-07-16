"use client";
import React, { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { testSendMessage } from "@/app/(app)/settings/cloud-actions";

// App Review send panel (gated) → whatsapp_business_messaging demo. Template management lives in
// its own TemplateManager. Uses the shared WHATSAPP_CLOUD_* test credentials via server actions.
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

  return (
    <div className="col gap-3" style={{ border: "1px dashed var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
      <div className="row gap-2">
        <Icon name="sliders" size={15} />
        <strong>{lang === "es" ? "WhatsApp API (oficial) · pruebas" : "WhatsApp API (official) · testing"}</strong>
      </div>
      <div className="t-xs muted">
        {lang === "es"
          ? "Panel para la Revisión de la app: envía un mensaje por la Cloud API."
          : "App Review panel: send a message via the Cloud API."}
      </div>

      {/* whatsapp_business_messaging */}
      <div className="col gap-2">
        <input className="inp-inline" placeholder={lang === "es" ? "Número con país, ej. 5215512345678" : "Number with country code"} value={to} onChange={(e) => setTo(e.target.value)} />
        <input className="inp-inline" placeholder={lang === "es" ? "Mensaje (si no hay ventana abierta, se envía hello_world)" : "Message (falls back to hello_world)"} value={msg} onChange={(e) => setMsg(e.target.value)} />
        <button className="btn btn-sm btn-primary" style={{ width: "fit-content" }} disabled={pending} onClick={send}>
          <Icon name="send" size={14} />{lang === "es" ? "Enviar" : "Send"}
        </button>
        <ResultLine res={sendRes} />
      </div>
    </div>
  );
}
