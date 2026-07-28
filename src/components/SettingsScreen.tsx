"use client";
import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearCache } from "@/lib/localCache";
import { Icon } from "@/components/Icon";
import { notifyPermission, requestNotifyPermission, desktopEnabled, setDesktopEnabled } from "@/lib/notify";
import { useConfirm } from "@/components/Confirm";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { WaSession } from "@/lib/whatsapp";
import { EmbeddedSignup } from "@/components/EmbeddedSignup";
import { WaCloudTester } from "@/components/WaCloudTester";
import { TemplateManager } from "@/components/TemplateManager";
import { connectSession, disconnectSession, addSession, setConnectMethod, deleteSession } from "@/app/(app)/settings/actions";

const WA_STATUS: Record<string, { color: PillColor; es: string; en: string }> = {
  connected: { color: "green", es: "Conectado", en: "Connected" },
  qr: { color: "amber", es: "Vincula tu teléfono", en: "Link your phone" },
  connecting: { color: "blue", es: "Conectando…", en: "Connecting…" },
  reconnecting: { color: "blue", es: "Reconectando…", en: "Reconnecting…" },
  disconnected: { color: "slate", es: "Desconectado", en: "Disconnected" },
};

function SessionCard({ session, primary }: { session: WaSession; primary?: boolean }) {
  const { lang } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const router = useRouter();
  const [, start] = useTransition();
  const [method, setMethod] = useState<"qr" | "pairing">(session.connect_method);
  const [phone, setPhone] = useState(session.phone ?? "");
  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  const st = WA_STATUS[session.status] ?? WA_STATUS.disconnected;
  const idle = session.status === "disconnected";
  const live = session.status === "connected";

  return (
    <div className="row gap-3" style={{ alignItems: "flex-start", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, background: live ? "var(--wa)" : "var(--surface-2)", color: live ? "#fff" : "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={live ? "whatsapp" : "wifioff"} size={20} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-2"><strong>{session.label}</strong>{primary && <Pill color="slate">{lang === "es" ? "Principal" : "Primary"}</Pill>}<Pill color={st.color} dot>{st[lang]}</Pill></div>
        <div className="t-sm muted mono">{session.phone ?? (lang === "es" ? "Sin número vinculado" : "No number linked")}</div>

        {idle && (
          <div className="col gap-2" style={{ marginTop: 10, maxWidth: 320 }}>
            <div className="seg" style={{ width: "fit-content" }}>
              <button className={method === "qr" ? "on" : ""} onClick={() => { setMethod("qr"); run(() => setConnectMethod(session.id, "qr")); }}>
                <Icon name="qr" size={14} />{lang === "es" ? "Código QR" : "QR code"}
              </button>
              <button className={method === "pairing" ? "on" : ""} onClick={() => setMethod("pairing")}>
                <Icon name="dot" size={14} />{lang === "es" ? "Código" : "Pairing code"}
              </button>
            </div>
            {method === "pairing" && (
              <input className="inp-inline" placeholder={lang === "es" ? "Número con país, ej. 5215512345678" : "Number with country code"} value={phone} onChange={(e) => setPhone(e.target.value)} />
            )}
          </div>
        )}

        {session.status === "qr" && session.pairing_code && (
          <div style={{ marginTop: 10 }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3 }}>{session.pairing_code}</div>
            <div className="t-xs muted" style={{ maxWidth: 240 }}>
              {lang === "es" ? "WhatsApp → Dispositivos vinculados → Vincular con número de teléfono → ingresa el código." : "WhatsApp → Linked devices → Link with phone number → enter the code."}
            </div>
          </div>
        )}

        {session.status === "qr" && !session.pairing_code && session.qr && (
          <div style={{ marginTop: 10 }}>
            <img
              width={200} height={200} alt="WhatsApp QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(session.qr)}`}
              style={{ borderRadius: 10, border: "1px solid var(--border)", background: "#fff", padding: 6 }}
            />
            <div className="t-xs muted" style={{ maxWidth: 220, marginTop: 6 }}>
              {lang === "es" ? "WhatsApp → Dispositivos vinculados → Vincular un dispositivo." : "WhatsApp → Linked devices → Link a device."}
            </div>
          </div>
        )}
      </div>

      <div className="row gap-2">
        {session.status === "connected" ? (
          <button className="btn btn-sm btn-outline" onClick={() => run(() => disconnectSession(session.id))}><Icon name="x" size={14} />{lang === "es" ? "Desconectar" : "Disconnect"}</button>
        ) : (
          <button className="btn btn-sm btn-primary"
            onClick={() => run(async () => { if (method === "pairing") await setConnectMethod(session.id, "pairing", phone); await connectSession(session.id); })}>
            <Icon name="qr" size={14} />{lang === "es" ? "Conectar" : "Connect"}
          </button>
        )}
        <button className="iconbtn sm" title={lang === "es" ? "Eliminar número" : "Delete number"}
          onClick={async () => { if (await ask({ icon: "trash", danger: true, title: lang === "es" ? "Eliminar número" : "Delete number", message: lang === "es" ? "Se desconecta esta sesión de WhatsApp." : "This WhatsApp session gets disconnected.", confirmLabel: lang === "es" ? "Eliminar" : "Delete", cancelLabel: lang === "es" ? "Volver" : "Back" })) run(() => deleteSession(session.id)); }}>
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

export function SettingsScreen({ businessId, sessions, isPlatformAdmin = false, showOfficial = false, fbAppId = "", esConfigId = "" }: { businessId: string; sessions: WaSession[]; isPlatformAdmin?: boolean; showOfficial?: boolean; fbAppId?: string; esConfigId?: string }) {
  const { lang, theme, setTheme, setLang, density, setDensity, brand, setBrand } = useApp();
  const router = useRouter();
  const [, start] = useTransition();

  // Notification sound mute (per-browser preference).
  const [muted, setMuted] = useState(false);
  useEffect(() => { try { setMuted(localStorage.getItem("ht_muteNotif") === "1"); } catch {} }, []);
  const setMute = (v: boolean) => { setMuted(v); try { localStorage.setItem("ht_muteNotif", v ? "1" : "0"); } catch {} };

  // Live-refresh while a connection is in progress (worker updates the row).
  const watching = sessions.some((s) => s.status === "connecting" || s.status === "qr" || s.status === "reconnecting");
  useEffect(() => {
    if (!watching) return;
    const iv = setInterval(() => router.refresh(), 3500);
    return () => clearInterval(iv);
  }, [watching, router]);

  // Live status: reflect connect/QR/connected/disconnected the moment the worker writes it.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout>;
    const bump = () => { clearTimeout(t); t = setTimeout(() => router.refresh(), 200); };
    const ch = supabase
      .channel(`wa-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_sessions", filter: `business_id=eq.${businessId}` }, bump)
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [businessId, router]);

  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Ajustes" : "Settings"}</h1></div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
       <div style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head">
            <Icon name="whatsapp" size={16} />
            <h4 className="grow">{lang === "es" ? "Conexión de WhatsApp" : "WhatsApp connection"}</h4>
            {/* Official-flow (allowlisted) accounts must never link via the unofficial bridge —
                hide the whatsmeow UI entirely (ban risk + App Review reviewers must not see it). */}
            {!showOfficial && (sessions.length === 0 ? (
              <button className="btn btn-sm btn-outline" onClick={() => run(() => addSession(businessId, lang === "es" ? "Número" : "Number"))}>
                <Icon name="plus" size={14} />{lang === "es" ? "Agregar número" : "Add number"}
              </button>
            ) : (
              // TEMP: one number per business for now (mirrors the addSession server cap).
              <Pill color="slate">{lang === "es" ? "1 número por cuenta" : "1 number per account"}</Pill>
            ))}
          </div>
          <div className="ws-block-body col gap-3">
            {showOfficial && (
              <div className="col gap-2" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14, background: "var(--surface-2)" }}>
                <div className="row gap-2">
                  <Icon name="whatsapp" size={16} />
                  <strong>{lang === "es" ? "WhatsApp oficial (Meta)" : "Official WhatsApp (Meta)"}</strong>
                  <Pill color="green">{lang === "es" ? "Recomendado" : "Recommended"}</Pill>
                </div>
                <div className="t-sm muted">
                  {lang === "es"
                    ? "Conecta tu número por la API oficial de Meta. Mantienes WhatsApp en tu teléfono (coexistencia) y habilitas plantillas, campañas y agentes, sin riesgo de baneo."
                    : "Connect via Meta's official API. Keep WhatsApp on your phone (coexistence) and enable templates, campaigns and agents, with no ban risk."}
                </div>
                <EmbeddedSignup appId={fbAppId} configId={esConfigId} />
              </div>
            )}
            {showOfficial && <WaCloudTester />}
            {!showOfficial && sessions.length === 0 && <div className="muted t-sm">{lang === "es" ? "Sin números." : "No numbers."}</div>}
            {!showOfficial && sessions.map((s, i) => <SessionCard key={s.id} session={s} primary={i === 0} />)}
            {!showOfficial && (
              <div className="t-xs muted">
                {lang === "es"
                  ? "Conecta el número de tu negocio para recibir y responder mensajes de tus clientes."
                  : "Connect your business number to receive and reply to your customers' messages."}
              </div>
            )}
          </div>
        </section>

        {showOfficial && (
          <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
            <div className="ws-block-head">
              <Icon name="whatsapp" size={16} />
              <h4 className="grow">{lang === "es" ? "Plantillas de WhatsApp" : "WhatsApp templates"}</h4>
            </div>
            <div className="ws-block-body">
              <TemplateManager />
            </div>
          </section>
        )}

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
                <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>Español</button>
                <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>English</button>
              </div>
            </div>
            <div className="row gap-2"><span className="grow">{lang === "es" ? "Densidad" : "Density"}</span>
              <div className="seg">
                <button className={density === "comfortable" ? "on" : ""} onClick={() => setDensity("comfortable")}>{lang === "es" ? "Cómodo" : "Comfortable"}</button>
                <button className={density === "compact" ? "on" : ""} onClick={() => setDensity("compact")}>{lang === "es" ? "Compacto" : "Compact"}</button>
              </div>
            </div>
            <div className="row gap-2"><span className="grow">{lang === "es" ? "Color de marca" : "Brand color"}</span>
              <div className="row gap-2">
                {[["", "#F5C518"], ["#0E8C82", "#0E8C82"], ["#2563EB", "#2563EB"], ["#7C3AED", "#7C3AED"]].map(([val, col]) => (
                  <button key={col} onClick={() => setBrand(val)} aria-label="brand" style={{ width: 26, height: 26, borderRadius: "50%", background: col, border: (brand === val ? "2px solid var(--text)" : "2px solid var(--border)"), cursor: "pointer" }} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="bell" size={16} /><h4>{lang === "es" ? "Notificaciones" : "Notifications"}</h4></div>
          <div className="ws-block-body col gap-3">
            <div className="row gap-2">
              <span className="grow">{lang === "es" ? "Sonido de notificaciones" : "Notification sound"}<span className="t-xs muted" style={{ display: "block" }}>{lang === "es" ? "Tono corto al recibir una notificación asignada a ti" : "Short chime on a notification assigned to you"}</span></span>
              <div className="seg">
                <button className={!muted ? "on" : ""} onClick={() => setMute(false)}>{lang === "es" ? "Activado" : "On"}</button>
                <button className={muted ? "on" : ""} onClick={() => setMute(true)}><Icon name="x" size={13} />{lang === "es" ? "Silenciado" : "Muted"}</button>
              </div>
            </div>
            <DesktopNotifRow lang={lang} />
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="store" size={16} /><h4>{lang === "es" ? "Áreas y etapas" : "Areas & stages"}</h4></div>
          <div className="ws-block-body col gap-2">
            <p className="muted t-sm">{lang === "es" ? "Las áreas, etapas y tu vertical se configuran en Negocio." : "Areas, stages and your vertical are configured in Business."}</p>
            <a className="btn btn-outline btn-block" href="/business"><Icon name="store" size={15} />{lang === "es" ? "Ir a Negocio" : "Go to Business"}</a>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="lock" size={16} /><h4>{lang === "es" ? "Cuenta" : "Account"}</h4></div>
          <div className="ws-block-body col gap-2">
            {isPlatformAdmin && <a className="btn btn-outline btn-block" href="/platform"><Icon name="shield" size={15} />{lang === "es" ? "Consola de plataforma" : "Platform console"}</a>}
            <a className="btn btn-outline btn-block" href="/logout" onClick={() => { clearCache().catch(() => {}); }}><Icon name="lock" size={15} />{lang === "es" ? "Cerrar sesión" : "Sign out"}</a>
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}

/** Notificaciones del sistema: estado del permiso + interruptor.
 *
 *  Existe porque el intento silencioso al primer clic no basta: Chrome le muestra un aviso
 *  discreto en la barra —no un modal— a quien ya bloqueó notificaciones en otros sitios, así que
 *  varios miembros del equipo nunca vieron nada que aceptar. Aquí el permiso se pide desde un
 *  botón, que es un gesto explícito y siempre abre el diálogo del navegador. */
function DesktopNotifRow({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { setPerm(notifyPermission()); setEnabled(desktopEnabled()); }, []);

  const enable = async () => {
    const r = await requestNotifyPermission();
    setPerm(r);
    if (r === "granted") { setDesktopEnabled(true); setEnabled(true); }
  };
  const set = (v: boolean) => { setDesktopEnabled(v); setEnabled(v); };

  return (
    <div className="row gap-2">
      <span className="grow">
        {es ? "Notificaciones del sistema" : "System notifications"}
        <span className="t-xs muted" style={{ display: "block" }}>
          {perm === "unsupported"
            ? (es ? "Tu navegador no las soporta" : "Your browser doesn't support them")
            : perm === "denied"
              ? (es ? "Bloqueadas en el navegador — actívalas en el candado de la barra de direcciones" : "Blocked in the browser — enable them from the padlock in the address bar")
              : (es ? "Avisa aunque tengas la pestaña en segundo plano" : "Alerts you even when the tab is in the background")}
        </span>
      </span>
      {perm === "granted" ? (
        <div className="seg">
          <button className={enabled ? "on" : ""} onClick={() => set(true)}>{es ? "Activado" : "On"}</button>
          <button className={!enabled ? "on" : ""} onClick={() => set(false)}><Icon name="x" size={13} />{es ? "Apagado" : "Off"}</button>
        </div>
      ) : (
        <button className="btn btn-sm btn-outline" disabled={perm === "denied" || perm === "unsupported"} onClick={enable}>
          <Icon name="bell" size={14} />{es ? "Permitir" : "Allow"}
        </button>
      )}
    </div>
  );
}
