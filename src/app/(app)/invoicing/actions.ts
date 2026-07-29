"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { facturapiCreateInvoice, facturapiFetchPdf, facturapiSendEmail, type FiscalData } from "@/lib/invoicing";
import { encryptBody } from "@/lib/msgcrypto";

/** The contact's saved tax profile (recurring customers), or null. */
export async function getFiscalProfile(contactId: string): Promise<FiscalData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contact_fiscal")
    .select("legal_name, rfc, tax_system, zip, email, cfdi_use").eq("contact_id", contactId).maybeSingle();
  if (error || !data) return null;
  return {
    legal_name: data.legal_name as string, rfc: data.rfc as string, tax_system: data.tax_system as string,
    zip: data.zip as string, email: (data.email as string) ?? "", cfdi_use: (data.cfdi_use as string) || "G03",
  };
}

/** Issue a CFDI for the order via the business's Facturapi plugin. Optionally saves the fiscal
 *  profile on the contact and emails the invoice (PDF+XML) to the customer. */
export async function issueInvoice(
  orderId: string, fiscal: FiscalData, paymentForm: string, saveProfile: boolean, sendEmail: boolean,
): Promise<{ ok: boolean; invoiceId?: string; uuid?: string; pdfUrl?: string | null; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: order } = await supabase.from("orders").select("business_id, code, contact_id, requires_invoice, tax_rate").eq("id", orderId).maybeSingle();
  if (!order) return { ok: false, error: "order" };
  const businessId = order.business_id as string;

  const cfg = await getPluginRuntimeConfig(businessId, "facturapi");
  const apiKey = cfg?.api_key?.trim();
  if (!apiKey) return { ok: false, error: "not-configured" };
  const productKey = cfg?.product_key?.trim() || "01010101";

  // Line items priced tax-INCLUDED so the CFDI total matches the order total. The order's frozen
  // rate wins; orders created without "Requiere factura" fall back to the business's current rate.
  let rate = Number(order.tax_rate ?? 0);
  if (!(rate > 0)) {
    const { data: biz } = await supabase.from("businesses").select("invoice_tax_rate").eq("id", businessId).maybeSingle();
    rate = Number((biz as { invoice_tax_rate?: number } | null)?.invoice_tax_rate ?? 16);
  }
  const { data: items } = await supabase.from("order_items").select("name, qty, unit_price").eq("order_id", orderId);
  const lines = (items ?? []).map((it) => ({
    description: (it.name as string) || "Artículo",
    quantity: Number(it.qty) || 1,
    priceWithTax: Math.round((Number(it.unit_price) || 0) * (1 + rate / 100) * 100) / 100,
  })).filter((l) => l.priceWithTax > 0);
  if (!lines.length) return { ok: false, error: "no-items" };

  if (saveProfile && order.contact_id) {
    const row = { business_id: businessId, contact_id: order.contact_id, legal_name: fiscal.legal_name, rfc: fiscal.rfc.toUpperCase(), tax_system: fiscal.tax_system, zip: fiscal.zip, email: fiscal.email || null, cfdi_use: fiscal.cfdi_use, updated_at: new Date().toISOString() };
    await supabase.from("contact_fiscal").upsert(row, { onConflict: "contact_id" });
  }

  const r = await facturapiCreateInvoice(apiKey, fiscal, lines, { paymentForm, productKey, taxRate: rate / 100 });
  if (!r.ok || !r.invoice) return { ok: false, error: r.error ?? "create" };

  // Re-host the stamped PDF in our storage so agents/customers get a stable link.
  let pdfUrl: string | null = null;
  const pdf = await facturapiFetchPdf(apiKey, r.invoice.id);
  if (pdf) {
    const admin = createAdminClient();
    const path = `invoices/${businessId}/${orderId}/${r.invoice.uuid || r.invoice.id}.pdf`;
    const up = await admin.storage.from("media").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (!up.error) pdfUrl = admin.storage.from("media").getPublicUrl(path).data.publicUrl;
  }

  const { data: invRow } = await supabase.from("invoices").insert({
    business_id: businessId, order_id: orderId, provider: "facturapi",
    external_id: r.invoice.id, uuid: r.invoice.uuid || null, total: r.invoice.total || null,
    verification_url: r.invoice.verificationUrl, pdf_url: pdfUrl, created_by: user?.id ?? null,
  }).select("id").single();

  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: "file", text: `Factura emitida · ${r.invoice.uuid || r.invoice.id}`,
  });
  await supabase.from("plugin_usage").insert({ business_id: businessId, plugin_id: "facturapi", unit: "factura", qty: 1, meta: { uuid: r.invoice.uuid, total: r.invoice.total } });

  if (sendEmail && fiscal.email?.trim()) await facturapiSendEmail(apiKey, r.invoice.id, fiscal.email);

  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, invoiceId: (invRow?.id as string) ?? undefined, uuid: r.invoice.uuid, pdfUrl };
}

/** WhatsApp the invoice (folio + PDF link) to the order's conversation. */
export async function notifyInvoice(orderId: string, invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const [{ data: order }, { data: inv }] = await Promise.all([
    supabase.from("orders").select("business_id, code, conversation_id, contact_id").eq("id", orderId).maybeSingle(),
    supabase.from("invoices").select("uuid, pdf_url").eq("id", invoiceId).maybeSingle(),
  ]);
  if (!order?.conversation_id) return { ok: false, error: "no-conversation" };
  if (!inv) return { ok: false, error: "no-invoice" };
  const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const businessId = order.business_id as string;
  const body = `¡Hola ${first}! 🧾 Aquí está tu factura del pedido ${order.code}.${inv.uuid ? ` Folio fiscal: ${inv.uuid}.` : ""}${inv.pdf_url ? ` Descárgala aquí: ${inv.pdf_url}` : ""}`;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: order.conversation_id,
    direction: "out", type: "text", body: encryptBody(businessId, body), author_id: user?.id ?? null, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  revalidatePath("/chat");
  return { ok: true };
}
