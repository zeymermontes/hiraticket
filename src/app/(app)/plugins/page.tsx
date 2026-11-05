import { getMyBusiness } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { getBusinessCatalog } from "@/lib/plugins";
import { createClient } from "@/lib/supabase/server";
import { PluginsScreen } from "@/components/PluginsScreen";

export const dynamic = "force-dynamic";

export default async function PluginsPage({ searchParams }: { searchParams: Promise<{ facturacion?: string }> }) {
  const business = await getMyBusiness();
  if (!business) return null;
  // Liga que da el panel de Facturación para conectar con un código ya escrito. Solo se acepta con
  // la forma de un código (8 letras o números, con o sin guion): nada más llega a la pantalla.
  const raw = ((await searchParams).facturacion ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const linkCode = raw.length === 8 ? raw : null;

  const entries = await getBusinessCatalog(business.id);
  // Role straight from the membership row (no profiles join in the way).
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: mem } = user
    ? await supabase.from("business_members").select("role").eq("business_id", business.id).eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdmin = mem?.role === "admin";

  return <PluginsScreen businessId={business.id} businessName={business.name} entries={entries} isAdmin={!!isAdmin} linkCode={linkCode} />;
}
