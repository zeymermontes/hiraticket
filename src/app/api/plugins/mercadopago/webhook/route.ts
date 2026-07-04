import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";

export const dynamic = "force-dynamic";

// MercadoPago payment webhook (per-business; ?biz=<businessId> is set on the preference).
// SECURITY: we never trust the notification payload. We take only the payment id from it and
// VERIFY by fetching the payment from MercadoPago's API with the business's own access token —
// a forged request can't produce an approved payment there. Always answers 200 fast (MP retries
// non-2xx aggressively); unprocessable notifications are just ignored.
export async function POST(req: NextRequest) {
  try {
    const biz = req.nextUrl.searchParams.get("biz");
    // Payment id arrives either as JSON {type:"payment", data:{id}} or legacy ?topic=payment&id=…
    let paymentId = "";
    let kind = req.nextUrl.searchParams.get("topic") || req.nextUrl.searchParams.get("type") || "";
    try {
      const body = (await req.json()) as { type?: string; action?: string; data?: { id?: string | number } };
      if (body?.type) kind = body.type;
      if (body?.data?.id != null) paymentId = String(body.data.id);
    } catch { /* no JSON body (legacy notification) */ }
    if (!paymentId) paymentId = req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("data.id") || "";
    if (!biz || !paymentId || (kind && kind !== "payment")) return NextResponse.json({ ok: true });

    const cfg = await getPluginRuntimeConfig(biz, "mercadopago");
    const accessToken = cfg?.access_token?.trim();
    if (!accessToken) return NextResponse.json({ ok: true });

    // Verify the payment with MercadoPago.
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return NextResponse.json({ ok: true });
    const pay = (await res.json()) as { status?: string; transaction_amount?: number; external_reference?: string };
    if (pay.status !== "approved" || !pay.external_reference) return NextResponse.json({ ok: true });

    const admin = createAdminClient();
    const { data: order } = await admin.from("orders").select("id, total").eq("pay_token", pay.external_reference).eq("business_id", biz).maybeSingle();
    if (!order) return NextResponse.json({ ok: true });

    // Idempotency: each MP payment is recorded once (webhooks retry / duplicate).
    const ref = `MercadoPago #${paymentId}`;
    const { data: dup } = await admin.from("payments").select("id").eq("order_id", order.id).eq("note", ref).maybeSingle();
    if (dup) return NextResponse.json({ ok: true });

    const amount = Number(pay.transaction_amount) || 0;
    if (amount <= 0) return NextResponse.json({ ok: true });
    await admin.from("payments").insert({ business_id: biz, order_id: order.id, amount, method: "tarjeta", note: ref, created_by: null });

    // Recompute pay_status from the sum of payments (mirrors orders/actions.ts).
    const { data: pays } = await admin.from("payments").select("amount").eq("order_id", order.id);
    const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const total = Number(order.total) || 0;
    const status = total > 0 && paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
    await admin.from("orders").update({ pay_status: status }).eq("id", order.id);

    await admin.from("events").insert({
      business_id: biz, parent_type: "order", parent_id: order.id, actor_id: null,
      kind: "check", text: `Pago con tarjeta acreditado (${ref})`,
    });
    // Usage meter (metered/revshare reporting later).
    await admin.from("plugin_usage").insert({ business_id: biz, plugin_id: "mercadopago", unit: "cobro", qty: amount, meta: { payment_id: paymentId } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never make MP retry-storm us
  }
}

// MercadoPago sometimes probes with GET.
export async function GET() {
  return NextResponse.json({ ok: true });
}
