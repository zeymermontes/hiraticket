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

export async function getSessions(businessId: string): Promise<WaSession[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("id, label, phone, status, qr, connect_method, pairing_code, last_seen")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  return (data ?? []) as WaSession[];
}

export function isConnected(sessions: WaSession[]): boolean {
  return sessions.some((s) => s.status === "connected");
}
