"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type StringKey, tr } from "@/lib/i18n";

type Theme = "light" | "dark";
type Density = "comfortable" | "compact";

interface AppState {
  lang: Lang;
  theme: Theme;
  density: Density;
  brand: string;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  setBrand: (c: string) => void;
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
  const [density, setDensityState] = useState<Density>("comfortable");
  const [brand, setBrandState] = useState<string>("");

  // Hydrate from localStorage after mount (matches the prototype's persistence).
  useEffect(() => {
    setLangState(readLS<Lang>("lang", "es"));
    setThemeState(readLS<Theme>("theme", "light"));
    setDensityState(readLS<Density>("density", "comfortable"));
    setBrandState(readLS<string>("brand", ""));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("ht_theme", JSON.stringify(theme)); } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem("ht_lang", JSON.stringify(lang)); } catch {}
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try { localStorage.setItem("ht_density", JSON.stringify(density)); } catch {}
  }, [density]);

  useEffect(() => {
    if (brand) document.documentElement.style.setProperty("--brand", brand);
    else document.documentElement.style.removeProperty("--brand");
    try { localStorage.setItem("ht_brand", JSON.stringify(brand)); } catch {}
  }, [brand]);

  const value: AppState = {
    lang,
    theme,
    density,
    brand,
    setLang: setLangState,
    setTheme: setThemeState,
    setDensity: setDensityState,
    setBrand: setBrandState,
    t: (k) => tr(k, lang),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
