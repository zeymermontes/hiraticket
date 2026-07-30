import { getMyBusiness, getContactsPage } from "@/lib/queries";
import { ContactsScreen } from "@/components/ContactsScreen";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  // Solo la primera ventana: el resto llega con scroll infinito y la búsqueda corre en el servidor.
  // Traer el directorio completo con embebidos era gran parte del "Clientes tarda en abrir".
  const { rows, total } = await getContactsPage(business.id);
  return <ContactsScreen initial={rows} total={total} />;
}
