/**
 * La paleta compartida: color de avatar en Perfil y color de marca de la app en Ajustes.
 *
 * Un grupo por matiz, con tres tonos cada uno. Los primeros doce (el tono medio de cada matiz) son
 * la paleta original de `color_from_email` (0042), así que a nadie le cambia el color que ya tenía.
 *
 * Ninguno pasa de cierta claridad a propósito: las iniciales del avatar son blancas fijas
 * (`.av { color: #fff }`), y un pastel se vería como blanco sobre casi blanco.
 */
export const PALETTE_GROUPS: string[][] = [
  ["#14B8A6", "#0E8C82", "#0B5F58"], // brand
  ["#3B82F6", "#2563EB", "#1D4ED8"], // azul
  ["#8B5CF6", "#7C3AED", "#6D28D9"], // violeta
  ["#EC4899", "#DB2777", "#BE185D"], // rosa
  ["#EF4444", "#DC2626", "#B91C1C"], // rojo
  ["#F97316", "#EA580C", "#C2410C"], // naranja
  ["#D97706", "#CA8A04", "#92400E"], // ámbar
  ["#22C55E", "#16A34A", "#15803D"], // verde
  ["#06B6D4", "#0891B2", "#0E7490"], // cian
  ["#6366F1", "#4F46E5", "#4338CA"], // índigo
  ["#A855F7", "#9333EA", "#7E22CE"], // púrpura
  ["#2DD4BF", "#0D9488", "#0F766E"], // turquesa
  ["#F43F5E", "#E11D48", "#BE123C"], // carmín
  ["#D946EF", "#C026D3", "#A21CAF"], // fucsia
  ["#0EA5E9", "#0284C7", "#0369A1"], // celeste
  ["#10B981", "#059669", "#047857"], // esmeralda
  ["#84CC16", "#65A30D", "#4D7C0F"], // lima
  ["#94A3B8", "#64748B", "#475569"], // pizarra
];

type RGB = [number, number, number];

function parseHex(hex: string): RGB | null {
  const h = hex.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");

/** Mezcla hacia blanco (t > 0) o hacia negro (t < 0). */
function shift([r, g, b]: RGB, t: number): RGB {
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  return [r + (target - r) * k, g + (target - g) * k, b + (target - b) * k];
}

/** Luminancia relativa (WCAG), para decidir si el texto encima va blanco o negro. */
function luminance([r, g, b]: RGB): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Deriva la rampa completa de variables CSS a partir de un color base.
 *
 * Antes había una tabla escrita a mano con cuatro colores, y solo definía cuatro de las seis
 * variables que usa `tokens.css` — así que al cambiar la marca, `--brand-600`, `--brand-300` y
 * `--brand-100` se quedaban en el amarillo original. Derivarla deja cualquier color coherente y
 * permite ofrecer la paleta entera en vez de cuatro opciones.
 *
 * El texto encima se elige por contraste, no a mano: con un amarillo tiene que ser oscuro y con un
 * azul marino, blanco.
 */
export function brandRamp(hex: string): Record<string, string> | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(Math.round);
  return {
    "--brand": toHex(rgb),
    "--brand-600": toHex(shift(rgb, -0.08)),
    "--brand-700": toHex(shift(rgb, -0.22)),
    "--brand-300": toHex(shift(rgb, 0.45)),
    "--brand-100": toHex(shift(rgb, 0.72)),
    "--brand-50": toHex(shift(rgb, 0.88)),
    "--on-brand": luminance(rgb) > 0.42 ? "#1A1606" : "#ffffff",
    "--sh-brand": `0 6px 18px rgba(${r},${g},${b},.30)`,
  };
}

/** Las variables que toca `brandRamp`, para poder quitarlas y volver al valor de tokens.css. */
export const BRAND_VARS = ["--brand", "--brand-600", "--brand-700", "--brand-300", "--brand-100", "--brand-50", "--on-brand", "--sh-brand"];
