// Per-day opening hours, shared by the off-hours flow and branch schedules.
// Keyed by weekday number 0=Sun..6=Sat (matches JS getDay() and Go Weekday), displayed Monday-first.
// A day that's not "open" counts as closed all day.
export type DayHours = { open: boolean; from: string; to: string };

export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_LABEL: Record<number, { es: string; en: string }> = {
  1: { es: "Lun", en: "Mon" }, 2: { es: "Mar", en: "Tue" }, 3: { es: "Mié", en: "Wed" },
  4: { es: "Jue", en: "Thu" }, 5: { es: "Vie", en: "Fri" }, 6: { es: "Sáb", en: "Sat" }, 0: { es: "Dom", en: "Sun" },
};

/** A fresh 7-day schedule (index = weekday), open Mon–Sun 9–18 by default. */
export const defaultHours = (): DayHours[] => Array.from({ length: 7 }, () => ({ open: true, from: "09:00", to: "18:00" }));

/** Normalize a possibly-missing/legacy value into a 7-entry array. */
export function normalizeHours(h: unknown): DayHours[] {
  if (Array.isArray(h) && h.length === 7) return h.map((d) => ({ open: !!(d as DayHours)?.open, from: (d as DayHours)?.from ?? "09:00", to: (d as DayHours)?.to ?? "18:00" }));
  return defaultHours();
}

/** One-line summary of a per-day schedule (e.g. "9:00–18:00 · 6 días" or "Horario por día"). */
export function hoursSummary(h: DayHours[] | undefined, lang: "es" | "en"): string | null {
  if (!Array.isArray(h) || h.length !== 7) return null;
  const open = h.filter((d) => d.open);
  if (open.length === 0) return lang === "es" ? "Cerrado" : "Closed";
  const ranges = new Set(open.map((d) => `${d.from}–${d.to}`));
  if (ranges.size === 1) return `${[...ranges][0]} · ${open.length} ${lang === "es" ? "días" : "days"}`;
  return lang === "es" ? "Horario por día" : "Per-day hours";
}
