"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { pushProduct, removeRemoteProduct, syncProducts, ensureProductEvents, loadFxConfig, type SyncResult } from "@/lib/facturacionOps";
import { searchSatCatalog, type SatKey } from "@/lib/facturacion";

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
export async function createProduct(businessId: string, input: { name: string; kind: string; price: number; cost?: number | null; sat_code?: string | null; sat_unit?: string | null }) {
  const supabase = await createClient();
  const base = { business_id: businessId, name: input.name.trim() || "Producto", kind: input.kind, price: input.price };
  // Las claves SAT solo viajan si vienen: sus columnas son de 0096 y el alta normal no depende de ella.
  const fiscal = {
    ...(input.sat_code && /^\d{8}$/.test(input.sat_code) ? { sat_code: input.sat_code } : {}),
    ...(input.sat_unit && /^[A-Za-z0-9]{1,3}$/.test(input.sat_unit) ? { sat_unit: input.sat_unit.toUpperCase() } : {}),
  };
  let { data, error } = await supabase.from("products").insert({ ...base, ...fiscal, cost: input.cost ?? null }).select("id").maybeSingle();
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
  // Reactivar también viaja: un producto que se desactivó porque se borró allá vuelve a crearse allá.
  if (!error && (SYNCED_FIELDS.some((k) => k in patch) || patch.active === true)) after(() => pushProduct(id).catch(() => {}));
  revalidatePath("/catalog");
}
/** Datos de facturación de varios productos de una vez (selección múltiple del catálogo). Solo
 *  cambia los campos que vienen en `patch`; los demás se quedan como estaban. Con `onlyEmpty`, cada
 *  campo se escribe nada más en los productos que no lo tenían. */
export async function updateProductsFiscal(ids: string[], patch: Pick<ProductPatch, "sat_code" | "sat_unit" | "iva">, onlyEmpty = false): Promise<{ ok: boolean; count: number }> {
  const list = [...new Set(ids)].slice(0, 500);
  const fields = (["sat_code", "sat_unit", "iva"] as const).filter((k) => k in patch);
  if (!list.length || !fields.length) return { ok: true, count: 0 };
  if (patch.sat_code != null && !/^\d{8}$/.test(patch.sat_code)) return { ok: false, count: 0 };
  if (patch.sat_unit != null && !/^[A-Z0-9]{1,3}$/.test(patch.sat_unit)) return { ok: false, count: 0 };
  const supabase = await createClient();
  const touched = new Set<string>();
  if (onlyEmpty) {
    // Campo por campo: cada uno va solo a los productos que lo tienen vacío.
    for (const k of fields) {
      const { data, error } = await supabase.from("products").update({ [k]: patch[k] }).in("id", list).is(k, null).select("id");
      if (error) return { ok: false, count: touched.size };
      for (const r of (data ?? []) as { id: string }[]) touched.add(r.id);
    }
  } else {
    const upd: Record<string, unknown> = {};
    for (const k of fields) upd[k] = patch[k];
    const { data, error } = await supabase.from("products").update(upd).in("id", list).select("id");
    if (error) return { ok: false, count: 0 };
    for (const r of (data ?? []) as { id: string }[]) touched.add(r.id);
  }
  // Los tres campos viajan a Facturación: cada producto tocado se manda.
  for (const id of touched) after(() => pushProduct(id).catch(() => {}));
  revalidatePath("/catalog");
  return { ok: true, count: touched.size };
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
  // De paso, si el aviso registrado en Facturación es de antes de los eventos del catálogo, se pide
  // de nuevo (como mucho una vez al día) para que los cambios de allá lleguen solos.
  if (r.ok) after(() => ensureProductEvents(businessId).catch(() => {}));
  if (r.ok) revalidatePath("/catalog");
  return r;
}

/** Buscador de claves del SAT (producto/servicio o unidad) por nombre, para el catálogo. La llave de
 *  Facturación nunca sale del servidor: el navegador llama aquí y aquí se consulta. Solo responde a
 *  quien pertenece al negocio (RLS decide si puede leerlo). */
export async function searchSatKeys(businessId: string, kind: "productos" | "unidades", q: string): Promise<SatKey[]> {
  const text = q.trim().slice(0, 60);
  if (text.length < 3) return [];
  const supabase = await createClient();
  const { data: mine } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
  if (!mine) return [];
  const cfg = await loadFxConfig(businessId);
  if (!cfg) return [];
  const r = await searchSatCatalog(cfg.apiKey, kind, text);
  return r.ok ? (r.data?.datos ?? []).slice(0, 50).map((d) => ({ clave: String(d.clave), nombre: String(d.nombre) })) : [];
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
