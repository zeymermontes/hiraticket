// Días calendario en la zona horaria del negocio.
//
// El servidor corre en UTC. "Hoy" y los límites de un día (00:00 a 23:59:59) tienen que ser los
// del negocio, no los del servidor: a las 7 de la noche en Culiacán, en UTC ya es mañana, y un
// reporte de "hoy" calculado con la fecha del servidor saldría vacío. Todo se resuelve con Intl,
// sin librerías, y con la zona del negocio (`businesses.timezone`).

import { DEFAULT_TZ } from "@/lib/timezones";

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora de pared de un instante en esa zona. */
function wall(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  // Algunos motores devuelven "24" para la medianoche aun con h23.
  if (o.hour === 24) o.hour = 0;
  return o;
}

function safeTz(tz: string | null | undefined): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz || DEFAULT_TZ }); return tz || DEFAULT_TZ; } catch { return DEFAULT_TZ; }
}

/** "YYYY-MM-DD" de ese instante visto desde la zona. */
export function ymdInTz(d: Date, tz: string | null | undefined): string {
  const w = wall(d, safeTz(tz));
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Suma días a un "YYYY-MM-DD" como calendario puro (sin zonas ni horario de verano). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** El instante en que empieza ese día (00:00:00) en la zona. */
export function dayStart(ymd: string, tz: string | null | undefined): Date {
  const z = safeTz(tz);
  const [y, m, d] = ymd.split("-").map(Number);
  // Se parte de la medianoche UTC y se corrige con el desfase que la zona tiene en ese momento;
  // dos vueltas por si la primera cae del otro lado de un cambio de horario.
  const target = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(guess), z);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

/** El último instante de ese día (23:59:59.999) en la zona. */
export function dayEnd(ymd: string, tz: string | null | undefined): Date {
  return new Date(dayStart(addDays(ymd, 1), tz).getTime() - 1);
}
