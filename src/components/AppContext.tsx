"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { type Lang, type StringKey, tr } from "@/lib/i18n";
import { brandRamp, BRAND_VARS } from "@/lib/palette";
import { setMyBrandColor } from "@/app/(app)/profile/actions";

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

/**
 * `brandInitial` / `businessId`: el color de la app viene de la ORGANIZACIÓN activa (0088).
 *
 * Antes vivía solo en el localStorage del navegador, así que era el mismo en todas las
 * organizaciones y no viajaba a otro dispositivo —- justo lo contrario de para lo que se usa, que
 * es saber de un vistazo dónde estás. Ahora manda la base; el localStorage se queda como caché
 * POR ORGANIZACIÓN, solo para que no se vea un parpadeo del color anterior mientras carga.
 *
 * Sin `businessId` (login, alta inicial) se comporta como siempre: localStorage y ya.
 */
export function AppProvider({ children, personal = false, brandInitial, businessId }: {
  children: React.ReactNode; personal?: boolean; brandInitial?: string | null; businessId?: string;
}) {
  const [lang, setLangState] = useState<Lang>("es");
  const [theme, setThemeState] = useState<Theme>("light");
  const [density, setDensityState] = useState<Density>("comfortable");
  const [brand, setBrandState] = useState<string>(brandInitial ?? "");
  const brandKey = businessId ? `brand_${businessId}` : "brand";

  // Hydrate from localStorage after mount (matches the prototype's persistence).
  useEffect(() => {
    setLangState(readLS<Lang>("lang", "es"));
    setThemeState(readLS<Theme>("theme", "light"));
    setDensityState(readLS<Density>("density", "comfortable"));
    // Con organización, el valor bueno llega del servidor: el caché local solo cubre el hueco
    // hasta que hidrata, y nunca pisa lo que dijo la base.
    if (!businessId) setBrandState(readLS<string>("brand", ""));
    else if (brandInitial == null) setBrandState(readLS<string>(brandKey, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, brandInitial]);

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
    // Caché local por organización: evita el parpadeo en la siguiente carga. La verdad está en la
    // membresía (ver setBrand más abajo), esto solo se adelanta.
    try { localStorage.setItem("ht_" + brandKey, JSON.stringify(brand)); } catch {}
  }, [brand, brandKey]);

  const value: AppState = {
    lang,
    theme,
    density,
    brand,
    personal,
    setLang: setLangState,
    setTheme: setThemeState,
    setDensity: setDensityState,
    // Se guarda en la organización activa. La pantalla cambia al instante y la escritura va detrás:
    // esperar al servidor para repintar haría que elegir un color se sintiera lento.
    setBrand: (c: string) => {
      setBrandState(c);
      if (businessId) void setMyBrandColor(c).catch(() => {});
    },
    t: (k) => tr(k, lang),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
