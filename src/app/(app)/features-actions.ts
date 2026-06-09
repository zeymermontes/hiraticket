"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* ---------- automations ---------- */
export async function toggleAutomation(id: string, enabled: boolean) {
  const supabase = await createClient();
  await supabase.from("automations").update({ enabled }).eq("id", id);
  revalidatePath("/flows");
}
export async function deleteAutomation(id: string) {
  const supabase = await createClient();
  await supabase.from("automations").delete().eq("id", id);
  revalidatePath("/flows");
}
export async function createAutomation(
  businessId: string,
  input: {
    name: string; trigger_type: string; trigger_value: string | null;
    action_type: string; template?: string; area?: string;
  },
) {
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (input.action_type === "send_template" && input.template) payload.template = input.template;
  if (input.action_type === "transfer_area" && input.area) payload.area = input.area;

  await supabase.from("automations").insert({
    business_id: businessId,
    name: input.name.trim() || "Flujo",
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value,
    action_type: input.action_type,
    action_payload: payload,
    enabled: true,
  });
  revalidatePath("/flows");
}

/* ---------- products ---------- */
export async function createProduct(businessId: string, input: { name: string; kind: string; price: number }) {
  const supabase = await createClient();
  await supabase.from("products").insert({
    business_id: businessId, name: input.name.trim() || "Producto", kind: input.kind, price: input.price,
  });
  revalidatePath("/catalog");
}
export async function updateProduct(id: string, patch: { name?: string; price?: number; active?: boolean }) {
  const supabase = await createClient();
  await supabase.from("products").update(patch).eq("id", id);
  revalidatePath("/catalog");
}
export async function deleteProduct(id: string) {
  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  revalidatePath("/catalog");
}

/* ---------- appointments ---------- */
export async function createAppointment(businessId: string, input: { title: string; starts_at: string }) {
  const supabase = await createClient();
  await supabase.from("appointments").insert({
    business_id: businessId, title: input.title.trim() || "Cita", starts_at: input.starts_at,
  });
  revalidatePath("/agenda");
}
export async function setAppointmentStatus(id: string, status: "scheduled" | "done" | "canceled") {
  const supabase = await createClient();
  await supabase.from("appointments").update({ status }).eq("id", id);
  revalidatePath("/agenda");
}

/* ---------- campaigns ---------- */
export async function sendCampaign(businessId: string, input: { name: string; template: string; audience: string }) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("contacts").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  const recipients = count ?? 0;
  await supabase.from("campaigns").insert({
    business_id: businessId,
    name: input.name.trim() || "Campaña",
    template: input.template,
    audience: input.audience,
    recipients,
    delivered: recipients,
    read: Math.floor(recipients * 0.7),
    sent_at: new Date().toISOString(),
  });
  revalidatePath("/campaigns");
}
