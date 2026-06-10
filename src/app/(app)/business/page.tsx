import { getMyBusiness } from "@/lib/queries";
import { getAreas, getStages } from "@/lib/business";
import { getAgents } from "@/lib/chat";
import { BusinessConfig } from "@/components/BusinessConfig";

export const dynamic = "force-dynamic";

export default async function BusinessPage() {
  const business = await getMyBusiness();
  if (!business) return null;

  const [stages, areas, agents] = await Promise.all([
    getStages(business.id),
    getAreas(business.id),
    getAgents(business.id),
  ]);

  return (
    <BusinessConfig
      businessId={business.id}
      businessName={business.name}
      stages={stages}
      areas={areas}
      agents={agents}
      vertical={business.vertical ?? null}
      objectSingular={business.object_singular ?? "Pedido"}
      customFields={(business.custom_fields as string[] | null) ?? []}
      productStages={business.product_stages ?? false}
      showTyping={business.show_typing ?? true}
    />
  );
}
