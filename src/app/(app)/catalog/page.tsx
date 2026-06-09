import { getMyBusiness } from "@/lib/queries";
import { getProducts } from "@/lib/extras";
import { CatalogScreen } from "@/components/CatalogScreen";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const products = await getProducts(business.id);
  return <CatalogScreen businessId={business.id} products={products} />;
}
