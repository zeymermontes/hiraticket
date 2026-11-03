// Zonas horarias para el selector del negocio y para el pie de los flujos de horario.
//
// Antes había una lista fija de 15 zonas; un negocio en Culiacán (America/Mazatlan) no podía
// elegir la suya. Ahora la lista sale del propio navegador (Intl.supportedValuesOf), con las
// zonas de México al frente y con nombre de ciudad, porque "Mazatlan" no le dice nada a alguien
// de Culiacán o de Hermosillo.
//
// Se canonicaliza cada id para que no aparezcan alias repetidos (p. ej. Buenos_Aires dos veces)
// y se descartan los pseudo-husos Etc/GMT±N: no son lugares, solo desfases, y confunden al lado de
// las ciudades. UTC se conserva una sola vez, al final.

export const DEFAULT_TZ = "America/Mexico_City";

/** Zonas de México con el nombre con el que la gente las reconoce. El orden es el del selector. */
export const MX_ZONES: { tz: string; es: string; en: string }[] = [
  { tz: "America/Mexico_City", es: "Ciudad de México · Centro", en: "Mexico City · Central" },
  { tz: "America/Monterrey", es: "Monterrey", en: "Monterrey" },
  { tz: "America/Merida", es: "Mérida", en: "Mérida" },
  { tz: "America/Matamoros", es: "Matamoros · Reynosa (frontera NE)", en: "Matamoros · Reynosa (NE border)" },
  { tz: "America/Mazatlan", es: "Culiacán · Mazatlán · Sinaloa / Nayarit / BCS", en: "Culiacán · Mazatlán · Sinaloa / Nayarit / BCS" },
  { tz: "America/Chihuahua", es: "Chihuahua", en: "Chihuahua" },
  { tz: "America/Ojinaga", es: "Ciudad Juárez · Ojinaga", en: "Ciudad Juárez · Ojinaga" },
  { tz: "America/Hermosillo", es: "Hermosillo · Sonora", en: "Hermosillo · Sonora" },
  { tz: "America/Tijuana", es: "Tijuana · Mexicali · Baja California", en: "Tijuana · Mexicali · Baja California" },
  { tz: "America/Cancun", es: "Cancún · Quintana Roo", en: "Cancún · Quintana Roo" },
  { tz: "America/Bahia_Banderas", es: "Bahía de Banderas", en: "Bahía de Banderas" },
];

const FALLBACK_ZONES = [
  ...MX_ZONES.map((z) => z.tz),
  "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "Europe/Madrid", "UTC",
];

function canonical(tz: string): string | null {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone; } catch { return null; }
}

let cache: string[] | null = null;

/** Todas las zonas IANA que conoce el navegador, canónicas, sin Etc/GMT±N y sin repetidas.
 *  Ordenadas por región y ciudad; UTC al final. */
export function listTimeZones(): string[] {
  if (cache) return cache;
  let raw: string[] = FALLBACK_ZONES;
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof sv === "function") raw = sv.call(Intl, "timeZone");
  } catch { /* navegador viejo: lista fija */ }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tz of raw) {
    if (tz.startsWith("Etc/") || tz === "GMT" || /^(UTC|GMT)[+-]/.test(tz)) continue;
    const c = canonical(tz);
    if (!c || c === "UTC" || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  out.sort((a, b) => a.localeCompare(b));
  out.push("UTC");
  cache = out;
  return out;
}

/** "GMT-7" / "GMT+1" para la zona ahora mismo (cambia con el horario de verano). */
export function tzOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const p = parts.find((x) => x.type === "timeZoneName")?.value || "";
    return p === "GMT" ? "GMT+0" : p;
  } catch { return ""; }
}

/** Nombre legible: la ciudad (sin región ni guiones bajos). Para México, el nombre amigable. */
export function tzLabel(tz: string, lang: "es" | "en"): string {
  const mx = MX_ZONES.find((z) => z.tz === tz);
  if (mx) return lang === "es" ? mx.es : mx.en;
  if (tz === "UTC") return "UTC";
  return tz.split("/").slice(1).join(" / ").replace(/_/g, " ") || tz;
}

/** "America" → "América" en español. */
export function tzRegion(tz: string, lang: "es" | "en"): string {
  const r = tz.split("/")[0];
  if (lang !== "es") return r;
  return ({ America: "América", Europe: "Europa", Asia: "Asia", Africa: "África", Pacific: "Pacífico", Atlantic: "Atlántico", Indian: "Índico", Australia: "Australia", Antarctica: "Antártida", Arctic: "Ártico" } as Record<string, string>)[r] ?? r;
}

/** Hora actual en esa zona, "10:32 a.m." */
export function tzNow(tz: string, lang: "es" | "en"): string {
  try { return new Date().toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
