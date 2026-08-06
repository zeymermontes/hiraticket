import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/secrets";

// Lookups for OFFICIAL (Cloud API / coexistence) WhatsApp sessions. These rows live in
// whatsapp_sessions with connect_method='official' and are invisible to the whatsmeow worker.
// Uses the admin client on purpose: the webhook has no user session, and the outbox flush
// runs inside server actions where the token column should never transit RLS-selected rows.

export interface CloudSession {
  id: string;
  businessId: string;
  /** Display number, normalized to "+<digits>". */
  phone: string | null;
  wabaId: string;
  phoneNumberId: string;
  /** Decrypted business token from Embedded Signup. */
  token: string;
}

const COLS = "id, business_id, phone, waba_id, phone_number_id, cloud_token";

type Row = {
  id: string;
  business_id: string;
  phone: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  cloud_token: string | null;
};

function map(row: Row | null): CloudSession | null {
  if (!row || !row.waba_id || !row.phone_number_id || !row.cloud_token) return null;
  const token = decryptSecret(row.cloud_token);
  if (!token) return null; // PLUGIN_SECRET_KEY missing/rotated — treat as not connected
  return {
    id: row.id,
    businessId: row.business_id,
    phone: row.phone,
    wabaId: row.waba_id,
    phoneNumberId: row.phone_number_id,
    token,
  };
}

/** The business's connected official session, or null (no row / disconnected / undecryptable). */
export async function officialSessionOf(businessId: string): Promise<CloudSession | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select(COLS)
    .eq("business_id", businessId)
    .eq("connect_method", "official")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  return map(data as Row | null);
}

/** Webhook routing: phone_number_id → session (only while connected). */
export async function officialSessionByPhoneNumberId(phoneNumberId: string): Promise<CloudSession | null> {
  if (!phoneNumberId) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("whatsapp_sessions")
    .select(COLS)
    .eq("phone_number_id", phoneNumberId)
    .eq("connect_method", "official")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  return map(data as Row | null);
}
