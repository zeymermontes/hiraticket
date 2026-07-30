"use server";
import { getMyBusiness, getContactsPage, type ContactRow } from "@/lib/queries";

/** Una ventana del directorio para el scroll infinito y la búsqueda del cliente. RLS-scoped. */
export async function loadContactsPage(opts: { q?: string; offset?: number }): Promise<{ rows: ContactRow[]; total: number }> {
  const business = await getMyBusiness();
  if (!business) return { rows: [], total: 0 };
  return getContactsPage(business.id, opts);
}
