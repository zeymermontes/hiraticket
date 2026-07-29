"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type StringKey, tr } from "@/lib/i18n";
import { brandRamp, BRAND_VARS } from "@/lib/palette";

type Theme = "light" | "dark";
type Density = "comfortable" | "compact";

interface AppState {
  lang: Lang;
  theme: Theme;
  density: Density;
  brand: string;
  personal: boolean; // 'personal management' mode → tasks/subtasks, no money
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  setBrand: (c: string) => void;
  t: (k: StringKey) => string;
}

// La rampa se deriva del color base (ver `brandRamp`): antes era una tabla de cuatro colores a
// mano que además dejaba fuera --brand-600/-300/-100, así que esos se quedaban en el amarillo
// original al cambiar de marca.

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

export function AppProvider({ children, personal = false }: { children: React.ReactNode; personal?: boolean }) {
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
    const root = document.documentElement;
    const ramp = brandRamp(brand);
    if (ramp) {
      for (const [v, val] of Object.entries(ramp)) root.style.setProperty(v, val);
    } else {
      // empty/default → fall back to tokens.css (Hirata yellow + its ramp)
      BRAND_VARS.forEach((v) => root.style.removeProperty(v));
    }
    // Vive en localStorage, igual que el tema, el idioma y la densidad: es una preferencia de quien
    // la elige y no toca a nadie más del equipo. El precio es que no viaja a otro navegador.
    try { localStorage.setItem("ht_brand", JSON.stringify(brand)); } catch {}
  }, [brand]);

  const value: AppState = {
    lang,
    theme,
    density,
    brand,
    personal,
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
