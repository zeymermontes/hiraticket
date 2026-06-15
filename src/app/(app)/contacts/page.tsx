import { getMyBusiness, getContacts } from "@/lib/queries";
import { ContactsScreen } from "@/components/ContactsScreen";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const business = await getMyBusiness();
  if (!business) return null;
  const contacts = await getContacts(business.id);
  return <ContactsScreen contacts={contacts} />;
}
