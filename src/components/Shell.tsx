"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { AppProvider, useApp } from "@/components/AppContext";
import { ToastProvider } from "@/components/Toast";
import { BuildSkewGuard } from "@/components/BuildSkewGuard";
import { ConfirmProvider } from "@/components/Confirm";
import { RealtimeNotifier } from "@/components/RealtimeNotifier";
import type { NotifPrefs } from "@/lib/notifPrefs";
import { NavProgress } from "@/components/NavProgress";
import { PageSkeleton } from "@/components/PageSkeleton";
import { GlobalSearch } from "@/components/GlobalSearch";
import { clearCache } from "@/lib/localCache";
import { installKeyboardInset } from "@/lib/mobileViewport";
import { PwaRegister } from "@/components/PwaRegister";
import { InstallAppRow } from "@/components/InstallApp";
import { PushNudge } from "@/components/PushNudge";
import { OrgSwitcher, type OrgOption } from "@/components/OrgSwitcher";
import { loadNotificationFeed } from "@/app/(app)/chat/live-actions";
import { liveBadges } from "@/lib/chatLive";
import { createClient } from "@/lib/supabase/client";
import { keepSubscribed } from "@/lib/realtime";
import type { StringKey } from "@/lib/i18n";
import type { Notif } from "@/lib/notifications";

function relShort(iso: string | null): string {
  if (!iso) return "";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return "ahora";
  if (m < 60) return `${Math.floor(m)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** Soft two-note chime via Web Audio (no asset). Plays after the user has interacted. */
let _ac: AudioContext | null = null;
function playChime() {
  try {
    if (localStorage.getItem("ht_muteNotif") === "1") return; // muted in Settings
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _ac = _ac ?? new Ctx();
    if (_ac.state === "suspended") _ac.resume();
    const now = _ac.currentTime;
    for (const [f, t] of [[880, 0], [1174.66, 0.08]] as const) {
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      o.connect(g); g.connect(_ac.destination);
      const s = now + t;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.02); // low volume = not annoying
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.18);
      o.start(s); o.stop(s + 0.2);
    }
  } catch { /* audio unavailable / blocked until first interaction */ }
}

function notifIcon(kind: Notif["kind"]) {
  if (kind === "chat") return <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--wa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="whatsapp" size={15} /></span>;
  // Un pago por aprobar no es un mensaje: es trabajo pendiente, y se distingue con su propio color.
  if (kind === "payment") return <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--amber-bg)", color: "var(--amber)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="checks" size={15} /></span>;
  const name = kind === "internal" ? "chat" : "at";
  return <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name={name} size={15} /></span>;
}

function Bell({ notifications }: { notifications: Notif[] }) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(notifications);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setItems(notifications); setDone(false); }, [notifications]);
  const total = notifications.reduce((n, x) => n + (x.unread || 1), 0);

  // Chime when the (assigned-to-you) notification count rises — not on first load.
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (prev.current != null && total > prev.current) playChime();
    prev.current = total;
  }, [total]);

  const loadMore = () => {
    if (loading || done) return;
    const last = items[items.length - 1];
    setLoading(true);
    loadNotificationFeed(last?.at ?? undefined, "all", true).then((r) => {
      setItems((prev2) => { const seen = new Set(prev2.map((x) => x.id)); return [...prev2, ...r.filter((x) => !seen.has(x.id))]; });
      if (r.length < 20) setDone(true);
    }).finally(() => setLoading(false));
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="iconbtn" style={{ position: "relative" }} onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Icon name="bell" />
        {total > 0 && <span className="badge badge-red" style={{ position: "absolute", top: 3, right: 4 }}>{total}</span>}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="menu scroll" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxHeight: 440, overflowY: "auto", zIndex: 50 }}
            onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore(); }}>
            <div className="menu-label">{lang === "es" ? "Notificaciones" : "Notifications"}</div>
            {items.length === 0 && <div className="muted t-sm" style={{ padding: "8px 10px" }}>{lang === "es" ? "Sin novedades" : "Nothing new"}</div>}
            {items.map((no) => (
              <Link key={no.id} href={no.href} prefetch={false} className="menu-item" style={{ alignItems: "flex-start" }} onClick={() => setOpen(false)}>
                {notifIcon(no.kind)}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, whiteSpace: "normal" }}>{no.text ?? ((lang === "es" ? "Nuevo mensaje de " : "New message from ") + no.name)}</span>
                  <span className="t-xs muted">{relShort(no.at)}{no.kind === "chat" && no.unread > 1 ? ` · ${no.unread}` : ""}</span>
                </span>
              </Link>
            ))}
            {loading && <div className="muted t-xs" style={{ padding: "6px 10px" }}>{lang === "es" ? "Cargando…" : "Loading…"}</div>}
            <div className="menu-sep" />
            <Link href="/notifications" prefetch={false} className="menu-item" style={{ justifyContent: "center", fontWeight: 600 }} onClick={() => setOpen(false)}>{lang === "es" ? "Ver todas" : "See all"}</Link>
          </div>
        </>
      )}
    </span>
  );
}

interface NavItem {
  id: string;
  href: string;
  icon: string;
  labelKey: StringKey;
  badge?: number | null;
  red?: boolean;
  adminOnly?: boolean; // hidden for non-admin members (the route also enforces it server-side)
}

const PRIMARY: NavItem[] = [
  { id: "chat", href: "/chat", icon: "chat", labelKey: "nav_chat", red: true },
  { id: "orders", href: "/orders", icon: "orders", labelKey: "nav_orders" },
  { id: "kanban", href: "/kanban", icon: "kanban", labelKey: "nav_kanban" },
  { id: "contacts", href: "/contacts", icon: "user", labelKey: "nav_contacts" },
  { id: "internal", href: "/internal", icon: "agents", labelKey: "nav_internal", red: true },
  { id: "agents", href: "/agents", icon: "agents", labelKey: "nav_agents" },
  { id: "agenda", href: "/agenda", icon: "calendar", labelKey: "nav_agenda" },
];

const ADMIN: NavItem[] = [
  { id: "catalog", href: "/catalog", icon: "store", labelKey: "nav_catalog" },
  // Campañas hidden from the sidebar (route still exists, just not shown).
  { id: "reports", href: "/reports", icon: "layers", labelKey: "nav_reports", adminOnly: true },
  { id: "flows", href: "/flows", icon: "bolt", labelKey: "nav_flows" },
  { id: "plugins", href: "/plugins", icon: "sparkles", labelKey: "nav_plugins" },
  { id: "canned", href: "/canned", icon: "canned", labelKey: "nav_canned" },
  { id: "business", href: "/business", icon: "sliders", labelKey: "nav_business" },
  { id: "settings", href: "/settings", icon: "settings", labelKey: "nav_settings" },
];

/** La etiqueta de un destino depende del modo (negocio/personal) y del nombre que el negocio le
 *  dio a su objeto. Vive aquí y no dentro del riel porque la barra inferior y el panel "Más" tienen
 *  que decir exactamente lo mismo —- si se copia, a la primera semana ya no coinciden. */
function navLabel(it: NavItem, t: (k: StringKey) => string, lang: "es" | "en", personal: boolean, objectName: string): string {
  if (it.id === "orders") return objectName;
  if (!personal) return t(it.labelKey);
  if (it.id === "business") return lang === "es" ? "Espacio" : "Workspace";
  if (it.id === "catalog") return lang === "es" ? "Repetitivas" : "Recurring";
  if (it.id === "contacts") return lang === "es" ? "Contactos" : "Contacts";
  return t(it.labelKey);
}

/** Los cinco destinos de la barra inferior en móvil. Cinco es el tope que se puede tocar con el
 *  pulgar sin fallar en una pantalla de 390px; el resto del NAV vive detrás de "Más". */
const TAB_IDS = ["chat", "orders", "kanban", "internal"] as const;

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  color?: string;
  avatarUrl?: string | null;
}

function NavRail({ badges, secondaryBadges = {}, objectName, user, isAdmin, onNavigate, orgs = [], activeOrg }: { badges: Record<string, number | null>; secondaryBadges?: Record<string, number | null>; objectName: string; user: ShellUser; isAdmin: boolean; onNavigate?: (href: string) => void; orgs?: OrgOption[]; activeOrg: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, t, personal } = useApp();
  const [profOpen, setProfOpen] = useState(false);
  const profBtn = useRef<HTMLButtonElement>(null);
  const [profRect, setProfRect] = useState<DOMRect | null>(null);
  const toggleProf = () => { if (!profOpen && profBtn.current) setProfRect(profBtn.current.getBoundingClientRect()); setProfOpen((o) => !o); };

  // Flechita de "hay más abajo": el rail hace scroll propio (overflow: hidden auto) y en negocios
  // con muchas secciones (platform admin, etc.) las últimas quedaban fuera de vista sin ninguna
  // pista de que se podía bajar más. Se recalcula con el scroll propio del rail, con el tamaño de
  // la ventana, y cuando cambian los items (login, badges que aparecen/desaparecen empujan alto).
  const railRef = useRef<HTMLElement>(null);
  const [railOverflows, setRailOverflows] = useState(false);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const check = () => setRailOverflows(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    check();
    el.addEventListener("scroll", check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); window.removeEventListener("resize", check); };
  }, []);

  // Prefetch solo con intención, y una vez por sección.
  //
  // El rail está siempre visible y TODAS las páginas son force-dynamic, así que el prefetch
  // automático de <Link> hacía que el servidor renderizara Pedidos, Reportes, Catálogo, Plugins,
  // Flujos, Ajustes y Negocio completos —- con todas sus consultas —- nomás por pintar la barra.
  // Encima se repetía: Next caduca el prefetch de rutas dinámicas a los 30 s, así que se pedían
  // otra vez, y otra, para siempre. Eso es lo que llenaba la pestaña de peticiones pendientes y
  // dejaba al servidor sin CPU justo cuando querías cambiar de sección.
  //
  // Un `onMouseEnter` pelado no arreglaba nada: cruzar el mouse por la barra para llegar a la
  // lista de chats disparaba el prefetch de cada icono que tocaba de paso. De ahí los 150 ms de
  // espera —- el tiempo en que pasar de largo se distingue de querer entrar —- y el Set.
  const prefetched = useRef<Set<string>>(new Set());
  const hoverTO = useRef<ReturnType<typeof setTimeout>>(undefined);
  const armPrefetch = (href: string) => {
    if (prefetched.current.has(href)) return;
    clearTimeout(hoverTO.current);
    hoverTO.current = setTimeout(() => { prefetched.current.add(href); router.prefetch(href); }, 150);
  };
  const cancelPrefetch = () => clearTimeout(hoverTO.current);

  const renderItem = (it: NavItem) => {
    const on = pathname === it.href || pathname.startsWith(it.href + "/");
    const badge = badges[it.id] ?? it.badge ?? null;
    const secondary = secondaryBadges[it.id] ?? null;
    return (
      <Link key={it.id} href={it.href} prefetch={false} className={"rail-item" + (on ? " on" : "")}
        onMouseEnter={() => armPrefetch(it.href)} onMouseLeave={cancelPrefetch} onClick={() => onNavigate?.(it.href)}>
        <Icon name={it.icon} />
        <span className="rl">{navLabel(it, t, lang, personal, objectName)}</span>
        <span className="rail-badges">
          {badge != null && badge > 0 && (
            <span className={"badge" + (it.red ? " badge-red" : "")} title={it.id === "internal" ? (lang === "es" ? "Mensajes del equipo sin leer" : "Unread team messages") : (lang === "es" ? "Asignados a ti" : "Assigned to you")}>{badge}</span>
          )}
          {secondary != null && secondary > 0 && (
            <span className="badge badge-new" title={lang === "es" ? "Nuevos sin asignar" : "New, unassigned"}>{secondary}</span>
          )}
        </span>
      </Link>
    );
  };

  return (
    <nav className="rail" ref={railRef}>
      <div className="rail-logo" title="Hiraticket">H</div>
      <div className="rail-nav">{PRIMARY.map(renderItem)}</div>
      <div className="rail-sep" />
      <div className="rail-nav">{ADMIN.filter((it) => isAdmin || !it.adminOnly).map(renderItem)}</div>
      {railOverflows && <div className="rail-more" aria-hidden><Icon name="chevd" size={14} /></div>}
      <div className="rail-foot" style={{ marginTop: "auto", position: "relative", padding: 8 }}>
        <button ref={profBtn} className="rail-item" style={{ width: "100%" }} onClick={toggleProf}>
          <Avatar name={user.name} initials={deriveInitials(user.name)} color={user.color || "#0E8C82"} size={28} presence="online" src={user.avatarUrl ?? undefined} />
          <span className="rl truncate">{user.name}</span>
        </button>
        {profOpen && profRect && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setProfOpen(false)} />
            <div className="menu" style={{ position: "fixed", bottom: window.innerHeight - profRect.top + 6, left: profRect.left, width: 220, zIndex: 201 }}>
              <div style={{ padding: "8px 12px" }}><div style={{ fontWeight: 700 }} className="truncate">{user.name}</div><div className="t-xs muted truncate">{user.email}</div></div>
              <div className="menu-sep" />
              <Link className="menu-item" href="/profile" prefetch={false} onClick={() => setProfOpen(false)}><Icon name="user" size={15} />{lang === "es" ? "Perfil" : "Profile"}</Link>
              {/* Se pinta sola solo si hay algo que ofrecer: si la app ya está instalada, o el
                  navegador no sabe instalar, InstallAppRow no devuelve nada. */}
              <InstallAppRow />
              <div className="menu-sep" />
              <OrgSwitcher orgs={orgs} activeId={activeOrg} onDone={() => setProfOpen(false)} />
              <div className="menu-sep" />
              {/* Wipe the local message cache (plaintext on this device) before the session ends. */}
              <form action="/auth/signout" method="post" onSubmit={() => { clearCache().catch(() => {}); }}><button className="menu-item danger" type="submit" style={{ width: "100%" }}><Icon name="lock" size={15} />{t("sign_out")}</button></form>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

/**
 * Navegación en móvil: barra inferior de cinco + panel "Más".
 *
 * El riel lateral no se adapta —- son 15 destinos en vertical, y en un teléfono se come la mitad
 * de la pantalla. Se sustituye por lo que la gente ya sabe usar sin que se lo expliquen: cuatro
 * destinos fijos al alcance del pulgar y todo lo demás detrás de "Más".
 *
 * Riel y barra existen a la vez en el DOM y decide el CSS cuál se ve (`.rail` / `.tabbar`), no
 * `useIsMobile`: así el servidor pinta el correcto de una vez. Con JavaScript habría un parpadeo
 * de riel en cada carga, porque en el servidor no hay ventana que medir.
 */
function MobileNav({ badges, secondaryBadges = {}, objectName, user, isAdmin, connected, dueDates, proofs = 0, onNavigate, orgs = [], activeOrg }: {
  badges: Record<string, number | null>; secondaryBadges?: Record<string, number | null>;
  objectName: string; user: ShellUser; isAdmin: boolean; connected: boolean; dueDates: string[]; proofs?: number;
  onNavigate?: (href: string) => void; orgs?: OrgOption[]; activeOrg: string;
}) {
  const pathname = usePathname();
  const { lang, setLang, theme, setTheme, t, personal } = useApp();
  const [moreOpen, setMoreOpen] = useState(false);

  // Cambiar de sección cierra el panel. Va por pathname y no en el onClick de cada fila para que
  // también cierre cuando se navega desde otro lado (una notificación, el buscador).
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  // Con el panel abierto, el fondo no debe hacer scroll detrás.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  const tabs = TAB_IDS.map((id) => PRIMARY.find((p) => p.id === id)!).filter(Boolean);
  const inTabs = new Set<string>(TAB_IDS);
  const rest = [...PRIMARY.filter((it) => !inTabs.has(it.id)), ...ADMIN.filter((it) => isAdmin || !it.adminOnly)];
  // "Más" se marca activo cuando estás en cualquier sección que vive detrás de él: sin eso, entrar
  // a Reportes deja la barra entera apagada y parece que estás en ningún lado.
  const onRest = rest.some((it) => pathname === it.href || pathname.startsWith(it.href + "/"));

  const tabBadge = (id: string) => (badges[id] ?? 0) + (secondaryBadges[id] ?? 0);

  return (
    <>
      <nav className="tabbar" aria-label={lang === "es" ? "Navegación" : "Navigation"}>
        {tabs.map((it) => {
          const on = pathname === it.href || pathname.startsWith(it.href + "/");
          const n = tabBadge(it.id);
          return (
            <Link key={it.id} href={it.href} prefetch={false} className={"tab" + (on ? " on" : "")} onClick={() => onNavigate?.(it.href)}>
              <span className="tab-ic">
                <Icon name={it.icon} />
                {n > 0 && <span className={"badge" + (it.red ? " badge-red" : "")}>{n > 99 ? "99+" : n}</span>}
              </span>
              <span className="tab-l">{navLabel(it, t, lang, personal, objectName)}</span>
            </Link>
          );
        })}
        <button className={"tab" + (onRest || moreOpen ? " on" : "")} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
          <span className="tab-ic"><Icon name={moreOpen ? "x" : "dots"} /></span>
          <span className="tab-l">{lang === "es" ? "Más" : "More"}</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="more-sheet" role="dialog" aria-modal="true">
          <div className="more-head">
            <Avatar name={user.name} initials={deriveInitials(user.name)} color={user.color || "#0E8C82"} size={40} presence="online" src={user.avatarUrl ?? undefined} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }} className="truncate">{user.name}</div>
              <div className="t-xs muted truncate">{user.email}</div>
            </div>
            <button className="iconbtn" onClick={() => setMoreOpen(false)} aria-label={lang === "es" ? "Cerrar" : "Close"}><Icon name="x" /></button>
          </div>

          <div className="more-body scroll">
            {/* El chip de conexión y las banderitas no caben en la barra de arriba en un teléfono,
                pero son de lo primero que un agente quiere ver: se mudan aquí, no se pierden.
                En UNA fila y no apilados: son avisos cortos, y tres renglones de ancho completo se
                comían el espacio de lo que la gente viene a tocar. El de conexión va SIEMPRE a la
                derecha, incluso cuando es el único —- así se busca siempre en el mismo sitio en vez
                de bailar según cuántos avisos haya. Con `wrap`, si un día no caben, el que sobra
                baja de línea en vez de desbordar. */}
            <div className="indic-row">
              <DueFlags dates={dueDates} onNavigate={onNavigate} />
              <ProofFlag n={proofs} onNavigate={onNavigate} />
              <Link className={"conn-chip " + (connected ? "ok" : "down")} href="/settings" prefetch={false}>
                <span className="conn-dot" />
                <Icon name={connected ? "whatsapp" : "wifioff"} size={16} />
                <span className="truncate">{connected ? t("connected") : (lang === "es" ? "Desconectado · Conectar" : "Disconnected · Connect")}</span>
              </Link>
            </div>

            {/* En un teléfono esto es lo que convierte la pestaña en app —- y en iPhone, lo único
                que habilita los avisos con la app cerrada. Por eso va arriba y en grande, no
                escondido en Ajustes. */}
            <InstallAppRow variant="block" />

            <div className="more-grid">
              {rest.map((it) => {
                const on = pathname === it.href || pathname.startsWith(it.href + "/");
                const n = (badges[it.id] ?? 0) + (secondaryBadges[it.id] ?? 0);
                return (
                  <Link key={it.id} href={it.href} prefetch={false} className={"more-item" + (on ? " on" : "")} onClick={() => onNavigate?.(it.href)}>
                    <span className="more-ic"><Icon name={it.icon} size={20} />{n > 0 && <span className={"badge" + (it.red ? " badge-red" : "")}>{n > 99 ? "99+" : n}</span>}</span>
                    <span className="truncate">{navLabel(it, t, lang, personal, objectName)}</span>
                  </Link>
                );
              })}
              <Link href="/profile" prefetch={false} className={"more-item" + (pathname === "/profile" ? " on" : "")} onClick={() => onNavigate?.("/profile")}>
                <span className="more-ic"><Icon name="user" size={20} /></span>
                <span className="truncate">{lang === "es" ? "Perfil" : "Profile"}</span>
              </Link>
            </div>

            <div className="row gap-2" style={{ marginTop: 4 }}>
              <div className="seg grow" style={{ height: 42 }}>
                <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
                <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
              </div>
              <button className="btn btn-outline" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />{theme === "dark" ? t("light") : t("dark")}
              </button>
            </div>

            {/* El espejo del selector del riel. Con una sola organización aquí solo queda "Crear
                organización", que es lo que debe ver quien no sabe que esto existe. */}
            <OrgSwitcher orgs={orgs} activeId={activeOrg} variant="block" onDone={() => setMoreOpen(false)} />

            {/* Igual que en el riel: se borra el caché local de mensajes (texto plano en este
                aparato) antes de cerrar la sesión. */}
            <form action="/auth/signout" method="post" onSubmit={() => { clearCache().catch(() => {}); }}>
              <button className="btn btn-danger btn-block" type="submit"><Icon name="lock" size={15} />{t("sign_out")}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * El calendario del TopBar: cuántas entregas (pedidos con fecha límite + citas) hay hoy, mañana y
 * pasado mañana, como banderitas rojo/naranja/amarillo. Si algo ya se pasó, el chip entero se pone
 * rojo con el número de vencidos. Clic → Agenda, que lista esas mismas cosas.
 *
 * Los cubos se calculan AQUÍ y no en el servidor porque "hoy" es el día del navegador del agente;
 * el servidor vive en UTC y a las 6 pm de Culiacán ya sería "mañana".
 */
function DueFlags({ dates, onNavigate }: { dates: string[]; onNavigate?: (href: string) => void }) {
  const { lang, personal } = useApp();
  // Prefetch con intención al pasar el mouse, igual que el rail: quien va a dar clic se detiene
  // unos ms encima, y para cuando suelta el clic la Agenda ya viene en camino o llegó.
  const router = useRouter();
  const prefetched = useRef(false);
  const hoverTO = useRef<ReturnType<typeof setTimeout>>(undefined);
  const armPrefetch = () => {
    if (prefetched.current) return;
    clearTimeout(hoverTO.current);
    hoverTO.current = setTimeout(() => { prefetched.current = true; router.prefetch("/agenda"); }, 120);
  };
  const cancelPrefetch = () => clearTimeout(hoverTO.current);
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const now = new Date();
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86400000));
  const dayAfter = day(new Date(now.getTime() + 2 * 86400000));
  let overdue = 0, d0 = 0, d1 = 0, d2 = 0;
  for (const iso of dates) {
    const d = new Date(iso);
    const k = day(d);
    if (k === today) d0++;
    else if (k === tomorrow) d1++;
    else if (k === dayAfter) d2++;
    else if (d.getTime() < now.getTime()) overdue++;
  }
  if (!overdue && !d0 && !d1 && !d2) return null; // sin entregas cerca, sin ruido

  const noun = personal ? (lang === "es" ? "tareas" : "tasks") : (lang === "es" ? "entregas" : "deliveries");
  const title = overdue
    ? (lang === "es" ? `${overdue} ${noun} vencidas · clic para ver la agenda` : `${overdue} overdue ${noun} · click for the agenda`)
    : (lang === "es" ? `${noun} de los próximos 3 días · clic para ver la agenda` : `${noun} for the next 3 days · click for the agenda`);
  const flag = (n: number, bg: string, label: string) =>
    n > 0 ? <span key={label} title={label} style={{ background: bg, color: "#fff", borderRadius: 999, minWidth: 18, height: 18, padding: "0 5px", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span> : null;
  return (
    <Link href="/agenda" prefetch={false} title={title} onClick={() => onNavigate?.("/agenda")}
      onMouseEnter={armPrefetch} onMouseLeave={cancelPrefetch}
      className="conn-chip" style={overdue ? { background: "var(--red)", borderColor: "var(--red)", color: "#fff" } : undefined}>
      <Icon name="calendar" size={15} />
      {overdue > 0 && <span style={{ fontWeight: 800 }}>{overdue}</span>}
      {overdue > 0 && <Icon name="flag" size={12} />}
      {flag(d0, "#DC2626", lang === "es" ? "Para hoy" : "Due today")}
      {flag(d1, "#EA580C", lang === "es" ? "Para mañana" : "Due tomorrow")}
      {flag(d2, "#D97706", lang === "es" ? "Para pasado mañana" : "Due in 2 days")}
    </Link>
  );
}

/**
 * Pagos por revisar, en la barra —- el mismo trato que las entregas del calendario.
 *
 * Un comprobante de transferencia es dinero que alguien está esperando que aprueben, y hasta ahora
 * el único rastro era entrar al pedido a mano. Un aviso que aparece y se va no sirve para eso: esto
 * es trabajo pendiente, y tiene que verse mientras siga pendiente.
 *
 * Sin nada por revisar no se pinta: una barra llena de indicadores en cero es ruido.
 */
function ProofFlag({ n, onNavigate }: { n: number; onNavigate?: (href: string) => void }) {
  const { lang, personal } = useApp();
  if (!n || personal) return null; // en gestión personal no hay dinero (skill dual-mode)
  const es = lang === "es";
  const titulo = es ? `${n} pago(s) por revisar · clic para verlos` : `${n} payment(s) to review · click to see them`;
  return (
    <Link href="/orders?proofs=1" prefetch={false} title={titulo} onClick={() => onNavigate?.("/orders?proofs=1")}
      className="conn-chip" style={{ background: "var(--amber-bg)", borderColor: "var(--amber-bd)" }}>
      <Icon name="checks" size={15} />
      <span style={{ fontWeight: 800 }}>{n}</span>
      <span className="hide-narrow">{es ? "por revisar" : "to review"}</span>
    </Link>
  );
}

function TopBar({ notifications, connected, businessId, dueDates = [], proofs = 0, onNavigate }: { notifications: Notif[]; connected: boolean; businessId: string; dueDates?: string[]; proofs?: number; onNavigate?: (href: string) => void }) {
  const { lang, setLang, theme, setTheme, t, personal } = useApp();
  return (
    <header className="topbar">
      <div className="topbar-search">
        <GlobalSearch businessId={businessId} />
      </div>
      <span className="grow" />

      {/* `hide-mobile`: en un teléfono estas cuatro cosas no caben en la barra y viven en el panel
          "Más" (ver MobileNav). Arriba se quedan solo buscador, campana y crear. */}
      <span className="hide-mobile"><DueFlags dates={dueDates} onNavigate={onNavigate} /></span>
      <span className="hide-mobile"><ProofFlag n={proofs} onNavigate={onNavigate} /></span>

      <Link className={"conn-chip hide-mobile " + (connected ? "ok" : "down")} title="WhatsApp" href="/settings" prefetch={false}>
        <span className="conn-dot" />
        <Icon name={connected ? "whatsapp" : "wifioff"} size={15} />
        <span>{connected ? t("connected") : (lang === "es" ? "Desconectado · Conectar" : "Disconnected · Connect")}</span>
      </Link>

      <div className="seg hide-mobile" style={{ height: 34 }}>
        <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
        <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      </div>

      <button
        className="iconbtn hide-mobile"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label={theme === "dark" ? t("light") : t("dark")}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>

      <Bell notifications={notifications} />

      <Link className="btn btn-primary" href="/orders?new=1" prefetch={false}>
        <Icon name="plus" /> <span className="hide-narrow">{personal ? (lang === "es" ? "Nueva tarea" : "New task") : t("new_order")}</span>
      </Link>
    </header>
  );
}

export function Shell({
  user,
  businessId,
  notifPrefs,
  badges = {},
  secondaryBadges = {},
  notifications = [],
  connected = false,
  objectName = "Pedidos",
  personal = false,
  isAdmin = false,
  dueDates = [],
  proofs = 0,
  orgs = [],
  brandColor = null,
  children,
}: {
  user: ShellUser;
  businessId: string;
  notifPrefs?: NotifPrefs;
  badges?: Record<string, number | null>;
  secondaryBadges?: Record<string, number | null>;
  notifications?: Notif[];
  connected?: boolean;
  objectName?: string;
  personal?: boolean;
  isAdmin?: boolean;
  /** Fechas (ISO) de pedidos con fecha límite y citas programadas, para las banderitas del TopBar. */
  dueDates?: string[];
  /** Comprobantes de pago esperando aprobación: el indicador de la barra, como las banderitas. */
  proofs?: number;
  /** Organizaciones de esta persona. Con una sola, el selector no se pinta (ver OrgSwitcher). */
  orgs?: OrgOption[];
  /** Color de la app elegido para ESTA organización (0088). Nulo = el amarillo de siempre. */
  brandColor?: string | null;
  children: React.ReactNode;
}) {
  // Badges/bell kept live via a targeted refetch (no full route refresh); re-seeded from props.
  const [b, setB] = useState(badges);
  const [sb, setSb] = useState(secondaryBadges);
  const [notifs, setNotifs] = useState(notifications);
  const [due, setDue] = useState(dueDates);
  const [prf, setPrf] = useState(proofs);
  useEffect(() => { setB(badges); setSb(secondaryBadges); setNotifs(notifications); setDue(dueDates); setPrf(proofs); /* eslint-disable-next-line */ }, [JSON.stringify(badges), JSON.stringify(secondaryBadges), notifications, JSON.stringify(dueDates), proofs]);
  const refreshBadges = useCallback(() => {
    liveBadges(businessId).then((r) => {
      // Se refresca TODO lo que pinta la barra, no solo el chat. Antes esto solo tocaba chat e
      // interno: mover un pedido de etapa cambiaba los pedidos abiertos y las banderitas del
      // calendario, pero esos dos números no estaban aquí y se quedaban con el valor de la carga.
      setB((cur) => ({ ...cur, chat: r.mine, internal: r.internal, orders: r.orders }));
      setSb({ chat: r.unassigned });
      setNotifs(r.notifications);
      setDue(r.dueDates);
      setPrf(r.proofs);
    }).catch(() => {});
  }, [businessId]);

  /**
   * Los números de arriba, en vivo.
   *
   * Antes dependían de que la ruta se volviera a renderizar. Y una acción de servidor revalida la
   * PÁGINA donde ocurre —- no el layout que dibuja la barra —- así que mover un pedido de etapa, o
   * abrir un chat desde la campana, dejaba los contadores en el número anterior hasta recargar.
   *
   * Ahora la barra escucha por su cuenta: `conversations` para lo del chat, `events` para lo que le
   * pasa a los pedidos (cambiar de etapa escribe un evento) e `internal_messages` para el equipo.
   * De paso funciona cuando quien mueve algo es OTRO agente, que antes tampoco se veía.
   *
   * `orders` y `appointments` no están publicadas en realtime; `events` cubre los pedidos, y la
   * agenda ya se refresca sola porque revalida la ruta en la que estás.
   */
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout>;
    const poke = () => { clearTimeout(t); t = setTimeout(() => refreshBadges(), 500); };
    const stop = keepSubscribed(supabase, `shell-${businessId}`, (ch) => ch
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, poke)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `business_id=eq.${businessId}` }, poke)
      .on("postgres_changes", { event: "*", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, poke)
      // Un comprobante que llega o que alguien aprueba cambia el indicador de pagos por revisar.
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_proofs", filter: `business_id=eq.${businessId}` }, poke));
    return () => { clearTimeout(t); stop(); };
  }, [businessId, refreshBadges]);
  // Pendientes en el título de la pestaña: "(3) Hiraticket". Es lo único que se ve sin cambiar de
  // pestaña, así que suma lo que de verdad requiere tu atención — chats tuyos sin leer, sin asignar
  // y mensajes del equipo. setAppBadge además lo pinta en el icono de la barra de tareas cuando la
  // app está instalada como PWA (Chrome/Edge de escritorio); donde no exista, se ignora.
  const pending = (b.chat ?? 0) + (sb.chat ?? 0) + (b.internal ?? 0);
  useEffect(() => {
    const base = "Hiraticket";
    document.title = pending > 0 ? `(${pending}) ${base}` : base;
    try {
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (pending > 0) nav.setAppBadge?.(pending).catch(() => {});
      else nav.clearAppBadge?.().catch(() => {});
    } catch {}
  }, [pending]);

  // El teclado del teléfono tapa el composer en iOS si nadie mide el viewport de verdad.
  // Se instala una sola vez, en el shell, para que valga en todas las pantallas. Ver mobileViewport.
  useEffect(() => installKeyboardInset(), []);

  // Let pages signal "badges may have changed" (e.g. the team chat after marking a channel read).
  useEffect(() => {
    const h = () => refreshBadges();
    window.addEventListener("ht:badges", h);
    return () => window.removeEventListener("ht:badges", h);
  }, [refreshBadges]);

  // Esqueleto INSTANTÁNEO al cambiar de sección, del lado del cliente.
  //
  // El loading.tsx de Next solo aparece al instante si la ruta se prefetcheó —- y el prefetch
  // automático está apagado a propósito (renderizaba media app de fondo, para siempre). Así que la
  // respuesta visual la damos nosotros: el clic en el rail cubre el contenido con el esqueleto en
  // el mismo frame, como superposición —- la página vieja sigue montada debajo, no se pierde nada
  // si la navegación falla —- y se quita cuando cambia el pathname.
  const navPath = usePathname();
  const [navDest, setNavDest] = useState<string | null>(null);
  useEffect(() => { setNavDest(null); }, [navPath]);

  /**
   * Si la navegación no llega, se fuerza. No se abandona.
   *
   * El fallo que esto arregla: das clic en otra sección, aparece el esqueleto —- y ahí se queda. No
   * cambia la URL, no cambias de sección, y a los 8 segundos el esqueleto desaparecía dejándote
   * exactamente donde estabas, sin un error, sin un reintento, sin nada que explicara qué pasó.
   *
   * El porqué: el prefetch automático está apagado (renderizaba media app de fondo, ver más abajo) y
   * TODAS las páginas son force-dynamic, así que cada clic tiene que ir al servidor por el payload
   * de la ruta. Si esa petición se cae o se queda colgada —- el teléfono que salta de wifi a datos,
   * el servidor ocupado —- el enrutador de Next se queda quieto y no avisa a nadie. No hay evento
   * al que suscribirse: lo único observable es que el pathname no cambió.
   *
   * Así que se le pone plazo, igual que a las lecturas del chat (ver `src/lib/chatLive.ts`, misma
   * idea y por la misma razón). Pasado el plazo se navega a mano: una navegación del navegador es
   * un documento nuevo, sin enrutador, sin caché y sin payload que se pueda perder. Cuesta un
   * segundo más que la buena y funciona siempre —- que es infinitamente mejor que no ir a ningún
   * lado. Si mientras tanto la navegación normal llegó, el efecto de arriba ya limpió `navDest` y
   * este nunca se dispara.
   */
  useEffect(() => {
    if (!navDest) return;
    const t = setTimeout(() => {
      // Comprobación final contra la URL de verdad y no contra el estado de React: si el enrutador
      // acabó de aterrizar en este mismo tick, recargar sería tirar la página recién pintada.
      if (window.location.pathname === navDest.split("?")[0]) { setNavDest(null); return; }
      // Sin red, navegar a mano cambia un esqueleto por la página de "sin conexión" del navegador:
      // pierdes la app entera a cambio de nada. Ahí se quita el esqueleto y te quedas donde estabas,
      // que con el teléfono fuera de cobertura es lo correcto.
      if (typeof navigator !== "undefined" && navigator.onLine === false) { setNavDest(null); return; }
      window.location.assign(navDest);
    }, 5000);
    return () => clearTimeout(t);
  }, [navDest]);

  const onNavigate = useCallback((href: string) => {
    if (href.split("?")[0] !== window.location.pathname) setNavDest(href);
  }, []);

  return (
    <AppProvider personal={personal} brandInitial={brandColor} businessId={businessId}>
      <ToastProvider>
        <ConfirmProvider>
          <NavProgress />
          <BuildSkewGuard />
          <PwaRegister />
          <RealtimeNotifier businessId={businessId} userId={user.id} myName={user.name} prefs={notifPrefs} onChange={refreshBadges} />
          <div className="app">
            <NavRail badges={b} secondaryBadges={sb} objectName={objectName} user={user} isAdmin={isAdmin} onNavigate={onNavigate} orgs={orgs} activeOrg={businessId} />
            <div className="main" style={{ position: "relative" }}>
              <TopBar notifications={notifs} connected={connected} businessId={businessId} dueDates={due} proofs={prf} onNavigate={onNavigate} />
              {children}
              {/* Abajo y no arriba: en un teléfono la parte de arriba ya la ocupan buscador y campana,
                  y el pulgar vive cerca del borde inferior. */}
              <PushNudge businessId={businessId} />
              {navDest && (
                <div style={{ position: "absolute", inset: 0, top: 57, background: "var(--surface)", zIndex: 30 }}>
                  <PageSkeleton />
                </div>
              )}
            </div>
            {/* Riel y barra inferior conviven en el DOM; el CSS decide cuál se ve. Ver MobileNav. */}
            <MobileNav badges={b} secondaryBadges={sb} objectName={objectName} user={user} isAdmin={isAdmin}
              connected={connected} dueDates={due} proofs={prf} onNavigate={onNavigate} orgs={orgs} activeOrg={businessId} />
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </AppProvider>
  );
}
