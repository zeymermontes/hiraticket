import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

/**
 * Registra una etiqueta en el catálogo del negocio, si no estaba ya.
 *
 * Se llama desde cada sitio que aplica una etiqueta a un contacto —- no solo desde el selector—,
 * para que el catálogo quede completo sin importar por dónde haya entrado la etiqueta: a mano, o
 * por un flujo automático. Best-effort y silencioso a propósito: que el catálogo no se entere de
 * una etiqueta nunca debe impedir que la etiqueta se aplique.
 */
export async function ensureTag(supabase: AnySupabase, businessId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await supabase.from("tags").insert({ business_id: businessId, name: clean });
  // Sin comprobar error: la violación de unicidad (la etiqueta ya estaba) es tan buen resultado
  // como el insert exitoso — en los dos casos el catálogo ya la tiene.
}

export interface TagCatalogItem { id: string; name: string }

/**
 * El catálogo completo del negocio, para administrarlo (Negocio → Etiquetas). Se ordena
 * alfabético sin distinguir mayúsculas, igual que el selector — el collation de la base no es de
 * fiar para eso.
 */
export async function listTagCatalog(businessId: string): Promise<TagCatalogItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("tags").select("id, name").eq("business_id", businessId);
  return ((data ?? []) as TagCatalogItem[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
