"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addonMrr, type PluginConfigField, type PluginPricing } from "@/lib/plugins";
import { encryptSecret, MASK } from "@/lib/secrets";

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
  const { data: { user } } = await supabase.auth.getUser();
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
  const { error } = await supabase.from("business_plugins").delete().eq("business_id", businessId).eq("plugin_id", pluginId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/plugins"); revalidatePath("/platform");
  return { ok: true };
}

/** Save a plugin's config. Secret fields left as the mask sentinel keep their stored value; new
 *  secret values are encrypted at rest. Non-secret fields are stored as-is. */
export async function savePluginConfig(businessId: string, pluginId: string, incoming: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { schema } = await getPluginMeta(supabase, pluginId);
  const { data: existing } = await supabase.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", pluginId).maybeSingle();
  const prev = (existing?.config as Record<string, unknown>) ?? {};

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
  const { error } = await supabase.from("business_plugins").update({ config: next, updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("plugin_id", pluginId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/plugins");
  return { ok: true };
}

/** Record a unit of plugin usage (for the metered pricing model). Stub for Phase 1 — no real
 *  billing yet, but the meter is writable so integrations can start emitting when built. */
export async function recordPluginUsage(businessId: string, pluginId: string, unit: string, qty = 1, meta?: Record<string, unknown>): Promise<void> {
  const supabase = await createClient();
  await supabase.from("plugin_usage").insert({ business_id: businessId, plugin_id: pluginId, unit, qty, meta: meta ?? null });
}
