"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { addonMrr, type PluginConfigField, type PluginPricing } from "@/lib/plugins";
import { after } from "next/server";
import { encryptSecret, decryptSecret, MASK } from "@/lib/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/url";
import { PLUGIN_ID as FX, listIssuers, getFolios, getWebhook, setWebhook, deleteWebhook } from "@/lib/facturacion";
import { syncProducts } from "@/lib/facturacionOps";

const fxWebhookUrl = (businessId: string) => `${appBaseUrl()}/api/plugins/facturacion/webhook?biz=${businessId}`;

/** Load a plugin's pricing + config schema from the catalogue. */
async function getPluginMeta(supabase: Awaited<ReturnType<typeof createClient>>, pluginId: string) {
  const { data } = await supabase.from("plugins").select("pricing, config_schema, name").eq("id", pluginId).maybeSingle();
  return {
    pricing: ((data?.pricing as PluginPricing) ?? { model: "free" }) as PluginPricing,
    schema: ((data?.config_schema as PluginConfigField[]) ?? []) as PluginConfigField[],
    name: (data?.name as string) ?? pluginId,
  };
}

/** Install (activate) a plugin for a business. Sets the add-on MRR contribution. */
export async function installPlugin(businessId: string, pluginId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { pricing, name } = await getPluginMeta(supabase, pluginId);
  const mrr = addonMrr(pricing);
  const { error } = await supabase.from("business_plugins").upsert({
    business_id: businessId, plugin_id: pluginId, status: "active", mrr, installed_by: user?.id ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id,plugin_id" });
  if (error) return { ok: false, error: error.message };
  await supabase.from("events").insert({ business_id: businessId, parent_type: "business", parent_id: businessId, actor_id: user?.id ?? null, kind: "plus", text: `Plugin activado: ${name}` });
  revalidatePath("/plugins"); revalidatePath("/platform");
  return { ok: true };
}

/** Enable/disable an installed plugin without losing its config. Disabling zeroes its MRR. */
export async function setPluginEnabled(businessId: string, pluginId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { pricing } = await getPluginMeta(supabase, pluginId);
  const mrr = enabled ? addonMrr(pricing) : 0;
  const { error } = await supabase.from("business_plugins").update({ status: enabled ? "active" : "disabled", mrr, updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("plugin_id", pluginId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/plugins"); revalidatePath("/platform");
  return { ok: true };
}

/** Uninstall a plugin (removes its config + MRR). */
export async function uninstallPlugin(businessId: string, pluginId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  // Facturación: antes de perder la llave, se quita el aviso (webhook) que registramos allá, para
  // que su cuenta no siga llamando a una integración que ya no existe. Solo si sigue siendo el
  // nuestro: uno que el negocio haya puesto después a mano no se toca.
  let fxKey = "";
  if (pluginId === FX) {
    const { data } = await supabase.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", pluginId).maybeSingle();
    const k = (data?.config as Record<string, unknown> | undefined)?.api_key;
    fxKey = typeof k === "string" ? decryptSecret(k) : "";
  }
  const { error, count } = await supabase.from("business_plugins").delete({ count: "exact" }).eq("business_id", businessId).eq("plugin_id", pluginId);
  if (error) return { ok: false, error: error.message };
  if (fxKey && count) {
    const w = await getWebhook(fxKey);
    if (w.ok && w.data?.webhook?.url === fxWebhookUrl(businessId)) await deleteWebhook(fxKey);
  }
  revalidatePath("/plugins"); revalidatePath("/platform");
  return { ok: true };
}

export interface SaveConfigResult {
  ok: boolean; error?: string;
  /** `webhook-conflict`: la cuenta ya manda avisos a otra URL; se vuelve a llamar con `replaceWebhook`. */
  code?: string;
  /** Mensaje de confirmación para mostrar al guardar (RFC validado, folios disponibles…). */
  info?: string;
}

/** Hiraticket Facturación: valida la llave contra su cuenta, resuelve el RFC emisor y registra el
 *  aviso (webhook) con el que nos enteramos de que un cliente se facturó. Devuelve lo que hay que
 *  agregar a la configuración antes de guardarla; si algo no cuadra, NO se guarda nada. */
async function prepareFacturacion(
  businessId: string, next: Record<string, unknown>, prev: Record<string, unknown>, replaceWebhook: boolean,
): Promise<SaveConfigResult & { patch?: Record<string, unknown> }> {
  const apiKey = typeof next.api_key === "string" ? decryptSecret(next.api_key).trim() : "";
  if (!apiKey) return { ok: false, error: "Falta la llave de API." };
  const days = String(next.link_vigencia_dias ?? "").trim();
  if (days && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 365)) return { ok: false, error: "Los días de vigencia deben ser un número entre 1 y 365." };

  const iss = await listIssuers(apiKey);
  if (!iss.ok) {
    return { ok: false, error: iss.status === 401 ? "Llave inválida: cópiala completa desde API y webhooks en tu cuenta de Facturación."
      : iss.status === 0 ? "No se pudo conectar con Hiraticket Facturación. Intenta de nuevo." : (iss.error || "No se pudo validar la llave.") };
  }
  const issuers = iss.data?.datos ?? [];
  let emisor = String(next.emisor ?? "").trim().toUpperCase();
  if (!emisor) {
    if (issuers.length === 1) emisor = issuers[0].rfc;
    else if (!issuers.length) return { ok: false, error: "Tu cuenta de Facturación todavía no tiene un RFC dado de alta. Agrégalo en Emisores y vuelve a guardar." };
    else return { ok: false, error: `Tu cuenta tiene varios RFC. Escribe cuál usar: ${issuers.map((i) => i.rfc).join(", ")}.` };
  }
  const issuer = issuers.find((i) => i.rfc.toUpperCase() === emisor);
  if (!issuer) return { ok: false, error: `Ese RFC no está dado de alta en tu cuenta de Facturación${issuers.length ? ` (tienes: ${issuers.map((i) => i.rfc).join(", ")})` : ""}.` };

  const patch: Record<string, unknown> = { emisor };
  // El aviso se registra cuando cambia la llave (puede ser otra cuenta), cuando aún no tenemos su
  // secreto, o cuando el usuario aceptó reemplazar el que había. Registrarlo en cada guardado
  // cambiaría el secreto sin necesidad.
  const url = fxWebhookUrl(businessId);
  const needsHook = replaceWebhook || next.api_key !== prev.api_key || !prev._webhook_secret;
  let hookNote = "";
  if (!url.startsWith("https://")) hookNote = " El aviso automático no se registró porque esta instalación no tiene una dirección https.";
  else if (needsHook) {
    const w = await setWebhook(apiKey, url, replaceWebhook);
    if (!w.ok && w.status === 409) {
      // El mensaje de la API está escrito para quien integra ("manda reemplazar: true"); al usuario
      // se le dice a dónde van hoy los avisos y la pantalla le ofrece reemplazarlo.
      const cur = await getWebhook(apiKey);
      const where = cur.data?.webhook?.url;
      return { ok: false, code: "webhook-conflict", error: where ? `Hoy los manda a: ${where}` : "" };
    }
    if (!w.ok || !w.data?.secreto) return { ok: false, error: w.error || "No se pudo registrar el aviso de facturas." };
    patch._webhook_secret = encryptSecret(w.data.secreto);
  }

  const fol = await getFolios(apiKey);
  const sandbox = fol.data?.ambiente === "sandbox";
  const folios = fol.ok && fol.data ? (sandbox ? " Llave de práctica: nada se timbra de verdad." : ` Folios disponibles: ${Number(fol.data.disponibles) + Number(fol.data.plan?.restantes_este_mes ?? 0)}.`) : "";
  return { ok: true, patch, info: `Conectado con ${issuer.nombre} (${issuer.rfc}).${folios}${hookNote}` };
}

/** Save a plugin's config. Secret fields left as the mask sentinel keep their stored value; new
 *  secret values are encrypted at rest. Non-secret fields are stored as-is. Keys que no están en el
 *  esquema (internas, prefijo `_`) se conservan tal cual. */
export async function savePluginConfig(
  businessId: string, pluginId: string, incoming: Record<string, unknown>, opts: { replaceWebhook?: boolean } = {},
): Promise<SaveConfigResult> {
  const supabase = await createClient();
  const { schema } = await getPluginMeta(supabase, pluginId);
  const { data: existing } = await supabase.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", pluginId).maybeSingle();
  if (!existing) return { ok: false, error: "not-installed" };
  const prev = (existing.config as Record<string, unknown>) ?? {};

  const next: Record<string, unknown> = { ...prev };
  for (const f of schema) {
    const v = incoming[f.key];
    if (f.type === "secret") {
      if (v === MASK || v === undefined) continue;       // unchanged → keep stored (encrypted) value
      next[f.key] = v ? encryptSecret(String(v)) : "";   // new secret → encrypt (or clear)
    } else {
      next[f.key] = v ?? "";
    }
  }

  let info: string | undefined;
  if (pluginId === FX) {
    // Antes de tocar nada del otro lado se comprueba que este usuario PUEDE guardar (RLS: solo
    // administradores). Si no, registraríamos allá un aviso cuyo secreto nunca llegó a guardarse.
    const probe = await supabase.from("business_plugins").update({ updated_at: new Date().toISOString() }, { count: "exact" }).eq("business_id", businessId).eq("plugin_id", pluginId);
    if (probe.error || !probe.count) return { ok: false, error: "Solo un administrador puede configurar plugins." };
    const r = await prepareFacturacion(businessId, next, prev, !!opts.replaceWebhook);
    if (!r.ok) return { ok: false, error: r.error, code: r.code };
    Object.assign(next, r.patch);
    info = r.info;
  }

  // `count` distingue "guardado" de "RLS no dejó escribir" (solo un administrador puede): sin él,
  // un agente vería "guardado" y la llave seguiría siendo la anterior.
  const { error, count } = await supabase.from("business_plugins").update({ config: next, updated_at: new Date().toISOString() }, { count: "exact" }).eq("business_id", businessId).eq("plugin_id", pluginId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Solo un administrador puede configurar plugins." };

  // Primera vez que se enciende la sincronización de productos: se corre una completa en segundo
  // plano para que los dos catálogos arranquen iguales.
  if (pluginId === FX) {
    const mode = String(next.sync_productos || "off");
    if (mode !== "off" && mode !== String(prev.sync_productos || "off")) after(() => syncProducts(createAdminClient(), businessId, true).then(() => undefined, () => undefined));
  }
  revalidatePath("/plugins"); revalidatePath("/catalog");
  return { ok: true, info };
}

/** Record a unit of plugin usage (for the metered pricing model). Stub for Phase 1 — no real
 *  billing yet, but the meter is writable so integrations can start emitting when built. */
export async function recordPluginUsage(businessId: string, pluginId: string, unit: string, qty = 1, meta?: Record<string, unknown>): Promise<void> {
  const supabase = await createClient();
  await supabase.from("plugin_usage").insert({ business_id: businessId, plugin_id: pluginId, unit, qty, meta: meta ?? null });
}
