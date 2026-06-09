"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { AppProvider, useApp } from "@/components/AppContext";
import type { StringKey } from "@/lib/i18n";

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

function TopBar({ user }: { user: ShellUser }) {
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

      <form action="/auth/signout" method="post" style={{ display: "flex" }}>
        <button className="iconbtn" type="submit" aria-label={t("sign_out")} title={user.email}>
          <Avatar name={user.name} initials={deriveInitials(user.name)} color="#0E8C82" size={34} />
        </button>
      </form>

      <button className="btn btn-primary" type="button">
        <Icon name="plus" /> <span className="hide-narrow">{t("new_order")}</span>
      </button>
    </header>
  );
}

export function Shell({
  user,
  badges = {},
  children,
}: {
  user: ShellUser;
  badges?: Record<string, number | null>;
  children: React.ReactNode;
}) {
  return (
    <AppProvider>
      <div className="app">
        <NavRail badges={badges} />
        <div className="main">
          <TopBar user={user} />
          {children}
        </div>
      </div>
    </AppProvider>
  );
}
