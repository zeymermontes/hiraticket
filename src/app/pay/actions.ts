"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const { data: order } = await admin.from("orders").select("id, business_id").eq("pay_token", token).maybeSingle();
  if (!order) return { ok: false, error: "not-found" };

  const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `proofs/${order.business_id}/${order.id}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
  if (upErr) return { ok: false, error: "upload-failed" };
  const image_url = admin.storage.from("media").getPublicUrl(path).data.publicUrl;

  const amount = amountRaw ? Number(amountRaw.replace(/[^0-9.]/g, "")) : null;
  const { error: insErr } = await admin.from("payment_proofs").insert({
    business_id: order.business_id, order_id: order.id, method: "transfer",
    account_ref: accountRef, image_url, image_mime: file.type || null,
    amount: amount && amount > 0 ? amount : null, payer_note: note, status: "pending",
  });
  if (insErr) return { ok: false, error: "insert-failed" };

  await admin.from("events").insert({
    business_id: order.business_id, parent_type: "order", parent_id: order.id,
    actor_id: null, kind: "clock", text: "Comprobante de pago recibido — en revisión",
  });
  revalidatePath("/orders"); revalidatePath("/kanban");
  return { ok: true };
}
