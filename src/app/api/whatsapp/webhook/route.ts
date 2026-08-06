import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ingestCloudEvent } from "@/lib/cloud-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WhatsApp Cloud API webhook (app-level, shared by ALL onboarded numbers).
//
// This is the OFFICIAL Cloud API channel (Tech Provider / Coexistence) — separate from the
// whatsmeow worker, which is an unofficial linked-device bridge and does NOT use webhooks.
// Meta calls this single endpoint for every WABA connected under our app; we route each event
// by the `phone_number_id` inside the payload.
//
//   GET  → verification handshake (Meta echoes back hub.challenge when the token matches).
//   POST → inbound messages + status updates (payload signed with the app secret).
//
// Env:
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN  secret we invented; must match what's set in the Meta panel.
//   WHATSAPP_APP_SECRET            Meta app secret; used to verify the X-Hub-Signature-256 HMAC.

// --- Verification handshake -------------------------------------------------
// Meta sends: GET ?hub.mode=subscribe&hub.verify_token=<ours>&hub.challenge=<number>
// We must reply with the raw challenge (plain text, 200) ONLY when the token matches.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge") ?? "";

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// --- Event delivery ---------------------------------------------------------
// Always ack 200 fast (Meta retries non-2xx aggressively and will disable the webhook after
// repeated failures). We verify the signature, then hand off; unprocessable payloads are ignored.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    // Bad/missing signature — someone other than Meta, or the app secret isn't set yet.
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(raw) as WebhookBody;
    // WhatsApp batches events: entry[] → changes[] → value. Each change routes by the
    // phone_number_id inside its value (see src/lib/cloud-ingest.ts). Processed inline —
    // ingest never throws, and per-event work is small enough to stay under Meta's timeout.
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        await ingestCloudEvent(change.field ?? "", change.value);
      }
    }
  } catch {
    // Ignore malformed payloads — never make Meta retry-storm us.
  }

  return NextResponse.json({ ok: true });
}

// HMAC-SHA256 of the raw body keyed by the app secret, compared to the X-Hub-Signature-256 header
// ("sha256=<hex>"). timingSafeEqual guards against timing attacks. If no app secret is configured
// yet, we can't verify — reject rather than trust an unsigned request.
function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Minimal shape of the fields we read (Meta sends much more). The value's real shape depends on
// change.field and is parsed inside cloud-ingest.
type WebhookBody = {
  entry?: Array<{
    changes?: Array<{ field?: string; value: unknown }>;
  }>;
};
