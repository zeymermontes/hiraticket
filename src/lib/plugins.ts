import { createClient } from "@/lib/supabase/server";
import { isEncrypted, MASK } from "@/lib/secrets";

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
export interface Plugin {
  id: string;
  name: string;
  category: string;
  provider: string | null;
  description: string | null;
  icon: string | null;
  pricing: PluginPricing;
  config_schema: PluginConfigField[];
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

/** Monthly add-on price a plugin contributes to MRR (0 for metered/revshare/free). */
export function addonMrr(pricing: PluginPricing): number {
  return pricing?.model === "addon" ? Number(pricing.addon_monthly ?? 0) : 0;
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
  }));
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
