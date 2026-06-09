"use client";
import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { AppProvider, useApp } from "@/components/AppContext";
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
              <Link key={no.id} href={`/chat?c=${no.id}`} className="menu-item" style={{ alignItems: "flex-start" }} onClick={() => setOpen(false)}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--wa)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Icon name="whatsapp" size={15} /></span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, whiteSpace: "normal" }}>{(lang === "es" ? "Nuevo mensaje de " : "New message from ") + no.name}</span>
                  <span className="t-xs muted">{relShort(no.at)}{no.unread > 1 ? ` · ${no.unread}` : ""}</span>
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
  name: string;
  email: string;
}

function NavRail({ badges }: { badges: Record<string, number | null> }) {
  const pathname = usePathname();
  const { t } = useApp();

  const renderItem = (it: NavItem) => {
    const on = pathname === it.href || pathname.startsWith(it.href + "/");
    const badge = badges[it.id] ?? it.badge ?? null;
    return (
      <Link key={it.id} href={it.href} className={"rail-item" + (on ? " on" : "")}>
        <Icon name={it.icon} />
        <span className="rl">{t(it.labelKey)}</span>
        {badge != null && badge > 0 && (
          <span className={"badge" + (it.red ? " badge-red" : "")}>{badge}</span>
        )}
      </Link>
    );
  };

  return (
    <nav className="rail">
      <div className="rail-logo" title="Hiraticket">H</div>
      <div className="rail-nav">{PRIMARY.map(renderItem)}</div>
      <div className="rail-sep" />
      <div className="rail-nav">{ADMIN.map(renderItem)}</div>
    </nav>
  );
}

function TopBar({ user, notifications }: { user: ShellUser; notifications: Notif[] }) {
  const { lang, setLang, theme, setTheme, t } = useApp();
  return (
    <header className="topbar">
      <div className="topbar-search">
        <div className="field field-filled">
          <Icon name="search" />
          <input placeholder={t("search_ph")} />
        </div>
      </div>
      <span className="grow" />

      <button className="conn-chip ok" title="WhatsApp" type="button">
        <span className="conn-dot" />
        <Icon name="whatsapp" size={15} />
        <span>{t("connected")}</span>
      </button>

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

      <form action="/auth/signout" method="post" style={{ display: "flex" }}>
        <button className="iconbtn" type="submit" aria-label={t("sign_out")} title={user.email}>
          <Avatar name={user.name} initials={deriveInitials(user.name)} color="#0E8C82" size={34} />
        </button>
      </form>

      <Link className="btn btn-primary" href="/orders?new=1">
        <Icon name="plus" /> <span className="hide-narrow">{t("new_order")}</span>
      </Link>
    </header>
  );
}

export function Shell({
  user,
  badges = {},
  notifications = [],
  children,
}: {
  user: ShellUser;
  badges?: Record<string, number | null>;
  notifications?: Notif[];
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <div className="app">
        <NavRail badges={badges} />
        <div className="main">
          <TopBar user={user} notifications={notifications} />
          {children}
        </div>
      </div>
    </AppProvider>
  );
}
