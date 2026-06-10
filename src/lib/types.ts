export type PillColor =
  | "brand" | "blue" | "violet" | "teal" | "green" | "amber" | "red" | "slate";

export interface Business {
  id: string;
  name: string;
  vertical: string;
  object_singular: string;
  onboarded: boolean;
  custom_fields: string[] | null;
  product_stages: boolean;
}

export interface OrderRow {
  id: string;
  code: string;
  priority: "low" | "normal" | "high" | "urgent";
  pay_status: "pending" | "partial" | "paid";
  total: number;
  updated_at: string;
  created_at: string;
  assignee_id: string | null;
  stage: { name: string; color: string } | null;
  area: { name: string; color: string } | null;
  contact: { name: string } | null;
  items: { name: string }[];
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

export const MSG_PAGE = 40; // chat messages loaded per page (initial window + each scroll-up)

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
