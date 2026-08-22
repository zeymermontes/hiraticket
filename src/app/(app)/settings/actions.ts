"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { showOfficialWhatsApp } from "@/lib/whatsapp-official";

// Un negocio en el camino oficial (Cloud API) nunca debe enlazar números por el puente NO oficial
// de whatsmeow — riesgo de baneo —, y los revisores de App Review no deben poder dispararlo. La UI
// esconde estos controles; el guarda lo hace cumplir aunque las acciones se invoquen directamente.
//
// Se comprueba por NEGOCIO y no solo por el correo de quien pulsa. Antes solo miraba el allowlist,
// y el riesgo es del negocio, no de la persona: un compañero de la misma empresa que no estuviera
// en la lista sí veía el flujo de QR y podía añadirle un número unofficial a una empresa ya
// oficial, que es exactamente lo que este guarda existe para impedir.
//
// El allowlist se conserva como segunda condición porque cubre un caso que el negocio no puede: un
// revisor todavía NO tiene sesión oficial cuando entra a probar, y aun así no debe poder tocar
// whatsmeow.
async function blockUnofficial(businessId?: string | null): Promise<boolean> {
  if (await showOfficialWhatsApp()) return true;
  if (!businessId) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select("id")
    .eq("business_id", businessId)
    .eq("connect_method", "official")
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** Ask the worker to (re)connect this session — it will publish a QR. Official (Cloud API)
 *  sessions have no worker: connecting them is just flipping the flag back on (webhook resumes). */
export async function connectSession(sessionId: string): Promise<void> {
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("whatsapp_sessions").select("connect_method, business_id, phone_number_id").eq("id", sessionId).maybeSingle();
  if (s?.connect_method === "official") {
    // Sin phone_number_id no hay a dónde reconectar —- pasa cuando el número se movió a otra
    // cuenta. Marcarla "conectada" aquí sería una mentira cómoda: no queda token con el que
    // enviar ni número por el que recibir. Se deja como está y la pantalla ofrece rehacer el alta.
    if (!s.phone_number_id) { revalidatePath("/settings"); return; }
    await supabase
      .from("whatsapp_sessions")
      .update({ status: "connected", updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    revalidatePath("/settings");
    return;
  }
  if (await blockUnofficial(s?.business_id as string | undefined)) return;
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
  if (await blockUnofficial(businessId)) return;
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
  // El negocio se saca de la propia sesión: esta acción solo recibe el sessionId, y el guarda
  // necesita saber a qué empresa pertenece para ver si ya es oficial.
  const { data: s } = await supabase
    .from("whatsapp_sessions").select("business_id").eq("id", sessionId).maybeSingle();
  if (await blockUnofficial(s?.business_id as string | undefined)) return;
  await supabase
    .from("whatsapp_sessions")
    .update({ connect_method: method, phone: method === "pairing" ? (phone?.trim() || null) : undefined })
    .eq("id", sessionId);
  revalidatePath("/settings");
}
