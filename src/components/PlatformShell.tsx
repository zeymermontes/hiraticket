"use client";
import React from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { AppProvider, useApp } from "@/components/AppContext";

function Header() {
  const { lang, theme, setTheme } = useApp();
  return (
    <header className="topbar" style={{ paddingLeft: 24 }}>
      <div className="row gap-2">
        <div className="rail-logo" style={{ width: 34, height: 34, margin: 0, fontSize: 18 }}>H</div>
        <strong style={{ fontSize: 15 }}>Hiraticket</strong>
        <span className="pill pill-brand" style={{ height: 20 }}>{lang === "es" ? "Plataforma" : "Platform"}</span>
      </div>
      <span className="grow" />
      <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
        <Icon name={theme === "dark" ? "sun" : "moon"} />
      </button>
      <Link className="btn btn-sm btn-outline" href="/chat"><Icon name="arrowr" size={14} />{lang === "es" ? "Ir a la app" : "Go to app"}</Link>
    </header>
  );
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <div className="main" style={{ height: "100vh" }}>
        <Header />
        {children}
      </div>
    </AppProvider>
  );
}
