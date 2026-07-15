import { createClient } from "@/lib/supabase/server";

// Gating for the OFFICIAL WhatsApp flow (Cloud API Embedded Signup / coexistence), which is still in
// testing. Existing tenants keep the whatsmeow QR/pairing flow; only allowlisted emails see the
// official onboarding so we can exercise it end-to-end before widening it to all new businesses.
//
// Allowlist lives in WA_OFFICIAL_EMAILS (comma-separated) — set it on the `hiraticket` web service.
// Kept in env (not hardcoded) so personal test emails don't land in the public repo.
export async function showOfficialWhatsApp(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase().trim();
  if (!email) return false;

  const allow = new Set(
    (process.env.WA_OFFICIAL_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return allow.has(email);
}

// Public config for the Embedded Signup button. Both values are safe client-side; the token
// exchange (server-only) uses WHATSAPP_APP_SECRET. Empty until the Meta app has an ES configuration.
export function embeddedSignupConfig(): { appId: string; configId: string } {
  return {
    appId: process.env.NEXT_PUBLIC_FB_APP_ID ?? "",
    configId: process.env.NEXT_PUBLIC_WA_ES_CONFIG_ID ?? "",
  };
}
