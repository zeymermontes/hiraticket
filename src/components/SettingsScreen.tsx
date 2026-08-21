"use client";
import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearCache } from "@/lib/localCache";
import { clearMediaCache } from "@/lib/mediaCache";
import { PALETTE_GROUPS } from "@/lib/palette";
import { Icon } from "@/components/Icon";
import { notifyPermission, requestNotifyPermission, desktopEnabled, setDesktopEnabled,
  pushSupported, subscribeToPush, unsubscribeFromPush, currentPushEndpoint } from "@/lib/notify";
import { isStandalone } from "@/lib/useIsMobile";
import { savePushSubscription, removePushSubscription, removePushDevice, listPushDevices, type PushDevice } from "@/app/(app)/settings/push-actions";
import { DEFAULT_NOTIF_PREFS, type NotifPrefs } from "@/lib/notifPrefs";
import { loadNotifPrefs, saveNotifPrefs } from "@/app/(app)/settings/notif-actions";
import { NOTIF_PREFS_EVENT } from "@/components/RealtimeNotifier";
import { useConfirm } from "@/components/Confirm";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { WaSession } from "@/lib/whatsapp";
import { EmbeddedSignup } from "@/components/EmbeddedSignup";
import { WaCloudTester } from "@/components/WaCloudTester";
import { TemplateManager } from "@/components/TemplateManager";
import { connectSession, disconnectSession, addSession, setConnectMethod, deleteSession } from "@/app/(app)/settings/actions";
import { updateBusinessProfile } from "@/app/(app)/business/actions";

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
  const official = session.connect_method === "official";
  const [method, setMethod] = useState<"qr" | "pairing">(session.connect_method === "official" ? "qr" : session.connect_method);
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
        <div className="row gap-2"><strong>{session.label}</strong>{official
          ? <Pill color="green">{lang === "es" ? "API oficial" : "Official API"}</Pill>
          // Antes solo el oficial decía su vía, así que un número por QR no se distinguía de nada:
          // había que deducirlo por ausencia. Ahora cada número dice por dónde está conectado.
          : <Pill color="amber">{lang === "es" ? "No oficial (QR)" : "Unofficial (QR)"}</Pill>
        }{primary && <Pill color="slate">{lang === "es" ? "Principal" : "Primary"}</Pill>}<Pill color={st.color} dot>{st[lang]}</Pill></div>
        <div className="t-sm muted mono">{session.phone ?? (lang === "es" ? "Sin número vinculado" : "No number linked")}</div>
        {official && (
          <div className="t-xs muted" style={{ marginTop: 4, maxWidth: 340 }}>
            {lang === "es"
              ? "Conectado por la API de Meta (coexistence): tu número sigue funcionando en el teléfono."
              : "Connected via Meta's API (coexistence): the number keeps working on your phone."}
          </div>
        )}

        {idle && !official && (
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
            onClick={() => run(async () => { if (!official && method === "pairing") await setConnectMethod(session.id, "pairing", phone); await connectSession(session.id); })}>
            <Icon name={official ? "whatsapp" : "qr"} size={14} />{lang === "es" ? "Conectar" : "Connect"}
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

export function SettingsScreen({ businessId, sessions, stages = [], doneFromStageId = null, confirmPaymentStageId = null, confirmPaymentEnabled = true, isPlatformAdmin = false, showOfficial = false, fbAppId = "", esConfigId = "" }: { businessId: string; sessions: WaSession[]; stages?: { id: string; name: string }[]; doneFromStageId?: string | null; confirmPaymentStageId?: string | null; confirmPaymentEnabled?: boolean; isPlatformAdmin?: boolean; showOfficial?: boolean; fbAppId?: string; esConfigId?: string }) {
  const { lang, theme, setTheme, setLang, density, setDensity, brand, setBrand, personal } = useApp();
  const [doneFrom, setDoneFrom] = useState<string | null>(doneFromStageId);
  useEffect(() => { setDoneFrom(doneFromStageId); }, [doneFromStageId]);
  const [confirmPayStage, setConfirmPayStage] = useState<string | null>(confirmPaymentStageId);
  useEffect(() => { setConfirmPayStage(confirmPaymentStageId); }, [confirmPaymentStageId]);
  const [confirmPayOn, setConfirmPayOn] = useState(confirmPaymentEnabled);
  useEffect(() => { setConfirmPayOn(confirmPaymentEnabled); }, [confirmPaymentEnabled]);
  const router = useRouter();
  const [, start] = useTransition();

  // Las dos vías de conexión, separadas una sola vez: se consultan en cuatro sitios de esta pantalla
  // (el distintivo de la cabecera, las tarjetas oficiales, el aviso de "ya hay un número por QR" y
  // la lista no oficial) y repetir el filtro en cada uno es justo como se acaban desincronizando.
  const officialSessions = sessions.filter((s) => s.connect_method === "official");
  const bridgeSessions = sessions.filter((s) => s.connect_method !== "official");

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
       <div className="page-grid" style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <section className="ws-block" style={{ gridColumn: "1 / -1" }}>
          <div className="ws-block-head">
            <Icon name="whatsapp" size={16} />
            <h4 className="grow">{lang === "es" ? "Conexión de WhatsApp" : "WhatsApp connection"}</h4>
            {/* Por qué vía está conectada la organización. No se decía en ninguna parte, y hace
                falta saberlo ANTES de conectar Meta API: en cuanto el negocio tiene número oficial
                ya no se pueden añadir números por QR (el guarda de settings/actions.ts lo impide),
                así que descubrirlo al intentarlo es tarde. */}
            {sessions.length > 0 && (
              <Pill color={officialSessions.length > 0 ? "green" : "amber"}>
                {officialSessions.length > 0 && bridgeSessions.length > 0
                  ? (lang === "es" ? "Meta API + QR" : "Meta API + QR")
                  : officialSessions.length > 0
                    ? (lang === "es" ? "Usa Meta API" : "Using Meta API")
                    : (lang === "es" ? "Usa QR (no oficial)" : "Using QR (unofficial)")}
              </Pill>
            )}
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
            {/* Official (Cloud API) sessions render for everyone; the ES connect box only until one is live. */}
            {officialSessions.map((s, i) => (
              <SessionCard key={s.id} session={s} primary={i === 0} />
            ))}
            {/* En una cuenta del allowlist la UI de whatsmeow se esconde ENTERA, así que un número
                ya vinculado por QR era completamente invisible: se podía conectar Meta API sin
                saber que el negocio ya tenía uno. Aquí se muestra solo como información —- sin
                ningún control, que es lo que el camino oficial no debe poder tocar. */}
            {showOfficial && bridgeSessions.length > 0 && (
              <div className="col gap-1" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14, background: "var(--surface-2)" }}>
                <div className="row gap-2">
                  <Icon name="wifioff" size={15} />
                  <strong>{lang === "es" ? "Esta cuenta ya tiene un número por QR" : "This account already has a QR-linked number"}</strong>
                  <Pill color="amber">{lang === "es" ? "No oficial" : "Unofficial"}</Pill>
                </div>
                <div className="t-sm muted mono">
                  {bridgeSessions.map((s) => s.phone ?? s.label).join(", ")}
                </div>
                <div className="t-xs muted">
                  {lang === "es"
                    ? "Se muestra solo como información: los controles de la vinculación por QR no están disponibles en una cuenta del camino oficial."
                    : "Shown for information only: QR-linking controls aren't available on an official-path account."}
                </div>
              </div>
            )}
            {showOfficial && !officialSessions.some((s) => s.status === "connected") && (
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
            {!showOfficial && bridgeSessions.map((s, i) => <SessionCard key={s.id} session={s} primary={i === 0} />)}
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
            <div className="col gap-2">
              <span>{lang === "es" ? "Color de marca" : "Brand color"}
                <span className="t-xs muted" style={{ display: "block" }}>
                  {lang === "es" ? "Solo cambia cómo la ves tú, en este navegador. No afecta a tu equipo." : "Only changes how you see it, in this browser. Doesn't affect your team."}
                </span>
              </span>
              {/* Los tres tonos de un matiz van pegados; el espacio grande separa un matiz del otro. */}
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                <button onClick={() => setBrand("")} aria-label="default" aria-pressed={brand === ""}
                  title={lang === "es" ? "Amarillo Hirata (predeterminado)" : "Hirata yellow (default)"}
                  style={{ width: 24, height: 24, borderRadius: 6, background: "#F5C518", border: brand === "" ? "2px solid var(--text)" : "2px solid var(--border)", cursor: "pointer" }} />
                {PALETTE_GROUPS.map((group) => (
                  <div key={group[1]} className="row" style={{ gap: 2 }}>
                    {group.map((c) => (
                      <button key={c} onClick={() => setBrand(c)} title={c} aria-label={c} aria-pressed={brand === c}
                        style={{ width: 24, height: 24, borderRadius: 6, background: c, border: brand === c ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="ws-block">
          <div className="ws-block-head"><Icon name="calendar" size={16} /><h4>{lang === "es" ? "Agenda y entregas" : "Agenda & deliveries"}</h4></div>
          <div className="ws-block-body col gap-3">
            <div className="row gap-2">
              <span className="grow">
                {personal ? (lang === "es" ? "Una tarea sale de la agenda al llegar a" : "A task leaves the agenda at") : (lang === "es" ? "Un pedido sale de la agenda al llegar a" : "An order leaves the agenda at")}
                <span className="t-xs muted" style={{ display: "block" }}>
                  {lang === "es"
                    ? "Esa etapa y las siguientes cuentan como terminado: fuera del calendario, las banderitas y el contador de abiertos. Cada " + (personal ? "tarea" : "pedido") + " puede cambiarlo en su detalle."
                    : "That stage and later ones count as done: out of the calendar, the flags and the open counter. Each one can override it in its detail."}
                </span>
              </span>
              <select className="inp-inline" style={{ width: 200 }} value={doneFrom ?? ""}
                onChange={(e) => { const v = e.target.value || null; setDoneFrom(v); start(async () => { await updateBusinessProfile(businessId, { done_from_stage_id: v }); router.refresh(); }); }}>
                <option value="">{lang === "es" ? "Última etapa (por defecto)" : "Last stage (default)"}</option>
                {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
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
            <PushRow lang={lang} />
            <NotifPrefsRows lang={lang} />
          </div>
        </section>

        {!personal && (
          <section className="ws-block">
            <div className="ws-block-head"><Icon name="orders" size={16} /><h4>{lang === "es" ? "Confirmar pago" : "Confirm payment"}</h4></div>
            <div className="ws-block-body col gap-3">
              <div className="row gap-2">
                <span className="grow">
                  {lang === "es" ? "Preguntar si se marca pagado al llegar a una etapa" : "Ask to mark paid when it reaches a stage"}
                  <span className="t-xs muted" style={{ display: "block" }}>
                    {lang === "es"
                      ? "Sin importar cómo llegue ahí un pedido (kanban, su detalle, o un cambio masivo), se le pregunta a quien lo mueve si ya se debe marcar pagado."
                      : "However an order gets there (kanban, its detail, or a bulk change), whoever moves it gets asked if it should be marked paid."}
                  </span>
                </span>
                <div className="seg">
                  <button className={confirmPayOn ? "on" : ""} onClick={() => { setConfirmPayOn(true); start(async () => { await updateBusinessProfile(businessId, { confirm_payment_enabled: true }); router.refresh(); }); }}>{lang === "es" ? "Activado" : "On"}</button>
                  <button className={!confirmPayOn ? "on" : ""} onClick={() => { setConfirmPayOn(false); start(async () => { await updateBusinessProfile(businessId, { confirm_payment_enabled: false }); router.refresh(); }); }}><Icon name="x" size={13} />{lang === "es" ? "Apagado" : "Off"}</button>
                </div>
              </div>
              <div className="row gap-2" style={{ opacity: confirmPayOn ? 1 : 0.45, paddingLeft: 10 }}>
                <span className="grow">
                  {lang === "es" ? "Etapa" : "Stage"}
                  <span className="t-xs muted" style={{ display: "block" }}>
                    {lang === "es"
                      ? "Un flujo puede contestar esto por adelantado desde su propia configuración, en Flujos — eso sigue aplicando aunque esto esté apagado."
                      : "A flow can pre-answer this from its own settings, in Flows — that still applies even with this off."}
                  </span>
                </span>
                <select className="inp-inline" style={{ width: 200 }} value={confirmPayStage ?? ""} disabled={!confirmPayOn}
                  onChange={(e) => { const v = e.target.value || null; setConfirmPayStage(v); start(async () => { await updateBusinessProfile(businessId, { confirm_payment_stage_id: v }); router.refresh(); }); }}>
                  <option value="">{lang === "es" ? "Última etapa (por defecto)" : "Last stage (default)"}</option>
                  {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                </select>
              </div>
            </div>
          </section>
        )}

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
            <a className="btn btn-outline btn-block" href="/logout" onClick={() => { clearCache().catch(() => {}); clearMediaCache().catch(() => {}); }}><Icon name="lock" size={15} />{lang === "es" ? "Cerrar sesión" : "Sign out"}</a>
          </div>
        </section>
       </div>
      </div>
    </div>
  );
}

/**
 * Notificaciones con la app CERRADA (Web Push).
 *
 * Es distinto de la fila de arriba y por eso va aparte: aquello son notificaciones que pinta ESTA
 * pestaña mientras está abierta; esto es el servidor empujando a este aparato aunque la app no esté
 * corriendo. Es lo único que sirve cuando el agente trae el teléfono en la bolsa.
 *
 * Se activa por dispositivo, no por cuenta: el permiso lo da el navegador de cada aparato. De ahí
 * la lista —- quien activó en el teléfono y en la laptop tiene que poder quitar uno sin tocar el
 * otro, y ver desde dónde le están llegando avisos.
 *
 * Lo de iOS se dice claro y sin adornos: Safari solo entrega push a una app AGREGADA A LA PANTALLA
 * DE INICIO. En una pestaña normal no hay push y no hay forma de que la haya —- no es algo que se
 * arregle con código.
 */
function PushRow({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [supported, setSupported] = useState(true);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [iOS, setIOS] = useState(false);

  const refresh = async (ep?: string | null) => {
    const cur = ep !== undefined ? ep : await currentPushEndpoint();
    setEndpoint(cur);
    setDevices(await listPushDevices(cur ?? undefined));
  };

  useEffect(() => {
    setSupported(pushSupported());
    setStandalone(isStandalone());
    setIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await subscribeToPush();
      if (!r.ok) {
        setErr(r.reason === "denied"
          ? (es ? "El navegador no dio permiso. Actívalo desde el candado de la barra de direcciones." : "The browser denied permission. Enable it from the padlock in the address bar.")
          : (es ? "No se pudo activar en este dispositivo." : "Couldn't enable it on this device."));
        return;
      }
      const saved = await savePushSubscription(r.sub);
      if (!saved.ok) {
        // Pasa si la migración 0082 todavía no se corrió: mejor decirlo que dejar un botón que
        // parece que funcionó y no manda nada.
        setErr(es ? "Se activó en el navegador pero no se pudo guardar en el servidor." : "Enabled in the browser but couldn't be saved on the server.");
        return;
      }
      setDesktopEnabled(true);
      await refresh(r.sub.endpoint);
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setErr(null); setBusy(true);
    try {
      const ep = await unsubscribeFromPush();
      if (ep) await removePushSubscription(ep);
      await refresh(null);
    } finally { setBusy(false); }
  };

  const forget = async (d: PushDevice) => {
    setBusy(true);
    try {
      // Si es ESTE, además hay que soltar la suscripción del navegador: borrar solo la fila dejaría
      // al navegador creyendo que sigue suscrito y el botón diría "activado" sin estarlo.
      if (d.current) { await unsubscribeFromPush(); }
      await removePushDevice(d.id);
      await refresh(d.current ? null : undefined);
    } finally { setBusy(false); }
  };

  // iOS solo entrega push a la app instalada. Decirlo antes de que alguien pique un botón que no
  // puede funcionar.
  const iosBlocked = iOS && !standalone;

  return (
    <div className="col gap-2">
      <div className="row gap-2">
        <span className="grow">
          {es ? "Avisos con la app cerrada" : "Alerts when the app is closed"}
          <span className="t-xs muted" style={{ display: "block" }}>
            {!supported
              ? (es ? "Este navegador no soporta notificaciones push" : "This browser doesn't support push notifications")
              : iosBlocked
                ? (es ? "En iPhone hay que instalar la app primero: Compartir → Agregar a inicio" : "On iPhone, install the app first: Share → Add to Home Screen")
                : (es ? "El servidor te avisa aunque no tengas Hiraticket abierto" : "The server alerts you even with Hiraticket closed")}
          </span>
        </span>
        {endpoint ? (
          <button className="btn btn-sm btn-outline" disabled={busy} onClick={disable}>
            <Icon name="x" size={14} />{es ? "Desactivar aquí" : "Turn off here"}
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" disabled={busy || !supported || iosBlocked} onClick={enable}>
            <Icon name="bell" size={14} />{busy ? (es ? "Activando…" : "Enabling…") : (es ? "Activar aquí" : "Enable here")}
          </button>
        )}
      </div>
      {err && <span className="t-xs" style={{ color: "var(--red)" }}>{err}</span>}
      {devices.length > 0 && (
        <div className="col gap-1" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <span className="t-xs muted">{es ? "Dispositivos con avisos activos" : "Devices receiving alerts"}</span>
          {devices.map((d) => (
            <div key={d.id} className="row gap-2" style={{ alignItems: "center" }}>
              <span className="grow truncate t-sm">
                {describeUA(d.ua, es)}{d.current && <span className="muted"> · {es ? "este dispositivo" : "this device"}</span>}
              </span>
              <button className="iconbtn sm" disabled={busy} title={es ? "Quitar" : "Remove"} onClick={() => forget(d)}><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** El user-agent crudo no le dice nada a nadie. Se reduce a "iPhone · Safari", que es lo que la
 *  persona necesita para reconocer cuál de sus aparatos es. */
function describeUA(ua: string | null, es: boolean): string {
  if (!ua) return es ? "Dispositivo" : "Device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : (es ? "Dispositivo" : "Device");
  // El orden importa: Edge y Chrome se anuncian como Safari, y Chrome también como Edge.
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
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


/** Qué avisa la app, por usuario (0068).
 *
 *  Separado del sonido y de las notificaciones del sistema porque son cosas distintas: aquello
 *  depende del dispositivo (permiso, bocinas) y esto de la persona — se guarda en su perfil y la
 *  sigue a cualquier navegador donde entre.
 *
 *  "Todas" es un maestro: en off nada avisa, y los demás se ven apagados sin perder su valor, para
 *  que al volver a encender quede como estaba. */
function NotifPrefsRows({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadNotifPrefs().then((p) => { if (p) setPrefs(p); setReady(true); }).catch(() => setReady(true)); }, []);

  const set = (patch: Partial<NotifPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);           // optimista: el interruptor responde al instante
    // Avisar al notificador en vivo: vive en el layout, que Next no re-ejecuta al navegar, así que
    // sin esto seguiría con las preferencias viejas hasta recargar la página.
    try { window.dispatchEvent(new CustomEvent(NOTIF_PREFS_EVENT, { detail: next })); } catch {}
    saveNotifPrefs(next).catch(() => {});
  };

  const ROWS: { k: Exclude<keyof NotifPrefs, "all">; es: string; en: string; hintEs: string; hintEn: string }[] = [
    { k: "unassigned", es: "Sin asignar", en: "Unassigned", hintEs: "Mensajes en chats que nadie ha tomado", hintEn: "Messages in chats nobody picked up" },
    { k: "mine", es: "Mis conversaciones", en: "My chats", hintEs: "Mensajes en chats asignados a ti", hintEn: "Messages in chats assigned to you" },
    { k: "internal", es: "Mensajes internos", en: "Internal messages", hintEs: "Canal de equipo y directos", hintEn: "Team channel and DMs" },
    { k: "mentions", es: "Menciones internas", en: "Internal mentions", hintEs: "Cuando te nombran con @", hintEn: "When someone @-mentions you" },
    { k: "calls", es: "Llamadas", en: "Calls", hintEs: "Llamadas entrantes y perdidas de WhatsApp", hintEn: "Incoming and missed WhatsApp calls" },
    { k: "transfers", es: "Transferencias a mí", en: "Transfers to me", hintEs: "Cuando alguien te pasa un chat", hintEn: "When someone hands you a chat" },
    { k: "payments", es: "Pagos por revisar", en: "Payments to review", hintEs: "Comprobante de transferencia nuevo, pendiente de aprobar", hintEn: "New transfer receipt, pending approval" },
  ];

  return (
    <>
      <div className="row gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span className="grow">
          <strong>{es ? "Todas las notificaciones" : "All notifications"}</strong>
          <span className="t-xs muted" style={{ display: "block" }}>{es ? "Apágalo para no recibir ninguna" : "Turn off to receive none"}</span>
        </span>
        <div className="seg">
          <button className={prefs.all ? "on" : ""} disabled={!ready} onClick={() => set({ all: true })}>{es ? "Activadas" : "On"}</button>
          <button className={!prefs.all ? "on" : ""} disabled={!ready} onClick={() => set({ all: false })}><Icon name="x" size={13} />{es ? "Apagadas" : "Off"}</button>
        </div>
      </div>
      {ROWS.map((r) => (
        <div key={r.k} className="row gap-2" style={{ opacity: prefs.all ? 1 : 0.45, paddingLeft: 10 }}>
          <span className="grow">
            {es ? r.es : r.en}
            <span className="t-xs muted" style={{ display: "block" }}>{es ? r.hintEs : r.hintEn}</span>
          </span>
          <div className="seg seg-sm">
            <button className={prefs[r.k] ? "on" : ""} disabled={!ready || !prefs.all} onClick={() => set({ [r.k]: true } as Partial<NotifPrefs>)}>{es ? "Sí" : "On"}</button>
            <button className={!prefs[r.k] ? "on" : ""} disabled={!ready || !prefs.all} onClick={() => set({ [r.k]: false } as Partial<NotifPrefs>)}>{es ? "No" : "Off"}</button>
          </div>
        </div>
      ))}
    </>
  );
}
