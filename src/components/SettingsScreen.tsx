"use client";
import React, { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { WaSession } from "@/lib/whatsapp";
import { connectSession, disconnectSession, addSession } from "@/app/(app)/settings/actions";

const WA_STATUS: Record<string, { color: PillColor; es: string; en: string }> = {
  connected: { color: "green", es: "Conectado", en: "Connected" },
  qr: { color: "amber", es: "Escanea el QR", en: "Scan the QR" },
  connecting: { color: "blue", es: "Conectando…", en: "Connecting…" },
  reconnecting: { color: "blue", es: "Reconectando…", en: "Reconnecting…" },
  disconnected: { color: "slate", es: "Desconectado", en: "Disconnected" },
};

export function SettingsScreen({ businessId, sessions }: { businessId: string; sessions: WaSession[] }) {
  const { lang, theme, setTheme, setLang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();

  // Live-refresh while a connection is in progress (worker updates the row).
  const watching = sessions.some((s) => s.status === "connecting" || s.status === "qr");
  useEffect(() => {
    if (!watching) return;
    const iv = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(iv);
  }, [watching, router]);

  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Ajustes" : "Settings"}</h1></div>

      <div className="scroll" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* WhatsApp */}
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head">
            <Icon name="whatsapp" size={16} />
            <h4 className="grow">{lang === "es" ? "Conexión de WhatsApp" : "WhatsApp connection"}</h4>
            <button className="btn btn-sm btn-outline" onClick={() => run(() => addSession(businessId, lang === "es" ? "Número" : "Number"))}>
              <Icon name="plus" size={14} />{lang === "es" ? "Agregar número" : "Add number"}
            </button>
          </div>
          <div className="ws-block-body col gap-3">
            {sessions.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin números." : "No numbers."}</div>}
            {sessions.map((s) => {
              const st = WA_STATUS[s.status] ?? WA_STATUS.disconnected;
              return (
                <div key={s.id} className="row gap-3" style={{ alignItems: "flex-start", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--wa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    <Icon name="whatsapp" size={20} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row gap-2"><strong>{s.label}</strong><Pill color={st.color} dot>{st[lang]}</Pill></div>
                    <div className="t-sm muted mono">{s.phone ?? (lang === "es" ? "Sin número vinculado" : "No number linked")}</div>

                    {s.status === "qr" && s.qr && (
                      <div style={{ marginTop: 10 }}>
                        <img
                          width={200} height={200} alt="WhatsApp QR"
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(s.qr)}`}
                          style={{ borderRadius: 10, border: "1px solid var(--border)", background: "#fff", padding: 6 }}
                        />
                        <div className="t-xs muted" style={{ maxWidth: 220, marginTop: 6 }}>
                          {lang === "es" ? "WhatsApp → Dispositivos vinculados → Vincular un dispositivo." : "WhatsApp → Linked devices → Link a device."}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="row gap-2">
                    {s.status === "connected" ? (
                      <button className="btn btn-sm btn-outline" onClick={() => run(() => disconnectSession(s.id))}><Icon name="x" size={14} />{lang === "es" ? "Desconectar" : "Disconnect"}</button>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => run(() => connectSession(s.id))}><Icon name="qr" size={14} />{lang === "es" ? "Conectar" : "Connect"}</button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="t-xs muted">
              {lang === "es"
                ? "El worker de WhatsApp debe estar corriendo para generar el QR y enviar/recibir mensajes."
                : "The WhatsApp worker must be running to generate the QR and send/receive messages."}
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="sliders" size={16} /><h4>{lang === "es" ? "Apariencia" : "Appearance"}</h4></div>
          <div className="ws-block-body col gap-3">
            <div className="row gap-2"><span className="grow">{lang === "es" ? "Tema" : "Theme"}</span>
              <div className="seg">
                <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}><Icon name="sun" size={14} />{lang === "es" ? "Claro" : "Light"}</button>
                <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}><Icon name="moon" size={14} />{lang === "es" ? "Oscuro" : "Dark"}</button>
              </div>
            </div>
            <div className="row gap-2"><span className="grow">{lang === "es" ? "Idioma" : "Language"}</span>
              <div className="seg">
                <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
                <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
              </div>
            </div>
          </div>
        </section>

        {/* Account */}
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="lock" size={16} /><h4>{lang === "es" ? "Cuenta" : "Account"}</h4></div>
          <div className="ws-block-body col gap-2">
            <a className="btn btn-outline btn-block" href="/platform"><Icon name="shield" size={15} />{lang === "es" ? "Consola de plataforma" : "Platform console"}</a>
            <a className="btn btn-outline btn-block" href="/logout"><Icon name="lock" size={15} />{lang === "es" ? "Cerrar sesión" : "Sign out"}</a>
          </div>
        </section>
      </div>
    </div>
  );
}
