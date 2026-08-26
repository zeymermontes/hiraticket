/**
 * Órdenes de cobro (0089) — la parte que también entiende el navegador.
 *
 * Aquí solo viven el tipo y las palabras. Nada que toque la base: lo importan tanto el cajón del
 * pedido como la página pública de pago, y las dos son cliente. Lo que sí toca la base está en
 * `src/lib/payments.ts`, que no importa de nadie a propósito (ver el comentario de ese archivo).
 */

export interface Charge {
  id: string;
  seq: number;
  kind: string;               // anticipo | parcialidad | finiquito
  label: string | null;       // lo que escribió el asesor, si quiso otra cosa
  amount: number;
  due_at: string | null;
  status: string;             // draft | sent | paid | void
  pay_token: string | null;
  sent_at: string | null;
  created_at: string;
  /** Suma de los pagos ligados a este cobro. Se calcula al leer; no vive en la tabla. */
  paid: number;
}

export const CHARGE_KINDS = ["anticipo", "parcialidad", "finiquito"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

const KIND_LABEL: Record<string, { es: string; en: string }> = {
  anticipo: { es: "Anticipo", en: "Deposit" },
  parcialidad: { es: "Parcialidad", en: "Installment" },
  finiquito: { es: "Finiquito", en: "Final payment" },
};

export function chargeKindLabel(kind: string, lang: "es" | "en" = "es"): string {
  return KIND_LABEL[kind]?.[lang] ?? (lang === "es" ? "Cobro" : "Charge");
}

/** Cómo se llama este cobro para una persona. Lo que el asesor escribió manda sobre el concepto:
 *  si se molestó en ponerle nombre, es porque el suyo dice más que "Parcialidad". */
export function chargeTitle(c: Pick<Charge, "kind" | "label">, lang: "es" | "en" = "es"): string {
  return (c.label ?? "").trim() || chargeKindLabel(c.kind, lang);
}

/**
 * Qué concepto proponer para un cobro nuevo.
 *
 * Es una sugerencia, no una regla: el asesor puede cambiarla. Pero acierta en el caso normal y eso
 * ahorra un clic en cada cobro —- que es donde se pierde el tiempo de verdad, no en el caso raro.
 *
 * `balance` es lo que falta por pagar del pedido ANTES de este cobro.
 */
export function suggestKind(opts: { existing: number; amount: number; balance: number }): ChargeKind {
  if (opts.existing === 0) return "anticipo";
  // Cubre todo lo que queda → es el último. Con margen de un centavo: los repartos por porcentaje
  // dejan colas de redondeo y no vale la pena que eso cambie el nombre del cobro.
  if (opts.amount >= opts.balance - 0.01) return "finiquito";
  return "parcialidad";
}

/** Un cobro cuenta para el total comprometido salvo que esté anulado. */
export const isLive = (c: Pick<Charge, "status">): boolean => c.status !== "void";

/**
 * ¿Los cobros y el pedido dicen lo mismo?
 *
 * Si alguien agrega un producto después de mandar el finiquito, los cobros ya no suman el total y
 * el cliente tiene en su WhatsApp un link que miente. A propósito NO se recalcula solo: cambiar en
 * silencio un monto que ya se le comunicó a alguien es peor que el descuadre. Se detecta, se
 * enseña, y decide el asesor.
 *
 * Se deriva al leer en vez de guardarse: un campo `desfasado` en la tabla se queda viejo en cuanto
 * alguien edite el pedido por otro camino.
 */
export function chargesGap(charges: Charge[], orderTotal: number): number {
  const committed = charges.filter(isLive).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const gap = Math.round((orderTotal - committed) * 100) / 100;
  return Math.abs(gap) < 0.01 ? 0 : gap;
}
