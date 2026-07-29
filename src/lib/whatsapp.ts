import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface WaSession {
  id: string;
  label: string;
  phone: string | null;
  status: "disconnected" | "qr" | "connecting" | "connected" | "reconnecting";
  qr: string | null;
  connect_method: "qr" | "pairing";
  pairing_code: string | null;
  last_seen: string | null;
}

async function _getSessions(businessId: string): Promise<WaSession[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("id, label, phone, status, qr, connect_method, pairing_code, last_seen")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  return (data ?? []) as WaSession[];
}

/** Envuelto en React cache(): dentro de UNA petición, varias llamadas con los mismos argumentos
 *  se resuelven con un solo viaje a Supabase. Importa porque el layout y la página se renderizan en
 *  la misma petición y ambos piden esto — antes eran dos viajes idénticos, y a ~68 ms cada uno
 *  (Render en Oregon, Supabase en us-east-1) eso se nota en cada clic.
 *  NO es caché entre peticiones: cada request vuelve a leer datos frescos. */
export const getSessions = cache(_getSessions);

export function isConnected(sessions: WaSession[]): boolean {
  return sessions.some((s) => s.status === "connected");
}
