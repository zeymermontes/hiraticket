import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { encryptSecret } from "@/lib/secrets";
import { subscribeAppToWaba, registerPhone, getPhoneNumberInfo } from "@/lib/whatsapp-cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Finishes the Meta Embedded Signup (coexistence) flow started in the browser. The client sends the
// short-lived auth `code` plus the WABA / phone ids; we exchange the code for a business token,
// subscribe the WABA to our app (webhooks), register the number for Cloud API, and persist the
// session as connect_method='official' — from then on the webhook ingests and cloud-outbox sends.
//
// NOTE: this endpoint lives under /api/whatsapp, which middleware treats as public (for the Meta
// webhook), so we enforce the session HERE — only a logged-in user may onboard a number.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let code = "";
  let wabaId = "";
  let phoneNumberId = "";
  try {
    const body = (await req.json()) as { code?: string; waba_id?: string; phone_number_id?: string };
    code = body.code ?? "";
    wabaId = body.waba_id ?? "";
    phoneNumberId = body.phone_number_id ?? "";
  } catch {
    /* fallthrough to the missing-code guard */
  }
  if (!code) return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });

  const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 501 });

  // Exchange the code for a business-scoped access token.
  const url =
    `https://graph.facebook.com/v21.0/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(secret)}` +
    `&code=${encodeURIComponent(code)}`;
  let token = "";
  try {
    const res = await fetch(url);
    const data = (await res.json()) as { access_token?: string; error?: unknown };
    if (!res.ok || !data.access_token) {
      return NextResponse.json({ ok: false, error: "exchange_failed", detail: data.error ?? null }, { status: 502 });
    }
    token = data.access_token;
  } catch {
    return NextResponse.json({ ok: false, error: "exchange_error" }, { status: 502 });
  }

  // The ids arrive via the ES iframe's postMessage; without them we can't route webhooks.
  if (!wabaId || !phoneNumberId) {
    return NextResponse.json({ ok: false, error: "missing_ids" }, { status: 400 });
  }

  // Wire the WABA to our app. Without this subscription Meta never delivers webhooks, so a
  // failure here is fatal (the session would look connected but stay silent).
  const warnings: string[] = [];
  const sub = await subscribeAppToWaba(wabaId, token);
  if (!sub.ok) {
    return NextResponse.json({ ok: false, error: "subscribe_failed", detail: sub.error }, { status: 502 });
  }
  // Enable Cloud API messaging on the number. On coexistence numbers this can fail if the owner
  // already has a different two-step PIN — keep going and surface it (inbound still works).
  const reg = await registerPhone(phoneNumberId, token);
  if (!reg.ok) warnings.push(`register: ${reg.error}`);

  const info = await getPhoneNumberInfo(phoneNumberId, token);
  const phone =
    info.ok && info.data.display_phone_number ? "+" + info.data.display_phone_number.replace(/\D/g, "") : null;

  // La organización ACTIVA, no "la primera membresía".
  //
  // Con varias organizaciones esa diferencia decide en cuál queda vinculado el número, y el fallo
  // sería mudo: conectas WhatsApp estando en la organización nueva y la sesión oficial aterriza en
  // la vieja. getMyBusiness resuelve la activa y ya se ocupa de que solo pueda ser una tuya.
  const business = await getMyBusiness();
  if (!business) return NextResponse.json({ ok: false, error: "no_business" }, { status: 400 });
  const businessId = business.id;

  // Upsert the official session (one per business). RLS "members manage wa" covers this client.
  const now = new Date().toISOString();
  const patch = {
    phone,
    status: "connected",
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    cloud_token: encryptSecret(token),
    qr: null,
    pairing_code: null,
    last_seen: now,
    updated_at: now,
  };
  const { data: existing } = await supabase
    .from("whatsapp_sessions")
    .select("id")
    .eq("business_id", businessId)
    .eq("connect_method", "official")
    .maybeSingle();
  const write = existing
    ? await supabase.from("whatsapp_sessions").update(patch).eq("id", existing.id)
    : await supabase
        .from("whatsapp_sessions")
        .insert({ business_id: businessId, label: "WhatsApp oficial", connect_method: "official", ...patch });
  if (write.error) {
    return NextResponse.json({ ok: false, error: "persist_failed", detail: write.error.message }, { status: 500 });
  }

  console.log("[embedded-signup] onboarded", { user: user.id, businessId, wabaId, phoneNumberId, warnings });
  return NextResponse.json({ ok: true, waba_id: wabaId, phone_number_id: phoneNumberId, phone, warnings });
}
