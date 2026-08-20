import type { DayHours } from "./hours";

export type PillColor =
  | "brand" | "blue" | "violet" | "teal" | "green" | "amber" | "red" | "slate";

/** A physical branch the customer can pay at in person. */
export interface Branch {
  id: string;
  name: string;
  address: string;
  maps_url?: string; // Google Maps / location link
  phone?: string;
  hours?: DayHours[]; // per-day opening hours (index 0=Sun..6=Sat)
}

/** A bank account / card the customer can transfer to. At least one of account/clabe/card is required. */
export interface BankAccount {
  id: string;
  bank: string;
  holder: string; // account holder name
  account?: string; // número de cuenta
  clabe?: string; // CLABE
  card?: string; // card number
  note?: string;
}

export interface Business {
  id: string;
  name: string;
  vertical: string;
  object_singular: string;
  onboarded: boolean;
  custom_fields: string[] | null;
  product_stages: boolean;
  show_typing: boolean; // appear "online" to receive customers' typing indicators
  mode: "business" | "personal"; // 'personal' → tasks/subtasks, no prices/payments
  allow_groups: boolean; // opt-in: show/reply to WhatsApp group chats (chat-only, no orders)
  timezone: string; // IANA tz (e.g. America/Mexico_City) — used by schedule-based flows
  branches: Branch[]; // physical locations (pay in person)
  bank_accounts: BankAccount[]; // transfer destinations
  pay_branch_enabled: boolean; // offer "pay at branch" on the checkout page
  pay_transfer_enabled: boolean; // offer "bank transfer" on the checkout page
  invoice_add_tax: boolean; // checking "Requiere factura" adds tax to the order total
  invoice_tax_rate: number; // % applied when it does (default 16 — IVA MX)
  manual_margin_pct: number; // % of the sale that counts as profit for manually-typed items (default 50)
  /** Desde qué etapa un pedido cuenta como terminado (0072). null = la última, como siempre. */
  done_from_stage_id?: string | null;
  /** A qué etapa se le pregunta "¿marcar como pagado?" (0075). null = la última, como siempre. */
  confirm_payment_stage_id?: string | null;
  /** Si esa pregunta está encendida (0076). false = nunca preguntar (un flujo que ya haya
   *  decidido por adelantado sigue aplicando igual). */
  confirm_payment_enabled?: boolean;
  /** Galería de anuncios del link de pago (0081). El cliente ve UNO al azar por visita. */
  pay_promo_images?: PayPromo[];
  /** Dónde lo ve: 'off' no se muestra, 'below' debajo del ticket, 'popup' al abrir. */
  pay_promo_placement?: PayPromoPlacement;
}

/** Un anuncio de la galería: imagen pública en el bucket 'media' (0081). */
export interface PayPromo {
  id: string;
  url: string;
}

/** Dónde aparece el anuncio en el link de pago (0080). */
export type PayPromoPlacement = "off" | "below" | "popup";

export interface OrderRow {
  id: string;
  code: string;
  priority: "low" | "normal" | "high" | "urgent";
  pay_status: "pending" | "partial" | "paid";
  total: number;
  updated_at: string;
  created_at: string;
  due_at: string | null;
  assignee_id: string | null;
  stage_id: string | null; // the table filters by id now that filtering runs in SQL
  area_id: string | null;
  cancelled_at?: string | null; // 0065 — se muestra marcado y deja de contar como venta
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  contact: { name: string } | null;
  items: { name: string }[];
  pending_proof?: boolean; // a customer transfer receipt is awaiting review
}

/** A deadline that has passed and the work isn't done yet. */
export function isOverdue(dueAt: string | null | undefined, done?: boolean): boolean {
  return !!dueAt && !done && Date.parse(dueAt) < Date.now();
}

const PRIORITY_COLOR: Record<OrderRow["priority"], PillColor> = {
  low: "slate",
  normal: "blue",
  high: "amber",
  urgent: "red",
};

export function priorityColor(p: OrderRow["priority"]): PillColor {
  return PRIORITY_COLOR[p] ?? "slate";
}

export const MSG_PAGE = 25; // chat messages loaded per page (initial window + each scroll-up)

export interface PriceTier { min: number; price: number }
/** Unit price for `qty` honoring quantity tiers — the tier with the highest `min` ≤ qty wins;
 *  below all tiers the base price applies. */
export function tierPrice(base: number, tiers: PriceTier[], qty: number): number {
  let price = base;
  let bestMin = 0;
  for (const t of tiers ?? []) {
    if (qty >= t.min && t.min > bestMin) { price = t.price; bestMin = t.min; }
  }
  return price;
}

const TAG_COLORS: PillColor[] = ["brand", "blue", "violet", "teal", "green", "amber", "red", "slate"];
/** Deterministic color for a tag name (so the same tag is always the same color). */
export function tagColor(name: string): PillColor {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export const PRIORITY_LABEL: Record<string, { es: string; en: string }> = {
  low: { es: "Baja", en: "Low" },
  normal: { es: "Normal", en: "Normal" },
  high: { es: "Alta", en: "High" },
  urgent: { es: "Urgente", en: "Urgent" },
};

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
}

/** Semáforo de cobro: rojo = nada pagado, ámbar = pago parcial, verde = pagado. Un solo mapeo para
 *  que la tabla, el kanban, la agenda, el chat y el drawer coincidan sin que cada uno lo repita. */
export function payStatusColor(status?: string | null): PillColor {
  return status === "paid" ? "green" : status === "partial" ? "amber" : "red";
}

export function payStatusLabel(status: string | null | undefined, lang: "es" | "en"): string {
  return status === "paid" ? (lang === "es" ? "Pagado" : "Paid")
    : status === "partial" ? (lang === "es" ? "Parcial" : "Partial")
    : (lang === "es" ? "Pendiente" : "Pending");
}
