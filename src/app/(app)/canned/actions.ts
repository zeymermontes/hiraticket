"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface CannedInput {
  title: string;
  body: string;
  category?: string;
  shortcut?: string;
  // El adjunto (opcional). El archivo ya está en Storage: aquí solo viaja su ruta. Ver 0090.
  media_url?: string | null;
  media_mime?: string | null;
  media_name?: string | null;
  media_size?: number | null;
  media_thumb?: string | null;
}

export async function createCanned(businessId: string, input: CannedInput): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").insert({
    business_id: businessId,
    title: input.title.trim() || "Plantilla",
    // Una plantilla que es solo archivo guarda '' —- la columna es not null desde 0001.
    body: input.body.trim(),
    category: input.category?.trim() || "General",
    shortcut: input.shortcut?.trim() || null,
    media_url: input.media_url ?? null,
    media_mime: input.media_mime ?? null,
    media_name: input.media_name ?? null,
    media_size: input.media_size ?? null,
    media_thumb: input.media_thumb ?? null,
  });
  revalidatePath("/canned");
}

export async function updateCanned(id: string, patch: Partial<CannedInput>): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").update(patch).eq("id", id);
  revalidatePath("/canned");
}

/**
 * Borra la plantilla, NO el archivo.
 *
 * Los mensajes que ya salieron apuntan a esa misma ruta de Storage (la plantilla no copia el
 * archivo en cada envío, ver 0090). Borrarlo dejaría en blanco conversaciones viejas. Mismo trato
 * que los stickers favoritos.
 */
export async function deleteCanned(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("canned_messages").delete().eq("id", id);
  revalidatePath("/canned");
}
