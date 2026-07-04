"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Ask the worker to (re)connect this session — it will publish a QR. */
export async function connectSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("whatsapp_sessions")
    .update({ status: "connecting", qr: null, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  revalidatePath("/settings");
}

export async function disconnectSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("whatsapp_sessions")
    .update({ status: "disconnected", qr: null, phone: null, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  revalidatePath("/settings");
}

// TEMP cap: multi-number support isn't production-ready in the worker yet — one number per
// business for now, regardless of plan. Lift by raising/removing this constant.
const MAX_WHATSAPP_SESSIONS = 1;

export async function addSession(businessId: string, label: string): Promise<void> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("whatsapp_sessions").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  if ((count ?? 0) >= MAX_WHATSAPP_SESSIONS) return; // cap reached — UI hides the button too
  await supabase
    .from("whatsapp_sessions")
    .insert({ business_id: businessId, label: label.trim() || "Número", status: "disconnected" });
  revalidatePath("/settings");
}

/** Remove a number. The worker logs out the linked device on its next poll. */
export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("whatsapp_sessions").delete().eq("id", sessionId);
  revalidatePath("/settings");
}

/** Choose QR vs pairing-code (and the phone number for pairing). */
export async function setConnectMethod(
  sessionId: string, method: "qr" | "pairing", phone?: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("whatsapp_sessions")
    .update({ connect_method: method, phone: method === "pairing" ? (phone?.trim() || null) : undefined })
    .eq("id", sessionId);
  revalidatePath("/settings");
}
