import { createClient } from "@/lib/supabase/server";
import { getAgents } from "@/lib/chat";
import { getStages, getAreas } from "@/lib/business";

export interface Automation {
  id: string;
  name: string;
  trigger_type: string;
  trigger_value: string | null;
  action_type: string;
  action_payload: Record<string, unknown>;
  enabled: boolean;
  runs: number;
}
export async function getAutomations(businessId: string): Promise<Automation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("automations")
    .select("id, name, trigger_type, trigger_value, action_type, action_payload, enabled, runs")
    .eq("business_id", businessId)
    .order("name");
  return (data ?? []) as Automation[];
}

export interface Product {
  id: string; name: string; kind: "product" | "service"; price: number; active: boolean;
}
export async function getProducts(businessId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products").select("id, name, kind, price, active")
    .eq("business_id", businessId).order("created_at");
  return (data ?? []) as Product[];
}

export interface Appointment {
  id: string; title: string; starts_at: string; status: string;
  contact: { name: string } | null;
}
export async function getAppointments(businessId: string): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("appointments").select("id, title, starts_at, status, contact:contacts(name)")
    .eq("business_id", businessId).order("starts_at", { ascending: true });
  return (data ?? []) as unknown as Appointment[];
}

export interface Campaign {
  id: string; name: string; template: string | null; audience: string | null;
  recipients: number; delivered: number; read: number; sent_at: string | null;
}
export async function getCampaigns(businessId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns").select("id, name, template, audience, recipients, delivered, read, sent_at")
    .eq("business_id", businessId).order("created_at", { ascending: false });
  return (data ?? []) as Campaign[];
}

export interface ReportData {
  totalSales: number;
  orderCount: number;
  byStage: { name: string; color: string; count: number }[];
  byArea: { name: string; color: string; count: number }[];
  byAgent: { name: string; color: string; count: number }[];
}
export async function getReports(businessId: string): Promise<ReportData> {
  const supabase = await createClient();
  const [{ data: orders }, stages, areas, agents] = await Promise.all([
    supabase.from("orders").select("total, stage_id, area_id, assignee_id").eq("business_id", businessId),
    getStages(businessId),
    getAreas(businessId),
    getAgents(businessId),
  ]);
  const rows = orders ?? [];
  const countBy = <T extends { id: string; name: string; color: string }>(
    items: T[], key: "stage_id" | "area_id",
  ) => items.map((it) => ({ name: it.name, color: it.color, count: rows.filter((o) => o[key] === it.id).length }));

  return {
    totalSales: rows.reduce((n, o) => n + Number(o.total ?? 0), 0),
    orderCount: rows.length,
    byStage: countBy(stages, "stage_id"),
    byArea: countBy(areas, "area_id"),
    byAgent: agents.map((a) => ({ name: a.name, color: a.color, count: rows.filter((o) => o.assignee_id === a.id).length })),
  };
}
