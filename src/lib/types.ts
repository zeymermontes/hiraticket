export type PillColor =
  | "brand" | "blue" | "violet" | "teal" | "green" | "amber" | "red" | "slate";

export interface Business {
  id: string;
  name: string;
  vertical: string;
  object_singular: string;
  onboarded: boolean;
  custom_fields: string[] | null;
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

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
}
