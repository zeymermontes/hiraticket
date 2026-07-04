import "server-only";

// Facturapi (CFDI 4.0) adapter — https://docs.facturapi.io
// Auth: Bearer sk_test_… / sk_live_…  ·  Create: POST /v2/invoices  ·  PDF: GET /v2/invoices/:id/pdf
// Prices are sent tax-INCLUDED (Facturapi's default) with an explicit IVA rate, so the CFDI total
// matches the order total exactly.

const BASE = "https://www.facturapi.io/v2";

export interface FiscalData {
  legal_name: string;
  rfc: string;
  tax_system: string; // régimen (601, 612, 626…)
  zip: string;
  email?: string;
  cfdi_use: string; // uso CFDI (G03…)
}
export interface InvoiceItem { description: string; quantity: number; priceWithTax: number }
export interface IssuedInvoice { id: string; uuid: string; total: number; verificationUrl: string | null }

export async function facturapiCreateInvoice(
  apiKey: string, fiscal: FiscalData, items: InvoiceItem[], opts: { paymentForm: string; productKey: string; taxRate: number },
): Promise<{ ok: boolean; invoice?: IssuedInvoice; error?: string }> {
  try {
    const res = await fetch(`${BASE}/invoices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          legal_name: fiscal.legal_name.trim().toUpperCase(),
          tax_id: fiscal.rfc.trim().toUpperCase(),
          tax_system: fiscal.tax_system,
          address: { zip: fiscal.zip.trim() },
          ...(fiscal.email?.trim() ? { email: fiscal.email.trim() } : {}),
        },
        items: items.map((it) => ({
          quantity: it.quantity,
          product: {
            description: it.description,
            product_key: opts.productKey,
            price: it.priceWithTax, // tax_included defaults to true
            taxes: [{ type: "IVA", rate: opts.taxRate }],
          },
        })),
        use: fiscal.cfdi_use,
        payment_form: opts.paymentForm,
        payment_method: "PUE",
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; uuid?: string; total?: number; verification_url?: string; message?: string };
    if (!res.ok || !j.id) return { ok: false, error: j.message || `facturapi-${res.status}` };
    return { ok: true, invoice: { id: j.id, uuid: j.uuid ?? "", total: Number(j.total ?? 0), verificationUrl: j.verification_url ?? null } };
  } catch { return { ok: false, error: "network" }; }
}

/** Download the stamped PDF (returns raw bytes for re-hosting in our storage). */
export async function facturapiFetchPdf(apiKey: string, invoiceId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${BASE}/invoices/${invoiceId}/pdf`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

/** Ask Facturapi to email the invoice (PDF + XML) to the customer. */
export async function facturapiSendEmail(apiKey: string, invoiceId: string, email?: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/invoices/${invoiceId}/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(email?.trim() ? { email: email.trim() } : {}),
    });
    return res.ok;
  } catch { return false; }
}
