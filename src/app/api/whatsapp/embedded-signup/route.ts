import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Finishes the Meta Embedded Signup (coexistence) flow started in the browser. The client sends the
// short-lived auth `code` plus the WABA / phone ids; we exchange the code for a business token.
//
// NOTE: this endpoint lives under /api/whatsapp, which middleware treats as public (for the Meta
// webhook), so we enforce the session HERE — only a logged-in user may onboard a number.
//
// TODO(coexistence): after the exchange, subscribe the WABA to our app, register/enable the number
// for coexistence, and persist a whatsapp_sessions row (new 'official' connect method). For now we
// verify the round-trip works and return the ids so the flow is testable end-to-end.
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

  // Round-trip verified. Persistence + WABA subscription is the next milestone.
  console.log("[embedded-signup] onboarded", { user: user.id, wabaId, phoneNumberId, hasToken: Boolean(token) });
  return NextResponse.json({ ok: true, waba_id: wabaId, phone_number_id: phoneNumberId });
}
