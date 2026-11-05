"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { pushProduct, removeRemoteProduct, syncProducts, type SyncResult } from "@/lib/facturacionOps";

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
export interface AutomationInput {
  name: string; trigger_type: string; trigger_value: string | null;
  action_type: string; template?: string; area?: string; agent?: string; tag?: string;
  // Schedule config for the time/date triggers (message_hours / message_date).
  schedule?: Record<string, unknown>;
}

function actionPayload(input: AutomationInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.action_type === "send_template" && input.template) payload.template = input.template;
  if (input.action_type === "transfer_area" && input.area) payload.area = input.area;
  if (input.action_type === "assign_agent" && input.agent) payload.agent = input.agent;
  if (input.action_type === "add_tag" && input.tag) payload.tag = input.tag;
  return payload;
}

export async function createAutomation(businessId: string, input: AutomationInput) {
  const supabase = await createClient();
  await supabase.from("automations").insert({
    business_id: businessId,
    name: input.name.trim() || "Flujo",
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value,
    action_type: input.action_type,
    action_payload: actionPayload(input),
    trigger_config: input.schedule ?? {},
    enabled: true,
  });
  revalidatePath("/flows");
}

/** Edit an existing flow's trigger/action/config (keeps its enabled state + run count). */
export async function updateAutomation(id: string, input: AutomationInput) {
  const supabase = await createClient();
  await supabase.from("automations").update({
    name: input.name.trim() || "Flujo",
    trigger_type: input.trigger_type,
    trigger_value: input.trigger_value,
    action_type: input.action_type,
    action_payload: actionPayload(input),
    trigger_config: input.schedule ?? {},
  }).eq("id", id);
  revalidatePath("/flows");
}

/* ---------- products ---------- */
// Con el plugin Hiraticket Facturación y la sincronización hacia allá encendida, cada alta, cambio
// o baja se refleja en el catálogo de Facturación. Va en `after()`: la respuesta al usuario no
// espera a otro servicio, y si ese servicio falla el producto de aquí queda guardado igual (la
// siguiente sincronización lo empareja).
export async function createProduct(businessId: string, input: { name: string; kind: string; price: number; cost?: number | null }) {
  const supabase = await createClient();
  const base = { business_id: businessId, name: input.name.trim() || "Producto", kind: input.kind, price: input.price };
  let { data, error } = await supabase.from("products").insert({ ...base, cost: input.cost ?? null }).select("id").maybeSingle();
  // cost (0057) may not be applied yet — retry without it.
  if (error) ({ data, error } = await supabase.from("products").insert(base).select("id").maybeSingle());
  const id = (data as { id?: string } | null)?.id;
  if (id) after(() => pushProduct(id).catch(() => {}));
  revalidatePath("/catalog");
}
export interface ProductPatch {
  name?: string; price?: number; cost?: number | null; active?: boolean; price_tiers?: { min: number; price: number }[];
  /** Datos fiscales (0096): clave SAT de producto, clave SAT de unidad e IVA propio (null = el del negocio). */
  sat_code?: string | null; sat_unit?: string | null; iva?: number | null;
}
// Lo que existe también del otro lado. Un cambio que solo toca costo, tramos o activo no viaja.
const SYNCED_FIELDS = ["name", "price", "sat_code", "sat_unit", "iva"] as const;
export async function updateProduct(id: string, patch: ProductPatch) {
  const supabase = await createClient();
  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (!error && SYNCED_FIELDS.some((k) => k in patch)) after(() => pushProduct(id).catch(() => {}));
  revalidatePath("/catalog");
}
export async function deleteProduct(id: string) {
  const supabase = await createClient();
  // El enlace con Facturación se lee ANTES de borrar: después ya no hay de dónde sacarlo. Sin 0096
  // la columna no existe y la consulta falla: no había nada que borrar allá.
  const { data: link } = await supabase.from("products").select("business_id, facturacion_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("products").delete().eq("id", id);
  const l = link as { business_id?: string; facturacion_id?: string | null } | null;
  if (!error && l?.business_id && l.facturacion_id) after(() => removeRemoteProduct(l.business_id!, l.facturacion_id!).catch(() => {}));
  revalidatePath("/catalog");
}

/** «Sincronizar ahora» / «Sincronización completa» del catálogo con Hiraticket Facturación. Corre
 *  con el cliente del usuario: RLS decide si puede escribir productos. */
export async function syncCatalog(businessId: string, full: boolean): Promise<SyncResult> {
  const supabase = await createClient();
  const r = await syncProducts(supabase, businessId, full);
  if (r.ok) revalidatePath("/catalog");
  return r;
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
export async function deleteAppointment(id: string) {
  const supabase = await createClient();
  await supabase.from("appointments").delete().eq("id", id);
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
