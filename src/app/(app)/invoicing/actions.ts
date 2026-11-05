"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getPluginRuntimeConfig, pickInvoicing, type InvoicingProvider } from "@/lib/plugins";
import { facturapiCreateInvoice, facturapiFetchPdf, facturapiSendEmail, type FiscalData, type InvoiceItem } from "@/lib/invoicing";
import { encryptBody } from "@/lib/msgcrypto";
import { flushCloudOutbox } from "@/lib/cloud-outbox";
import { signMediaUrl } from "@/lib/mediaSign";
import { PLUGIN_ID as FX, FACTURACION_SITE, createCfdi, createLink, closeLink, upsertClient } from "@/lib/facturacion";
import {
  loadFxConfig, planOrderInvoice, toConcepts, hostInvoicePdf, recordIssuedInvoice, sendInvoiceToChat,
  syncLinkRow, closeLinkRow, type FxConfig,
} from "@/lib/facturacionOps";
import type { InvoicePlan } from "@/lib/invoiceLines";

type SB = Awaited<ReturnType<typeof createClient>>;

const RFC_GENERIC = "XAXX010101000";
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** El plugin de CFDI activo del negocio (con los dos instalados manda Hiraticket Facturación). */
async function activeProvider(supabase: SB, businessId: string): Promise<InvoicingProvider | null> {
  const { data } = await supabase.from("business_plugins").select("plugin_id")
    .eq("business_id", businessId).eq("status", "active").in("plugin_id", ["facturapi", FX]);
  return pickInvoicing(new Set((data ?? []).map((r) => r.plugin_id as string)));
}

/** Filas de factura del pedido. Las columnas del link son de 0096: sin ellas se lee lo de siempre. */
async function orderInvoices(supabase: SB, orderId: string) {
  type Row = { id: string; provider: string; status: string; total: number | null; link_code: string | null; link_url: string | null; link_expires: string | null; external_id: string | null };
  const full = await supabase.from("invoices").select("id, provider, status, total, link_code, link_url, link_expires, external_id").eq("order_id", orderId).order("created_at", { ascending: false });
  if (!full.error) return (full.data ?? []) as Row[];
  const base = await supabase.from("invoices").select("id, provider, status, total, external_id").eq("order_id", orderId).order("created_at", { ascending: false });
  return ((base.data ?? []) as Partial<Row>[]).map((r) => ({ link_code: null, link_url: null, link_expires: null, ...r })) as Row[];
}

const planError = (plan: InvoicePlan) => (plan.error === "non-positive" ? "non-positive" : "no-items");

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

export interface InvoicePreview {
  ok: boolean; error?: string;
  provider: InvoicingProvider | null;
  /** Total que tendrá la factura y total del pedido. Difieren cuando el IVA se suma al facturar. */
  total: number; orderTotal: number; addsTax: boolean; rate: number;
}

/** Cuánto se va a facturar, antes de timbrar: lo enseña el modal y lo usa el botón del link. */
export async function previewInvoice(orderId: string): Promise<InvoicePreview> {
  const supabase = await createClient();
  const empty: InvoicePreview = { ok: false, provider: null, total: 0, orderTotal: 0, addsTax: false, rate: 0 };
  const ctx = await planOrderInvoice(supabase, orderId);
  if (!ctx) return { ...empty, error: "order" };
  const provider = await activeProvider(supabase, ctx.order.business_id);
  const { plan } = ctx;
  const base = { provider, total: plan.total, orderTotal: plan.orderTotal, addsTax: plan.addsTax, rate: plan.rate };
  if (!plan.ok) return { ...base, ok: false, error: planError(plan) };
  return { ...base, ok: true };
}

type InvRow = Awaited<ReturnType<typeof orderInvoices>>[number];
const linkRef = (r: InvRow, businessId: string, orderId: string) => ({ id: r.id, business_id: businessId, order_id: orderId, link_code: r.link_code as string });
/** Links del pedido que Facturación todavía considera vivos. Incluye los que aquí ya se ven
 *  vencidos: allá un link vencido sin factura también entra a la factura global. */
const liveLinks = (rows: InvRow[]) => rows.filter((r) => r.provider === FX && r.status === "link_enviado" && !!r.link_code);

/** Crea el link en Facturación y su fila. Desglosado por concepto, o un solo concepto por el
 *  total exacto cuando el plan lo pide (`plan.single`). */
async function newLinkRow(
  supabase: SB, cfg: FxConfig, order: { id: string; business_id: string; code: string }, plan: InvoicePlan, userId: string | null,
): Promise<{ row?: InvRow; error?: string }> {
  const vence = new Date(Date.now() + cfg.linkDays * 864e5).toISOString().slice(0, 10);
  const r = await createLink(cfg.apiKey, {
    emisor: cfg.emisor, referencia: order.code, vence, ...(cfg.marca ? { marca: cfg.marca } : {}),
    ...(plan.single
      ? { total: plan.single.total, descripcion: plan.single.description }
      : { conceptos: toConcepts(plan.lines), descripcion: `Pedido ${order.code}` }),
  });
  if (!r.ok || !r.data) return { error: r.status === 0 ? undefined : r.error };
  const { data: ins, error } = await supabase.from("invoices").insert({
    business_id: order.business_id, order_id: order.id, provider: FX, status: "link_enviado",
    link_code: r.data.codigo, link_url: r.data.url, link_expires: r.data.vence, total: r.data.total, created_by: userId,
  }).select("id").single();
  if (error || !ins) {
    // Sin fila no habría forma de verlo ni de cerrarlo desde aquí: no se deja un link huérfano.
    await closeLink(cfg.apiKey, r.data.codigo);
    return { error: error?.message ?? "insert" };
  }
  return { row: { id: ins.id as string, provider: FX, status: "link_enviado", total: r.data.total, link_code: r.data.codigo, link_url: r.data.url, link_expires: r.data.vence, external_id: null } };
}

export interface IssueResult {
  ok: boolean; error?: string;
  /** `confirm-tax`: la factura sale por más que el pedido (se suma IVA); se vuelve a llamar con `confirmTax`.
   *  `sin-folios`: la cuenta de Facturación no tiene folios. `retry`: no se supo si timbró; reintentar no duplica.
   *  `link-changed`: el link del pedido cambió de estado del otro lado; ya se puso al día, basta reintentar. */
  code?: string;
  invoiceId?: string; uuid?: string; pdfUrl?: string | null; publicUrl?: string | null;
  total?: number; orderTotal?: number; simulated?: boolean;
  /** Con `sin-folios`: dónde se compran. Cada negocio compra sus folios en su cuenta de Facturación. */
  foliosUrl?: string;
}

/** Issue a CFDI for the order via the business's active invoicing plugin. Optionally saves the
 *  fiscal profile on the contact and emails the invoice (PDF+XML) to the customer. */
export async function issueInvoice(
  orderId: string, fiscal: FiscalData, paymentForm: string, saveProfile: boolean, sendEmail: boolean, confirmTax = false, retried = false,
): Promise<IssueResult> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const ctx = await planOrderInvoice(supabase, orderId);
  if (!ctx) return { ok: false, error: "order" };
  const { order, plan } = ctx;
  const businessId = order.business_id;
  const provider = await activeProvider(supabase, businessId);
  if (!provider) return { ok: false, error: "not-configured" };
  if (!plan.ok) return { ok: false, error: planError(plan) };
  if (plan.addsTax && !confirmTax) return { ok: false, code: "confirm-tax", total: plan.total, orderTotal: plan.orderTotal };

  const rows = await orderInvoices(supabase, orderId);
  // Un pedido ya facturado no se vuelve a facturar: la UI esconde el botón, pero dos pestañas
  // abiertas (o dos asesores) pueden llegar aquí a la vez.
  if (rows.some((r) => r.status === "issued")) return { ok: false, error: "already-issued" };

  if (saveProfile && order.contact_id) {
    const row = { business_id: businessId, contact_id: order.contact_id, legal_name: fiscal.legal_name, rfc: fiscal.rfc.toUpperCase(), tax_system: fiscal.tax_system, zip: fiscal.zip, email: fiscal.email || null, cfdi_use: fiscal.cfdi_use, updated_at: new Date().toISOString() };
    await supabase.from("contact_fiscal").upsert(row, { onConflict: "contact_id" });
  }

  /* ---------- Hiraticket Facturación ---------- */
  if (provider === FX) {
    const cfg = await loadFxConfig(businessId);
    if (!cfg || !cfg.emisor) return { ok: false, error: "not-configured" };
    const rfc = fiscal.rfc.trim().toUpperCase();
    const correo = sendEmail && fiscal.email?.trim() ? fiscal.email.trim() : undefined;
    const receptor = rfc === RFC_GENERIC
      ? { rfc, ...(correo ? { correo } : {}) }
      : { rfc, nombre: fiscal.legal_name.trim().toUpperCase(), regimen: fiscal.tax_system, cp: fiscal.zip.trim(), uso: fiscal.cfdi_use, ...(correo ? { correo } : {}) };
    // El catálogo de clientes de su cuenta queda al día. Sin `correo` cuando no se pidió enviar: con
    // un correo guardado allá, Facturación mandaría la factura aunque aquí se haya desmarcado.
    if (rfc !== RFC_GENERIC) await upsertClient(cfg.apiKey, { rfc, nombre: fiscal.legal_name.trim().toUpperCase(), regimen: fiscal.tax_system, cp: fiscal.zip.trim(), uso: fiscal.cfdi_use, ...(correo ? { correo } : {}) });

    // Si el pedido tiene un link vivo, la factura se timbra LIGADA a él (`link`): Facturación lo
    // deja `facturado` con este CFDI, así el cliente ya no puede usarlo y la venta no entra a la
    // factura global. La fila del link pasa a ser la de la factura: una venta, una fila.
    // Con más de uno vivo (no debería pasar), se liga el más reciente y los demás se cierran.
    const live = liveLinks(rows);
    let target: InvRow | null = live[0] ?? null;
    for (const extra of live.slice(1)) await closeLinkRow(supabase, cfg, linkRef(extra, businessId, orderId), user?.id ?? null);

    // Un solo concepto por el total exacto: solo se puede timbrar a través de un link creado así.
    // Si el que hay es por otro monto (se hizo desglosado, o el pedido cambió), se cierra y se crea.
    let ownLink = false; // el link se creó aquí solo para timbrar; el cliente nunca lo recibió
    if (plan.single) {
      if (target && Math.abs((Number(target.total) || 0) - plan.single.total) >= 0.005) {
        const closed = await closeLinkRow(supabase, cfg, linkRef(target, businessId, orderId), user?.id ?? null);
        if (closed.status === "issued") return { ok: false, error: "already-issued" };
        if (closed.status === null) return { ok: false, error: closed.error, code: "retry" };
        target = null;
      }
      if (!target) {
        const made = await newLinkRow(supabase, cfg, order, plan, user?.id ?? null);
        if (!made.row) return { ok: false, error: made.error };
        target = made.row; ownLink = true;
      }
    }

    // La fila existe ANTES de timbrar y su id es la llave de idempotencia. Si la respuesta se
    // pierde (red, 5xx), el siguiente intento manda la misma llave: Facturación devuelve la misma
    // factura en vez de timbrar otra y cobrar otro folio. Sin link, esa fila es una `pending`.
    let row: InvRow | null = target ?? rows.find((r) => r.provider === FX && r.status === "pending") ?? null;
    if (!row) {
      const { data: ins, error } = await supabase.from("invoices").insert({
        business_id: businessId, order_id: orderId, provider: FX, status: "pending", total: plan.total, created_by: user?.id ?? null,
      }).select("id").single();
      if (error || !ins) return { ok: false, error: error?.message ?? "insert" };
      row = { id: ins.id as string, provider: FX, status: "pending", total: plan.total, link_code: null, link_url: null, link_expires: null, external_id: null };
    }
    const r = await createCfdi(cfg.apiKey, `hiraticket:${row.id}`, target
      // Con link: emisor y marca salen del link. Los conceptos también cuando es de un solo
      // concepto exacto; si no, van los del pedido de hoy (el link pudo quedarse viejo).
      ? { receptor, forma_pago: paymentForm, link: target.link_code as string, ...(plan.single ? {} : { conceptos: toConcepts(plan.lines) }) }
      : { emisor: cfg.emisor, receptor, conceptos: toConcepts(plan.lines), forma_pago: paymentForm, ...(cfg.marca ? { marca: cfg.marca } : {}) });
    if (!r.ok || !r.data) {
      const unknown = r.status === 0 || r.status >= 500;
      // El link ya no está como creíamos (el cliente se facturó con él hace un momento, o se cerró
      // o entró a la global): se lee su estado real y se refleja. Si ya hay factura, es esa.
      if (target && (r.status === 409 || r.status === 404)) {
        const now = await syncLinkRow(supabase, cfg, linkRef(target, businessId, orderId), user?.id ?? null);
        revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
        if (now.status === "issued") return { ok: false, error: "already-issued" };
        // El link quedó cerrado, vencido o en la global: ya no estorba, así que se timbra sin él en
        // este mismo intento. Solo una vez: si el estado no se pudo leer o sigue apareciendo vivo,
        // se le dice al asesor en vez de dar vueltas.
        if (!retried && now.status && now.status !== "link_enviado") return issueInvoice(orderId, fiscal, paymentForm, false, sendEmail, confirmTax, true);
        return { ok: false, code: "link-changed", error: r.error };
      }
      // 4xx: Facturación rechazó la petición y no timbró nada. La fila `pending` sobra, y el link
      // que se creó solo para esto también. Sin respuesta o 5xx no se sabe: todo se queda como
      // está para reintentar con la misma llave.
      if (!unknown) {
        if (ownLink && target) { await closeLink(cfg.apiKey, target.link_code as string); await supabase.from("invoices").delete().eq("id", target.id).eq("status", "link_enviado"); }
        else if (!target) await supabase.from("invoices").delete().eq("id", row.id).eq("status", "pending");
      }
      return {
        ok: false, error: r.status === 0 ? undefined : r.error, code: r.status === 402 ? "sin-folios" : unknown ? "retry" : undefined,
        ...(r.status === 402 ? { foliosUrl: `${FACTURACION_SITE}/dashboard/folios` } : {}),
      };
    }
    const cfdi = r.data;
    await recordIssuedInvoice(supabase, cfg, { id: row.id, business_id: businessId, order_id: orderId }, cfdi, { actorId: user?.id ?? null, eventText: "Factura emitida" });
    const { data: saved } = await supabase.from("invoices").select("pdf_url").eq("id", row.id).maybeSingle();
    revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
    return {
      ok: true, invoiceId: row.id, uuid: cfdi.uuid ?? undefined, pdfUrl: await signMediaUrl((saved?.pdf_url as string) ?? null, 3600),
      publicUrl: cfdi.liga_publica, total: cfdi.total, simulated: cfdi.simulado,
    };
  }

  /* ---------- Facturapi ---------- */
  const cfg = await getPluginRuntimeConfig(businessId, "facturapi");
  const apiKey = cfg?.api_key?.trim();
  if (!apiKey) return { ok: false, error: "not-configured" };
  const productKey = cfg?.product_key?.trim() || "01010101";
  // Facturapi recibe precios CON impuestos. Los conceptos salen de la misma regla que el otro
  // proveedor (sin IVA + descuento por renglón) y aquí se llevan a precio unitario con IVA, con el
  // descuento ya restado. Sin descuento se redondea a centavos, como siempre se ha mandado.
  const lines: InvoiceItem[] = plan.lines.map((l) => {
    const gross = ((l.qty * l.price - l.discount) * (1 + l.iva)) / l.qty;
    return {
      description: l.description, quantity: l.qty, taxRate: l.iva,
      priceWithTax: l.discount > 0 ? Math.round(gross * 1e6) / 1e6 : r2(gross),
      ...(l.satCode ? { productKey: l.satCode } : {}), ...(l.satUnit ? { unitKey: l.satUnit } : {}),
    };
  }).filter((l) => l.priceWithTax > 0);
  if (!lines.length) return { ok: false, error: "no-items" };

  const r = await facturapiCreateInvoice(apiKey, fiscal, lines, { paymentForm, productKey, taxRate: plan.rate / 100 });
  if (!r.ok || !r.invoice) return { ok: false, error: r.error ?? "create" };

  // Re-host the stamped PDF in our storage so agents/customers get a stable link.
  // En la base va la RUTA (bucket privado); a quien la emitió se le devuelve firmada.
  const pdfUrl = await hostInvoicePdf(businessId, orderId, r.invoice.uuid || r.invoice.id, await facturapiFetchPdf(apiKey, r.invoice.id));

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
  return { ok: true, invoiceId: (invRow?.id as string) ?? undefined, uuid: r.invoice.uuid, pdfUrl: await signMediaUrl(pdfUrl, 3600), total: r.invoice.total };
}

/** WhatsApp the invoice (folio + PDF) to the order's conversation. */
export async function notifyInvoice(orderId: string, invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const r = await sendInvoiceToChat(supabase, orderId, invoiceId, user?.id ?? null);
  if (r.ok) revalidatePath("/chat");
  return r;
}

export interface LinkResult {
  ok: boolean; error?: string;
  /** `confirm-tax`: igual que al emitir. `already-issued`: el pedido ya tiene factura. */
  code?: string;
  url?: string; sent?: boolean; reused?: boolean; expires?: string;
  total?: number; orderTotal?: number;
}

/**
 * Manda al cliente un link para que se facture solo (Hiraticket Facturación). El cliente captura
 * su RFC y recibe su factura; cuando lo hace, el webhook `link.facturado` deja la factura en el
 * pedido.
 *
 * Un link abierto por el mismo monto se reutiliza: volver a pulsar el botón reenvía la misma liga
 * en vez de dejar dos abiertas. Si el monto del pedido cambió, el anterior se CIERRA en
 * Facturación y se crea otro: un link abierto de más no solo permitiría facturar dos veces, esa
 * venta entraría además a la factura global del negocio.
 */
export async function sendInvoiceLink(orderId: string, opts: { confirmTax?: boolean; send?: boolean } = {}): Promise<LinkResult> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const ctx = await planOrderInvoice(supabase, orderId);
  if (!ctx) return { ok: false, error: "order" };
  const { order, plan } = ctx;
  const businessId = order.business_id;
  const cfg = await loadFxConfig(businessId);
  if (!cfg || !cfg.emisor) return { ok: false, error: "not-configured" };
  if (!plan.ok) return { ok: false, error: planError(plan) };

  const rows = await orderInvoices(supabase, orderId);
  if (rows.some((r) => r.status === "issued")) return { ok: false, code: "already-issued" };
  if (plan.addsTax && !opts.confirmTax) return { ok: false, code: "confirm-tax", total: plan.total, orderTotal: plan.orderTotal };

  const live = liveLinks(rows);
  let link = live.find((r) => !!r.link_url && (!r.link_expires || r.link_expires >= today()) && Math.abs((Number(r.total) || 0) - plan.total) < 0.005) ?? null;
  const reused = !!link;
  // Los demás (otro monto, o ya vencidos aquí) se cierran antes de crear el nuevo. Si al cerrarlo
  // resulta que el cliente ya se había facturado con él, esa es la factura del pedido.
  for (const old of live.filter((r) => r !== link)) {
    const closed = await closeLinkRow(supabase, cfg, linkRef(old, businessId, orderId), user?.id ?? null);
    if (closed.status === "issued") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); return { ok: false, code: "already-issued" }; }
    if (closed.status === null) return { ok: false, error: closed.error };
  }
  if (!link) {
    const made = await newLinkRow(supabase, cfg, order, plan, user?.id ?? null);
    if (!made.row) return { ok: false, error: made.error };
    link = made.row;
  }

  let sent = false;
  if (opts.send !== false && order.conversation_id) {
    const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
    const first = ((contact?.name as string) ?? "").split(" ")[0];
    const money = "$" + Number(link.total ?? plan.total).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const until = link.link_expires ? ` (vence el ${new Date(`${link.link_expires}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long" })})` : "";
    const body = `Hola${first ? ` ${first}` : ""} 👋 si necesitas factura del pedido ${order.code} por ${money} MXN, captura tus datos aquí: ${link.link_url} 🧾${until}.`;
    await supabase.from("messages").insert({
      business_id: businessId, conversation_id: order.conversation_id,
      direction: "out", type: "text", body: encryptBody(businessId, body), author_id: user?.id ?? null, state: "queued",
    });
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
    await flushCloudOutbox(businessId);
    sent = true;
  }
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: "file", text: `Link de facturación ${sent ? (reused ? "reenviado" : "enviado") : "creado"} · ${link.link_code}`,
  });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, url: link.link_url ?? undefined, sent, reused, expires: link.link_expires ?? undefined, total: Number(link.total ?? plan.total), orderTotal: plan.orderTotal };
}

/** Pregunta a Facturación cómo va un link: si el cliente ya se facturó deja la factura en el
 *  pedido (lo mismo que hace el webhook, por si no llegó); si venció, se cerró o entró a la factura
 *  global del negocio, lo marca. Devuelve el estatus que quedó. */
export async function refreshInvoiceLink(invoiceId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: inv } = await supabase.from("invoices").select("id, business_id, order_id, status, link_code").eq("id", invoiceId).maybeSingle();
  if (!inv?.link_code) return { ok: false, error: "no-link" };
  if (inv.status !== "link_enviado") return { ok: true, status: inv.status as string };
  const cfg = await loadFxConfig(inv.business_id as string);
  if (!cfg) return { ok: false, error: "not-configured" };
  const r = await syncLinkRow(supabase, cfg, { id: inv.id as string, business_id: inv.business_id as string, order_id: inv.order_id as string, link_code: inv.link_code as string }, user?.id ?? null);
  if (r.status === null) return { ok: false, error: r.error };
  if (r.status !== "link_enviado") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); }
  return { ok: true, status: r.status };
}

/** Cierra el link de un pedido cuando la venta no se va a facturar por ahí (no procede, el cliente
 *  no quiso factura): deja de poder usarse y la venta no entra a la factura global. No se puede
 *  reabrir; si después hace falta, se manda uno nuevo. Si el cliente ya se había facturado, en vez
 *  de cerrar se registra esa factura y se devuelve `issued`. */
export async function closeInvoiceLink(invoiceId: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: inv } = await supabase.from("invoices").select("id, business_id, order_id, status, link_code").eq("id", invoiceId).maybeSingle();
  if (!inv?.link_code) return { ok: false, error: "no-link" };
  if (inv.status !== "link_enviado") return { ok: true, status: inv.status as string };
  const cfg = await loadFxConfig(inv.business_id as string);
  if (!cfg) return { ok: false, error: "not-configured" };
  const r = await closeLinkRow(supabase, cfg, { id: inv.id as string, business_id: inv.business_id as string, order_id: inv.order_id as string, link_code: inv.link_code as string }, user?.id ?? null);
  if (r.status === null) return { ok: false, error: r.error };
  if (r.status === "cerrado") {
    await supabase.from("events").insert({
      business_id: inv.business_id, parent_type: "order", parent_id: inv.order_id, actor_id: user?.id ?? null,
      kind: "file", text: `Link de facturación cerrado · ${inv.link_code}`,
    });
  }
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, status: r.status };
}
