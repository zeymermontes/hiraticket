"use client";
import React, { useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { AppProvider, useApp } from "@/components/AppContext";
import { ToastProvider } from "@/components/Toast";
import { RealtimeNotifier } from "@/components/RealtimeNotifier";
import { GlobalSearch } from "@/components/GlobalSearch";
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

function Bell({ notifications }: { notifications: Notif[] }) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  const total = notifications.reduce((n, x) => n + (x.unread || 1), 0);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="iconbtn" style={{ position: "relative" }} onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Icon name="bell" />
        {total > 0 && <span className="badge badge-red" style={{ position: "absolute", top: 3, right: 4 }}>{total}</span>}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="menu scroll" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, maxHeight: 400, zIndex: 50 }}>
            <div className="menu-label">{lang === "es" ? "Notificaciones" : "Notifications"}</div>
            {notifications.length === 0 && <div className="muted t-sm" style={{ padding: "8px 10px" }}>{lang === "es" ? "Sin novedades" : "Nothing new"}</div>}
            {notifications.map((no) => (
              <Link key={no.id} href={no.href} className="menu-item" style={{ alignItems: "flex-start" }} onClick={() => setOpen(false)}>
                {no.kind === "mention"
                  ? <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="at" size={15} /></span>
                  : <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--wa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="whatsapp" size={15} /></span>}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, whiteSpace: "normal" }}>{no.text ?? ((lang === "es" ? "Nuevo mensaje de " : "New message from ") + no.name)}</span>
                  <span className="t-xs muted">{relShort(no.at)}{no.kind === "chat" && no.unread > 1 ? ` · ${no.unread}` : ""}</span>
                </span>
              </Link>
            ))}
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
}

const PRIMARY: NavItem[] = [
  { id: "chat", href: "/chat", icon: "chat", labelKey: "nav_chat", red: true },
  { id: "orders", href: "/orders", icon: "orders", labelKey: "nav_orders" },
  { id: "kanban", href: "/kanban", icon: "kanban", labelKey: "nav_kanban" },
  { id: "agenda", href: "/agenda", icon: "calendar", labelKey: "nav_agenda" },
];

const ADMIN: NavItem[] = [
  { id: "catalog", href: "/catalog", icon: "store", labelKey: "nav_catalog" },
  { id: "campaigns", href: "/campaigns", icon: "send", labelKey: "nav_campaigns" },
  { id: "reports", href: "/reports", icon: "layers", labelKey: "nav_reports" },
  { id: "flows", href: "/flows", icon: "bolt", labelKey: "nav_flows" },
  { id: "agents", href: "/agents", icon: "agents", labelKey: "nav_agents" },
  { id: "canned", href: "/canned", icon: "canned", labelKey: "nav_canned" },
  { id: "business", href: "/business", icon: "sliders", labelKey: "nav_business" },
  { id: "settings", href: "/settings", icon: "settings", labelKey: "nav_settings" },
];

export interface ShellUser {
  id: string;
  name: string;
  email: string;
}

function NavRail({ badges, secondaryBadges = {}, objectName, user }: { badges: Record<string, number | null>; secondaryBadges?: Record<string, number | null>; objectName: string; user: ShellUser }) {
  const pathname = usePathname();
  const { lang, t } = useApp();
  const [profOpen, setProfOpen] = useState(false);
  const profBtn = useRef<HTMLButtonElement>(null);
  const [profRect, setProfRect] = useState<DOMRect | null>(null);
  const toggleProf = () => { if (!profOpen && profBtn.current) setProfRect(profBtn.current.getBoundingClientRect()); setProfOpen((o) => !o); };

  const renderItem = (it: NavItem) => {
    const on = pathname === it.href || pathname.startsWith(it.href + "/");
    const badge = badges[it.id] ?? it.badge ?? null;
    const secondary = secondaryBadges[it.id] ?? null;
    return (
      <Link key={it.id} href={it.href} className={"rail-item" + (on ? " on" : "")}>
        <Icon name={it.icon} />
        <span className="rl">{it.id === "orders" ? objectName : t(it.labelKey)}</span>
        <span className="rail-badges">
          {badge != null && badge > 0 && (
            <span className={"badge" + (it.red ? " badge-red" : "")} title={lang === "es" ? "Asignados a ti" : "Assigned to you"}>{badge}</span>
          )}
          {secondary != null && secondary > 0 && (
            <span className="badge badge-new" title={lang === "es" ? "Nuevos sin asignar" : "New, unassigned"}>{secondary}</span>
          )}
        </span>
      </Link>
    );
  };

  return (
    <nav className="rail">
      <div className="rail-logo" title="Hiraticket">H</div>
      <div className="rail-nav">{PRIMARY.map(renderItem)}</div>
      <div className="rail-sep" />
      <div className="rail-nav">{ADMIN.map(renderItem)}</div>
      <div className="rail-foot" style={{ marginTop: "auto", position: "relative", padding: 8 }}>
        <button ref={profBtn} className="rail-item" style={{ width: "100%" }} onClick={toggleProf}>
          <Avatar name={user.name} initials={deriveInitials(user.name)} color="#0E8C82" size={28} presence="online" />
          <span className="rl truncate">{user.name}</span>
        </button>
        {profOpen && profRect && (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setProfOpen(false)} />
            <div className="menu" style={{ position: "fixed", bottom: window.innerHeight - profRect.top + 6, left: profRect.left, width: 220, zIndex: 201 }}>
              <div style={{ padding: "8px 12px" }}><div style={{ fontWeight: 700 }} className="truncate">{user.name}</div><div className="t-xs muted truncate">{user.email}</div></div>
              <div className="menu-sep" />
              <Link className="menu-item" href="/settings" onClick={() => setProfOpen(false)}><Icon name="settings" size={15} />{t("nav_settings")}</Link>
              <Link className="menu-item" href="/" onClick={() => setProfOpen(false)}><Icon name="store" size={15} />{lang === "es" ? "Sitio público" : "Public site"}</Link>
              <div className="menu-sep" />
              <form action="/auth/signout" method="post"><button className="menu-item danger" type="submit" style={{ width: "100%" }}><Icon name="lock" size={15} />{t("sign_out")}</button></form>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

function TopBar({ notifications, connected, businessId }: { notifications: Notif[]; connected: boolean; businessId: string }) {
  const { lang, setLang, theme, setTheme, t } = useApp();
  return (
    <header className="topbar">
      <div className="topbar-search">
        <GlobalSearch businessId={businessId} />
      </div>
      <span className="grow" />

      <Link className={"conn-chip " + (connected ? "ok" : "down")} title="WhatsApp" href="/settings">
        <span className="conn-dot" />
        <Icon name={connected ? "whatsapp" : "wifioff"} size={15} />
        <span>{connected ? t("connected") : (lang === "es" ? "Desconectado · Conectar" : "Disconnected · Connect")}</span>
      </Link>

      <div className="seg" style={{ height: 34 }}>
        <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
        <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
      </div>

      <button
        className="iconbtn"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        aria-label={theme === "dark" ? t("light") : t("dark")}
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>

      <Bell notifications={notifications} />

      <Link className="btn btn-primary" href="/orders?new=1">
        <Icon name="plus" /> <span className="hide-narrow">{t("new_order")}</span>
      </Link>
    </header>
  );
}

export function Shell({
  user,
  businessId,
  badges = {},
  secondaryBadges = {},
  notifications = [],
  connected = false,
  objectName = "Pedidos",
  children,
}: {
  user: ShellUser;
  businessId: string;
  badges?: Record<string, number | null>;
  secondaryBadges?: Record<string, number | null>;
  notifications?: Notif[];
  connected?: boolean;
  objectName?: string;
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <ToastProvider>
        <RealtimeNotifier businessId={businessId} userId={user.id} myName={user.name} />
        <div className="app">
          <NavRail badges={badges} secondaryBadges={secondaryBadges} objectName={objectName} user={user} />
          <div className="main">
            <TopBar notifications={notifications} connected={connected} businessId={businessId} />
            {children}
          </div>
        </div>
      </ToastProvider>
    </AppProvider>
  );
}
