"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { resolvePayToken } from "@/lib/payments";
import { chargeKindLabel } from "@/lib/charges";

function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.hiraticket.com").replace(/\/+$/, "");
}

/** Start a card payment via the business's MercadoPago plugin: creates a Checkout Pro preference
 *  for the order's outstanding balance and returns the redirect URL. Authenticated by pay_token. */
export async function startCardPayment(token: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!token) return { ok: false, error: "bad-token" };
  const admin = createAdminClient();
  // El token puede ser el del pedido ("cobra lo que falte") o el de una orden de cobro ("cobra
  // esto", 0089). Los dos llegan por aquí y tienen que cobrar cosas distintas.
  const ref = await resolvePayToken(admin, token);
  if (!ref) return { ok: false, error: "not-found" };
  const { data: order } = await admin.from("orders").select("id, code, total, business_id").eq("id", ref.orderId).maybeSingle();
  if (!order) return { ok: false, error: "not-found" };

  const cfg = await getPluginRuntimeConfig(order.business_id as string, "mercadopago");
  const accessToken = cfg?.access_token?.trim();
  if (!accessToken) return { ok: false, error: "not-configured" };

  const { data: pays } = await admin.from("payments").select("amount").eq("order_id", order.id);
  const paid = (pays ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const owed = Math.round(((Number(order.total) || 0) - paid) * 100) / 100;
  const charge = ref.charge;
  if (charge && (charge.status === "void" || charge.status === "paid")) return { ok: false, error: "nothing-due" };
  // Con un cobro se cobra SU monto, pero nunca más de lo que el pedido debe: si mientras tanto
  // alguien abonó por otro lado, cobrar el monto completo del cobro sería cobrar de más.
  const balance = charge ? Math.min(Math.round((Number(charge.amount) || 0) * 100) / 100, owed) : owed;
  if (balance <= 0) return { ok: false, error: "nothing-due" };

  const backUrl = `${appBaseUrl()}/pay/${token}`;
  try {
    // x-integrator-id: Hiraticket's MercadoPago Partner id — every tenant's processed volume counts
    // toward our Partner revenue share. Optional env (set once we're certified).
    const integratorId = process.env.MP_INTEGRATOR_ID?.trim();
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(integratorId ? { "x-integrator-id": integratorId } : {}) },
      body: JSON.stringify({
        items: [{ title: chargeItemTitle(order.code as string, charge), quantity: 1, unit_price: balance, currency_id: "MXN" }],
        external_reference: token, // the unguessable pay_token — the webhook maps it back to the order
        notification_url: `${appBaseUrl()}/api/plugins/mercadopago/webhook?biz=${order.business_id}`,
        back_urls: { success: `${backUrl}?mp=success`, pending: `${backUrl}?mp=pending`, failure: `${backUrl}?mp=failure` },
        auto_return: "approved",
      }),
    });
    if (!res.ok) return { ok: false, error: "mp-" + res.status };
    const pref = (await res.json()) as { init_point?: string };
    if (!pref.init_point) return { ok: false, error: "mp-no-url" };
    return { ok: true, url: pref.init_point };
  } catch {
    return { ok: false, error: "mp-network" };
  }
}

/** Lo que el cliente ve en el estado de cuenta de su tarjeta. Con un cobro se nombra el concepto:
 *  "Pedido A-102" repetido tres veces en el mismo mes no le dice a nadie cuál era cuál. */
function chargeItemTitle(code: string, charge: Record<string, unknown> | null): string {
  if (!charge) return `Pedido ${code}`;
  const label = ((charge.label as string | null) ?? "").trim() || chargeKindLabel((charge.kind as string) ?? "");
  return `${label} · Pedido ${code}`;
}

/** Customer uploads a transfer receipt from the public checkout page. Unauthenticated → we use the
 *  service-role client and authenticate the request by the order's pay_token. The proof lands as
 *  'pending' for an agent to review. Returns {ok} / {ok:false,error}. */
export async function submitPaymentProof(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const token = String(formData.get("token") || "");
  const file = formData.get("file");
  const amountRaw = String(formData.get("amount") || "").trim();
  const note = String(formData.get("note") || "").trim().slice(0, 500) || null;
  const accountRef = String(formData.get("account_ref") || "").trim().slice(0, 200) || null;
  if (!token) return { ok: false, error: "bad-token" };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "no-file" };
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") return { ok: false, error: "bad-type" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "too-large" };

  const admin = createAdminClient();
  const ref = await resolvePayToken(admin, token);
  if (!ref) return { ok: false, error: "not-found" };
  const order = { id: ref.orderId, business_id: ref.businessId };
  // De qué cobro salió el comprobante. Es el único momento en que se sabe: la página se autentica
  // con el token, y sin guardarlo aquí, al aprobarlo ya no habría forma de atribuir el dinero.
  const chargeId = (ref.charge?.id as string | undefined) ?? null;

  const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `proofs/${order.business_id}/${order.id}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) return { ok: false, error: "upload-failed" };
  const image_url = admin.storage.from("media").getPublicUrl(path).data.publicUrl;

  const amount = amountRaw ? Number(amountRaw.replace(/[^0-9.]/g, "")) : null;
  const proofRow = {
    business_id: order.business_id, order_id: order.id, method: "transfer",
    account_ref: accountRef, image_url, image_mime: file.type || null,
    amount: amount && amount > 0 ? amount : null, payer_note: note, status: "pending",
  };
  // Sin 0089 la columna no existe: se guarda el comprobante igual, solo que sin cobro asociado.
  // Perder la atribución es malo; perder el comprobante de un cliente que ya pagó es peor.
  let { error: insErr } = await admin.from("payment_proofs").insert({ ...proofRow, charge_id: chargeId });
  if (insErr) ({ error: insErr } = await admin.from("payment_proofs").insert(proofRow));
  if (insErr) return { ok: false, error: "insert-failed" };

  await admin.from("events").insert({
    business_id: order.business_id, parent_type: "order", parent_id: order.id,
    actor_id: null, kind: "clock", text: "Comprobante de pago recibido — en revisión",
  });
  revalidatePath("/orders"); revalidatePath("/kanban");
  return { ok: true };
}
