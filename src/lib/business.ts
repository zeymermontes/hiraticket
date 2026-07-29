import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface Area {
  id: string;
  name: string;
  color: string;
  route_to: string | null;
  position: number;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
}

async function _getAreas(businessId: string): Promise<Area[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("areas")
    .select("id, name, color, route_to, position")
    .eq("business_id", businessId)
    .order("position", { ascending: true });
  return (data ?? []) as Area[];
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getAreas = cache(_getAreas);

async function _getStages(businessId: string): Promise<Stage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stages")
    .select("id, name, color, position")
    .eq("business_id", businessId)
    .order("position", { ascending: true });
  return (data ?? []) as Stage[];
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getStages = cache(_getStages);
