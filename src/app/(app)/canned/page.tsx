import { getMyBusiness } from "@/lib/queries";
import { getCanned } from "@/lib/canned";
import { CannedScreen } from "@/components/CannedScreen";
import { officialSessionOf } from "@/lib/cloud-session";
import { showOfficialWhatsApp } from "@/lib/whatsapp-official";

export const dynamic = "force-dynamic";

export default async function CannedPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  // Las plantillas de Meta solo existen con un número por la API oficial (o para quien está en la
  // lista de pruebas). Aquí solo viaja el sí/no: el token de la sesión no sale del servidor.
  const [items, session, tester] = await Promise.all([getCanned(business.id), officialSessionOf(business.id), showOfficialWhatsApp()]);
  return <CannedScreen businessId={business.id} items={items} waTemplates={!!session || tester} />;
}
