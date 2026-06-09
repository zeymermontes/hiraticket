"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type StringKey, tr } from "@/lib/i18n";

type Theme = "light" | "dark";

interface AppState {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  t: (k: StringKey) => string;
}

const Ctx = createContext<AppState | null>(null);

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem("ht_" + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("es");
  const [theme, setThemeState] = useState<Theme>("light");

  // Hydrate from localStorage after mount (matches the prototype's persistence).
  useEffect(() => {
    setLangState(readLS<Lang>("lang", "es"));
    setThemeState(readLS<Theme>("theme", "light"));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ht_theme", JSON.stringify(theme)); } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("ht_lang", JSON.stringify(lang)); } catch {}
  }, [lang]);

  const value: AppState = {
    lang,
    theme,
    setLang: setLangState,
    setTheme: setThemeState,
    t: (k) => tr(k, lang),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
