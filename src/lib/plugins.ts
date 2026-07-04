import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEncrypted, MASK, decryptSecret } from "@/lib/secrets";

export type PricingModel = "addon" | "metered" | "revshare" | "free";
export interface PluginPricing {
  model: PricingModel;
  addon_monthly?: number;
  metered_unit?: string;
  metered_price?: number;
  revshare_pct?: number;
  note?: string;
}
export interface PluginConfigField {
  key: string;
  label: string;
  type: "text" | "secret" | "toggle" | "select";
  options?: string[];
  required?: boolean;
}
export interface PluginGuideStep { title: string; body: string; url?: string }
export interface Plugin {
  id: string;
  name: string;
  category: string;
  provider: string | null;
  description: string | null;
  icon: string | null;
  pricing: PluginPricing;
  config_schema: PluginConfigField[];
  guide: PluginGuideStep[]; // setup instructions shown in the card's info popup
  status: "available" | "coming_soon";
  popular: boolean;
  position: number;
}
export interface InstalledPlugin {
  status: "active" | "disabled";
  config: Record<string, unknown>; // secrets masked for the UI
  mrr: number;
  installed_at: string;
}
export interface CatalogEntry extends Plugin {
  installed: InstalledPlugin | null;
}

/** Monthly fee a plugin contributes to MRR while active. `addon_monthly` is the flat activation
 *  fee and applies to EVERY pricing model (metered/revshare are informational extras on top). */
export function addonMrr(pricing: PluginPricing): number {
  return Number(pricing?.addon_monthly ?? 0);
}

/** Replace secret field values with a mask sentinel so the browser never receives credentials. */
function maskConfig(schema: PluginConfigField[], config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const f of schema) {
    if (f.type === "secret") {
      const v = config[f.key];
      out[f.key] = typeof v === "string" && (v.length > 0 || isEncrypted(v)) ? MASK : "";
    }
  }
  return out;
}

/** The curated catalogue (super-admin managed). Empty if 0049 isn't applied yet. */
export async function getPluginCatalog(): Promise<Plugin[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("plugins").select("*").order("position");
  if (error) return [];
  return (data ?? []).map((p) => ({
    ...(p as unknown as Plugin),
    pricing: ((p as { pricing?: PluginPricing }).pricing ?? { model: "free" }) as PluginPricing,
    config_schema: ((p as { config_schema?: PluginConfigField[] }).config_schema ?? []) as PluginConfigField[],
    guide: (Array.isArray((p as { guide?: PluginGuideStep[] }).guide) ? (p as { guide?: PluginGuideStep[] }).guide : []) as PluginGuideStep[],
  }));
}

/** A plugin's ACTIVE runtime config with secrets DECRYPTED — for server-side integration calls
 *  (checkout, webhooks). Uses the service-role client so public flows (no session) work; callers
 *  must have already authenticated the request some other way (pay_token, webhook verification).
 *  Returns null if the plugin isn't installed+active. NEVER send this to the client. */
export async function getPluginRuntimeConfig(businessId: string, pluginId: string): Promise<Record<string, string> | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("business_plugins").select("status, config").eq("business_id", businessId).eq("plugin_id", pluginId).maybeSingle();
  if (!data || data.status !== "active") return null;
  const raw = (data.config as Record<string, unknown>) ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = typeof v === "string" ? decryptSecret(v) : String(v ?? "");
  return out;
}

/** Catalogue merged with this business's installs (secrets masked). */
export async function getBusinessCatalog(businessId: string): Promise<CatalogEntry[]> {
  const supabase = await createClient();
  const catalog = await getPluginCatalog();
  const { data: installs, error } = await supabase
    .from("business_plugins")
    .select("plugin_id, status, config, mrr, installed_at")
    .eq("business_id", businessId);
  const byId = new Map<string, InstalledPlugin & { plugin_id: string }>(
    error ? [] : (installs ?? []).map((r) => [r.plugin_id as string, r as unknown as InstalledPlugin & { plugin_id: string }]),
  );
  return catalog.map((p) => {
    const inst = byId.get(p.id);
    return {
      ...p,
      installed: inst
        ? { status: inst.status, mrr: Number(inst.mrr) || 0, installed_at: inst.installed_at, config: maskConfig(p.config_schema, (inst.config as Record<string, unknown>) ?? {}) }
        : null,
    };
  });
}
