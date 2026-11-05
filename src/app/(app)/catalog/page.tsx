import { getMyBusiness } from "@/lib/queries";
import { getProducts } from "@/lib/extras";
import { getActiveIntegrations } from "@/lib/plugins";
import { getCatalogFiscal } from "@/lib/facturacionOps";
import { createClient } from "@/lib/supabase/server";
import { CatalogScreen } from "@/components/CatalogScreen";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const [products, integrations] = await Promise.all([getProducts(business.id), getActiveIntegrations(business.id)]);
  // Solo con Hiraticket Facturación activo se piden las claves SAT y el estado de la sincronización.
  const fiscal = integrations.invoicing === "hiraticket_facturacion" && business.mode !== "personal"
    ? await getCatalogFiscal(await createClient(), business.id)
    : null;
  return <CatalogScreen businessId={business.id} products={products} fiscal={fiscal} />;
}
