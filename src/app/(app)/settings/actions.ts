"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { showOfficialWhatsApp } from "@/lib/whatsapp-official";

// Official-flow (allowlisted) accounts must never link numbers through the unofficial whatsmeow
// bridge — ban risk, and App Review reviewers must not be able to trigger it. The UI hides these
// controls; this guard enforces it even if the actions are invoked directly.
async function officialOnly(): Promise<boolean> {
  return showOfficialWhatsApp();
}

/** Ask the worker to (re)connect this session — it will publish a QR. Official (Cloud API)
 *  sessions have no worker: connecting them is just flipping the flag back on (webhook resumes). */
export async function connectSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: s } = await supabase.from("whatsapp_sessions").select("connect_method").eq("id", sessionId).maybeSingle();
  if (s?.connect_method === "official") {
    await supabase
      .from("whatsapp_sessions")
      .update({ status: "connected", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    revalidatePath("/settings");
    return;
  }
  if (await officialOnly()) return;
  await supabase
    .from("whatsapp_sessions")
    .update({ status: "connecting", qr: null, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  revalidatePath("/settings");
}

export async function disconnectSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: s } = await supabase.from("whatsapp_sessions").select("connect_method").eq("id", sessionId).maybeSingle();
  await supabase
    .from("whatsapp_sessions")
    .update({
      status: "disconnected",
      qr: null,
      // Official sessions keep their number/ids so reconnecting doesn't require re-onboarding.
      ...(s?.connect_method === "official" ? {} : { phone: null }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  revalidatePath("/settings");
}

// TEMP cap: multi-number support isn't production-ready in the worker yet — one number per
// business for now, regardless of plan. Lift by raising/removing this constant.
const MAX_WHATSAPP_SESSIONS = 1;

export async function addSession(businessId: string, label: string): Promise<void> {
  if (await officialOnly()) return;
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
  if (await officialOnly()) return;
  const supabase = await createClient();
  await supabase
    .from("whatsapp_sessions")
    .update({ connect_method: method, phone: method === "pairing" ? (phone?.trim() || null) : undefined })
    .eq("id", sessionId);
  revalidatePath("/settings");
}
