"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getPluginRuntimeConfig, pickInvoicing, type InvoicingProvider } from "@/lib/plugins";
import { facturapiCreateInvoice, facturapiFetchPdf, facturapiSendEmail, type FiscalData, type InvoiceItem } from "@/lib/invoicing";
import { encryptBody } from "@/lib/msgcrypto";
import { flushCloudOutbox } from "@/lib/cloud-outbox";
import { signMediaUrl } from "@/lib/mediaSign";
import { PLUGIN_ID as FX, FACTURACION_SITE, createCfdi, createLink, closeLink, updateLink, updateLinkExpiry, upsertClient, fxUrl, createPayment, fetchCfdiPdf } from "@/lib/facturacion";
import {
  loadFxConfig, planOrderInvoice, toConcepts, hostInvoicePdf, recordIssuedInvoice, sendInvoiceToChat,
  syncLinkRow, closeLinkRow, saveSatToCatalog, saveSatToOrder, saveGroupDefault, saveRetentionDefault, type FxConfig, type GroupChoice, type GroupInfo,
} from "@/lib/facturacionOps";
import { summarize, cleanSat, type InvoicePlan, type InvoiceMode, type InvoiceSummary, type SatOverrides } from "@/lib/invoiceLines";
import { closesOrder, anticipoPlan, finiquitoPlan, anticipoNet, RELACION_ANTICIPO, type InvoiceKind, type KindChoice } from "@/lib/invoiceKinds";
import { withRetention, isRetentionId } from "@/lib/retentions";

type SB = Awaited<ReturnType<typeof createClient>>;

const RFC_GENERIC = "XAXX010101000";
const today = () => new Date().toISOString().slice(0, 10);
/** La fecha de hoy en el centro de México, que es con la que Facturación valida los pagos. */
const todayMx = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
/** Fecha de vencimiento que pide el usuario: YYYY-MM-DD, de hoy a un año. */
const validUntil = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today() && v <= daysFromNow(366);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** El plugin de CFDI activo del negocio (con los dos instalados manda Hiraticket Facturación). */
async function activeProvider(supabase: SB, businessId: string): Promise<InvoicingProvider | null> {
  const { data } = await supabase.from("business_plugins").select("plugin_id")
    .eq("business_id", businessId).eq("status", "active").in("plugin_id", ["facturapi", FX]);
  return pickInvoicing(new Set((data ?? []).map((r) => r.plugin_id as string)));
}

/** Filas de factura del pedido. Las columnas del link son de 0096 y la huella de 0097: sin ellas
 *  se lee lo que haya. `link_sig` queda `undefined` cuando la columna no existe (no se puede
 *  comparar) y `null` cuando el link se creó antes de guardarla. */
async function orderInvoices(supabase: SB, orderId: string) {
  type Row = {
    id: string; provider: string; status: string; total: number | null; uuid: string | null; link_code: string | null; link_url: string | null; link_expires: string | null; external_id: string | null; link_sig?: string | null;
    /** Tipo de factura (0104). `undefined` cuando la columna no existe: todo cuenta como `total`. */
    kind?: string | null; parent_id?: string | null;
  };
  const cols = "id, provider, status, total, uuid, link_code, link_url, link_expires, external_id";
  let full = await supabase.from("invoices").select(`${cols}, link_sig, kind, parent_id`).eq("order_id", orderId).order("created_at", { ascending: false });
  if (full.error) full = await supabase.from("invoices").select(`${cols}, link_sig`).eq("order_id", orderId).order("created_at", { ascending: false }) as never;
  if (full.error) full = await supabase.from("invoices").select(cols).eq("order_id", orderId).order("created_at", { ascending: false }) as never;
  // Un link guardado con una dirección interna de Facturación se reenvía con la pública.
  if (!full.error) return ((full.data ?? []) as unknown as Row[]).map((r) => ({ ...r, link_url: fxUrl(r.link_url) }));
  const base = await supabase.from("invoices").select("id, provider, status, total, uuid, external_id").eq("order_id", orderId).order("created_at", { ascending: false });
  return ((base.data ?? []) as Partial<Row>[]).map((r) => ({ link_code: null, link_url: null, link_expires: null, ...r })) as Row[];
}

type InvRow = Awaited<ReturnType<typeof orderInvoices>>[number];

/** El pedido ya tiene una factura que lo cierra (total, PPD o finiquito). */
const orderClosed = (rows: InvRow[]) => rows.some((r) => r.status === "issued" && closesOrder(r.kind));
/** Anticipos ya facturados (emitidos y no cancelados): lo que el finiquito descuenta y relaciona. */
const anticiposOf = (rows: InvRow[]) => rows.filter((r) => r.status === "issued" && r.kind === "anticipo");

/**
 * El plan de la factura según el tipo elegido. Para un anticipo, un solo concepto por su monto;
 * para el finiquito, los conceptos del pedido menos lo ya facturado en anticipos; para el total
 * (pagado o PPD), el plan del pedido tal cual, y solo si no hay anticipos (con anticipos, lo que
 * cierra el pedido es el finiquito).
 */
function planForKind(base: InvoicePlan, orderCode: string, choice: KindChoice | null | undefined, anticipos: InvRow[]): { kind: InvoiceKind; plan: InvoicePlan; error?: string } {
  const kind = choice?.kind ?? "total";
  if (kind === "pago") return { kind, plan: base, error: "kind" };
  if (kind === "anticipo") return { kind, plan: anticipoPlan(base, choice?.amount ?? 0, orderCode) };
  if (kind === "finiquito") {
    if (!anticipos.length) return { kind, plan: base, error: "no-anticipo" };
    const net = anticipos.reduce((s, r) => s + anticipoNet(Number(r.total) || 0, base.rate / 100), 0);
    const gross = r2(anticipos.reduce((s, r) => s + (Number(r.total) || 0), 0));
    return { kind, plan: finiquitoPlan(base, net, gross) };
  }
  if (anticipos.length) return { kind, plan: base, error: "needs-finiquito" };
  return { kind, plan: base };
}

/** Lo pagado del pedido hasta hoy, para proponer el monto de un anticipo. */
async function orderPaid(supabase: SB, orderId: string): Promise<number> {
  const { data } = await supabase.from("payments").select("amount").eq("order_id", orderId);
  return r2((data ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

const eventTextFor = (kind: InvoiceKind) =>
  kind === "anticipo" ? "Anticipo facturado" : kind === "finiquito" ? "Finiquito facturado" : kind === "ppd" ? "Factura PPD emitida" : "Factura emitida";

/** Huella de lo que diría la factura: conceptos con su clave, unidad, cantidad, precio, descuento
 *  e IVA (o el total, cuando es un solo concepto exacto). Dos planes con la misma huella producen
 *  el mismo link. */
function planSig(plan: InvoicePlan): string {
  const body = plan.single
    ? { total: plan.single.total, d: plan.single.description }
    : toConcepts(plan.lines).map((c) => [c.descripcion, c.cantidad, c.precio, c.iva, c.descuento ?? 0, c.clave ?? "", c.unidad ?? ""]);
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
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
  /** Cómo se leyeron los precios del pedido (con IVA incluido, sin él, o con el IVA del pedido). */
  mode: InvoiceMode;
  /** Se timbra como un solo concepto por el total exacto, con clave genérica (ver `InvoicePlan.single`). */
  exact: boolean;
  /** Los conceptos con sus importes, los totales y a qué renglones les faltan datos del SAT. */
  summary: InvoiceSummary;
  businessId: string | null;
  /** Hasta qué día se podrá facturar con el link si no se elige otro: hoy más los días de
   *  vigencia configurados en el plugin (YYYY-MM-DD). */
  linkUntil: string | null;
  /** Todo en un concepto: lo elegido, lo que hay por defecto y los conceptos del catálogo. */
  group: GroupInfo;
  /** Cuántos renglones del pedido se juntaron en el concepto (0 si no se agrupa). */
  groupedCount: number;
  /** Qué factura es esta vista previa (0104). */
  kind: InvoiceKind;
  /** Anticipos ya facturados del pedido: cuántos y por cuánto (con IVA). El finiquito los descuenta. */
  anticipos: { count: number; total: number };
  /** Lo pagado del pedido hasta hoy: el monto que se propone para un anticipo. */
  paid: number;
  /** El pedido ya tiene una factura que lo cierra. */
  closed: boolean;
  /** Retenciones de esta vista previa (id del preset) y las que el negocio tiene por defecto. */
  retention: { id: string; defaultId: string };
}

/**
 * Qué va a decir la factura, antes de mandar el link o de timbrar: conceptos, subtotal, impuestos
 * y total, y a qué renglones les faltan la clave o la unidad del SAT. `sat` es lo que ya se
 * capturó en la ventana para esos renglones: el resumen se recalcula con ello. `choice` es el tipo
 * de factura (total, PPD, anticipo por un monto, finiquito); sin él, por el total.
 */
export async function previewInvoice(orderId: string, sat?: SatOverrides | null, group?: GroupChoice, choice?: KindChoice | null, retention?: string | null): Promise<InvoicePreview> {
  const supabase = await createClient();
  const none: InvoiceSummary = { lines: [], subtotal: 0, discount: 0, tax: 0, retained: 0, total: 0, missing: [] };
  const noGroup: GroupInfo = { on: false, productId: null, defaultOn: false, defaultProductId: null, options: [] };
  const empty: InvoicePreview = {
    ok: false, provider: null, total: 0, orderTotal: 0, addsTax: false, rate: 0, mode: "tax-included", exact: false, summary: none, businessId: null, linkUntil: null, group: noGroup, groupedCount: 0,
    kind: choice?.kind ?? "total", anticipos: { count: 0, total: 0 }, paid: 0, closed: false, retention: { id: "", defaultId: "" },
  };
  const ctx = await planOrderInvoice(supabase, orderId, sat, group);
  if (!ctx) return { ...empty, error: "order" };
  const [provider, rows, paid] = await Promise.all([activeProvider(supabase, ctx.order.business_id), orderInvoices(supabase, orderId), orderPaid(supabase, orderId)]);
  const anticipos = anticiposOf(rows);
  const { kind, plan: kindPlan, error: kindErr } = planForKind(ctx.plan, ctx.order.code, choice, anticipos);
  const cfg = provider === FX ? await loadFxConfig(ctx.order.business_id) : null;
  // Retenciones: las pedidas, o las que el negocio tiene por defecto. Solo con Facturación.
  const defaultRet = cfg?.retention ?? "";
  const retId = cfg ? (isRetentionId(retention) ? retention : defaultRet) : "";
  const plan = withRetention(kindPlan, retId);
  const base = {
    provider, total: plan.total, orderTotal: plan.orderTotal, addsTax: plan.addsTax, rate: plan.rate, mode: plan.mode, exact: !!plan.single, summary: summarize(plan), businessId: ctx.order.business_id,
    linkUntil: cfg ? daysFromNow(cfg.linkDays) : null, group: ctx.group, groupedCount: plan.grouped?.count ?? 0,
    kind, anticipos: { count: anticipos.length, total: r2(anticipos.reduce((s, r) => s + (Number(r.total) || 0), 0)) }, paid, closed: orderClosed(rows),
    retention: { id: retId, defaultId: defaultRet },
  };
  if (kindErr) return { ...base, ok: false, error: kindErr };
  if (!plan.ok) return { ...base, ok: false, error: planError(plan) };
  return { ...base, ok: true };
}

const linkRef = (r: InvRow, businessId: string, orderId: string) => ({ id: r.id, business_id: businessId, order_id: orderId, link_code: r.link_code as string });
/** Links del pedido que Facturación todavía considera vivos. Incluye los que aquí ya se ven
 *  vencidos: allá un link vencido sin factura también entra a la factura global. */
const liveLinks = (rows: InvRow[]) => rows.filter((r) => r.provider === FX && r.status === "link_enviado" && !!r.link_code);

/** Crea el link en Facturación y su fila. Desglosado por concepto, o un solo concepto por el
 *  total exacto cuando el plan lo pide (`plan.single`). */
async function newLinkRow(
  supabase: SB, cfg: FxConfig, order: { id: string; business_id: string; code: string }, plan: InvoicePlan, userId: string | null, until?: string | null, kind: InvoiceKind = "total",
): Promise<{ row?: InvRow; error?: string; code?: string }> {
  // Hasta cuándo se puede facturar: lo que se eligió para este link, o los días del plugin.
  const vence = validUntil(until) ? until! : daysFromNow(cfg.linkDays);
  const r = await createLink(cfg.apiKey, {
    emisor: cfg.emisor, referencia: order.code, vence, ...(cfg.marca ? { marca: cfg.marca } : {}),
    ...(plan.single
      ? { total: plan.single.total, descripcion: plan.single.description }
      : { conceptos: toConcepts(plan.lines), descripcion: kind === "anticipo" ? `Anticipo del pedido ${order.code}` : `Pedido ${order.code}` }),
    metodo_pago: kind === "ppd" ? "PPD" : "PUE",
  });
  // 401: la llave ya no vale (la revocaron en Facturación). No es un error del pedido.
  if (!r.ok || !r.data) return { error: r.status === 0 ? undefined : r.error, ...(r.status === 401 ? { code: "disconnected" } : {}) };
  // Una Facturación anterior a los links a crédito ignora `metodo_pago`: el link saldría pagado
  // (PUE) y aquí diría PPD. Mejor no dejarlo: se cierra y se avisa.
  if (kind === "ppd" && r.data.metodo_pago !== "PPD") { await closeLink(cfg.apiKey, r.data.codigo); return { error: "ppd-link-unsupported" }; }
  const fields = {
    business_id: order.business_id, order_id: order.id, provider: FX, status: "link_enviado",
    link_code: r.data.codigo, link_url: r.data.url, link_expires: r.data.vence, total: r.data.total, created_by: userId,
  };
  const sig = planSig(plan);
  let { data: ins, error } = await supabase.from("invoices").insert({ ...fields, link_sig: sig, kind }).select("id").single();
  // Sin 0104 no hay tipo de factura: un link por el total se guarda sin él (es lo que siempre fue);
  // uno de anticipo no se puede guardar como lo que no es. Sin 0097 tampoco hay huella.
  if (error && kind !== "total") { await closeLink(cfg.apiKey, r.data.codigo); return { error: "migration-0104" }; }
  if (error) ({ data: ins, error } = await supabase.from("invoices").insert({ ...fields, link_sig: sig }).select("id").single());
  if (error) ({ data: ins, error } = await supabase.from("invoices").insert(fields).select("id").single());
  if (error || !ins) {
    // Sin fila no habría forma de verlo ni de cerrarlo desde aquí: no se deja un link huérfano.
    await closeLink(cfg.apiKey, r.data.codigo);
    return { error: error?.message ?? "insert" };
  }
  return { row: { id: ins.id as string, provider: FX, status: "link_enviado", total: r.data.total, uuid: null, link_code: r.data.codigo, link_url: r.data.url, link_expires: r.data.vence, external_id: null, link_sig: sig, kind } };
}

/** Pone al día el link que ya tiene el pedido, sin cambiarle la liga: lo que dice (conceptos o
 *  total exacto) y, si hace falta, hasta cuándo sirve. Un pedido tiene un solo link: cuando cambia
 *  el pedido, cambia el link, y la liga que ya tiene el cliente sigue sirviendo.
 *  `status`: allá el link ya no está abierto (se leyó su estado real y quedó reflejado aquí).
 *  `code: "unsupported"`: la Facturación de enfrente todavía no sabe cambiar links. */
async function patchLinkRow(
  supabase: SB, cfg: FxConfig, link: InvRow, order: { id: string; business_id: string; code: string }, plan: InvoicePlan, userId: string | null, until?: string | null, kind: InvoiceKind = "total",
): Promise<{ row?: InvRow; status?: string | null; error?: string; code?: string }> {
  const expired = !!link.link_expires && link.link_expires < today();
  // La fecha elegida; si no hay y el link ya venció, se le da el plazo del plugin para que sirva.
  const vence = validUntil(until) ? until! : expired ? daysFromNow(cfg.linkDays) : undefined;
  // Un link de anticipo necesita guardar su tipo (0104); sin la columna no se convierte.
  if (kind !== "total" && link.kind === undefined) return { error: "migration-0104" };
  const r = await updateLink(cfg.apiKey, link.link_code!, {
    ...(vence ? { vence } : {}),
    ...(plan.single
      ? { total: plan.single.total, descripcion: plan.single.description }
      : { conceptos: toConcepts(plan.lines), descripcion: kind === "anticipo" ? `Anticipo del pedido ${order.code}` : `Pedido ${order.code}` }),
    metodo_pago: kind === "ppd" ? "PPD" : "PUE",
  });
  // Una Facturación que no sabe de links a crédito deja el link pagado: se trata como si no
  // supiera cambiarlo (se cierra y se intenta crear otro, que a su vez avisará).
  if (r.ok && r.data && kind === "ppd" && r.data.metodo_pago !== "PPD") return { code: "unsupported" };
  if (!r.ok || !r.data) {
    if (r.status === 401) return { code: "disconnected" };
    if (r.status === 405) return { code: "unsupported" };
    if (r.status === 409 || r.status === 404) {
      const now = await syncLinkRow(supabase, cfg, linkRef(link, order.business_id, order.id), userId);
      return { status: now.status, error: now.error };
    }
    return { error: r.status === 0 ? undefined : r.error };
  }
  const sig = planSig(plan);
  const fields = { total: r.data.total, link_expires: r.data.vence, link_url: r.data.url };
  const { error } = await supabase.from("invoices").update({ ...fields, link_sig: sig, ...(link.kind === undefined ? {} : { kind }) }).eq("id", link.id);
  if (error) await supabase.from("invoices").update(fields).eq("id", link.id); // sin 0097
  return { row: { ...link, ...fields, link_sig: link.link_sig === undefined ? undefined : sig, ...(link.kind === undefined ? {} : { kind }) } };
}

export interface IssueResult {
  ok: boolean; error?: string;
  /** `confirm-tax`: la factura sale por más que el pedido (se suma IVA); se vuelve a llamar con `confirmTax`.
   *  `sin-folios`: la cuenta de Facturación no tiene folios. `retry`: no se supo si timbró; reintentar no duplica.
   *  `link-changed`: el link del pedido cambió de estado del otro lado; ya se puso al día, basta reintentar.
   *  `disconnected`: Facturación ya no acepta la llave (la revocaron): hay que volver a conectar el plugin. */
  code?: string;
  invoiceId?: string; uuid?: string; pdfUrl?: string | null; publicUrl?: string | null;
  total?: number; orderTotal?: number; simulated?: boolean;
  /** Qué factura se emitió (0104). */
  kind?: InvoiceKind;
  /** Con `sin-folios`: dónde se compran. Cada negocio compra sus folios en su cuenta de Facturación. */
  foliosUrl?: string;
}

/** Issue a CFDI for the order via the business's active invoicing plugin. Optionally saves the
 *  fiscal profile on the contact and emails the invoice (PDF+XML) to the customer.
 *
 *  `choice` dice qué factura es (0104): por el total pagada (`total`, lo de siempre), por el total a
 *  crédito o en parcialidades (`ppd`: método PPD, forma 99, y después un complemento por cada pago),
 *  un anticipo o pago parcial por un monto (`anticipo`), o el finiquito (`finiquito`: el pedido menos
 *  los anticipos facturados, relacionados con tipo 07). Solo con Hiraticket Facturación; con
 *  Facturapi únicamente por el total. */
export async function issueInvoice(
  orderId: string, fiscal: FiscalData, paymentForm: string, saveProfile: boolean, sendEmail: boolean, confirmTax = false, retried = false,
  sat: SatOverrides | null = null, group: GroupChoice = undefined, saveGroupAsDefault = false, choice: KindChoice | null = null,
  retention: string | null = null, saveRetentionAsDefault = false,
): Promise<IssueResult> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const ctx = await planOrderInvoice(supabase, orderId, sat, group);
  if (!ctx) return { ok: false, error: "order" };
  const { order } = ctx;
  const businessId = order.business_id;
  const provider = await activeProvider(supabase, businessId);
  if (!provider) return { ok: false, error: "not-configured" };

  const rows = await orderInvoices(supabase, orderId);
  // Un pedido ya facturado (total, PPD o finiquito) no se vuelve a facturar: la UI esconde el
  // botón, pero dos pestañas abiertas (o dos asesores) pueden llegar aquí a la vez.
  if (orderClosed(rows)) return { ok: false, error: "already-issued" };
  const anticipos = anticiposOf(rows);
  const { kind, plan: kindPlan, error: kindErr } = planForKind(ctx.plan, order.code, choice, anticipos);
  if (kindErr) return { ok: false, error: kindErr };
  if (kind !== "total" && provider !== FX) return { ok: false, error: "kind-unsupported" };
  // Retenciones (solo con Facturación): las elegidas en la ventana, o las del negocio por defecto.
  const fxCfg = provider === FX ? await loadFxConfig(businessId) : null;
  const retId = fxCfg ? (isRetentionId(retention) ? retention : fxCfg.retention) : "";
  const plan = withRetention(kindPlan, retId);
  if (!plan.ok) return { ok: false, error: planError(plan) };
  if (plan.addsTax && !confirmTax) return { ok: false, code: "confirm-tax", total: plan.total, orderTotal: plan.orderTotal };
  // La clave y la unidad que se capturaron para esta factura se le quedan al producto del catálogo.
  if (!retried) { await saveSatToCatalog(supabase, ctx.catalog, sat); await saveSatToOrder(supabase, orderId, sat); }
  if (saveGroupAsDefault && group) await saveGroupDefault(supabase, businessId, group);
  if (saveRetentionAsDefault && fxCfg && isRetentionId(retention)) await saveRetentionDefault(supabase, businessId, retention);

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
    //
    // Un anticipo no cierra la venta, así que no se liga a ningún link: los que haya se cierran,
    // porque un link abierto por el total dejaría al cliente facturarse todo el pedido encima del
    // anticipo. Si al cerrar uno resulta que el cliente ya se facturó con él, esa es la factura.
    const live = liveLinks(rows);
    let target: InvRow | null = kind === "anticipo" ? null : live[0] ?? null;
    for (const extra of kind === "anticipo" ? live : live.slice(1)) {
      const closed = await closeLinkRow(supabase, cfg, linkRef(extra, businessId, orderId), user?.id ?? null);
      if (kind === "anticipo" && closed.status === "issued") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); return { ok: false, error: "already-issued" }; }
    }
    // Con un anticipo, un link que allá siga vivo aunque aquí se vea vencido también se cierra:
    // liveLinks ya los incluye. Un link que el cliente recibió para OTRO anticipo se cierra igual.
    // Un finiquito con un link vivo (p. ej. mandado antes del anticipo) se timbra ligado a él,
    // con los conceptos de hoy: así el link queda facturado y no entra a la global.
    const relacionados = kind === "finiquito"
      ? { tipo: RELACION_ANTICIPO, uuids: anticipos.map((a) => a.uuid).filter((u): u is string => !!u) }
      : undefined;
    const metodo = kind === "ppd" ? { metodo_pago: "PPD", forma_pago: "99" } : { metodo_pago: "PUE", forma_pago: paymentForm };

    // Un solo concepto por el total exacto: solo se puede timbrar a través de un link creado así.
    // Si el que hay es por otro monto (se hizo desglosado, o el pedido cambió), se pone al día ese
    // mismo link; solo con una Facturación que no sepa hacerlo se cierra y se crea otro.
    let ownLink = false; // el link se creó aquí solo para timbrar; el cliente nunca lo recibió
    if (plan.single) {
      if (target && Math.abs((Number(target.total) || 0) - plan.single.total) >= 0.005) {
        const p = await patchLinkRow(supabase, cfg, target, order, plan, user?.id ?? null);
        if (p.row) target = p.row;
        else if (p.status === "issued") return { ok: false, error: "already-issued" };
        else if (p.code === "disconnected") return { ok: false, code: "disconnected" };
        else if (p.code === "unsupported") {
          const closed = await closeLinkRow(supabase, cfg, linkRef(target, businessId, orderId), user?.id ?? null);
          if (closed.status === "issued") return { ok: false, error: "already-issued" };
          if (closed.status === null) return { ok: false, error: closed.error, code: "retry" };
          target = null;
        } else if (p.status) target = null; // allá ya estaba cerrado o en la global: se crea otro
        else return { ok: false, error: p.error, code: "retry" };
      }
      if (!target) {
        const made = await newLinkRow(supabase, cfg, order, plan, user?.id ?? null);
        if (!made.row) return { ok: false, error: made.error, code: made.code };
        target = made.row; ownLink = true;
      }
    }

    // La fila existe ANTES de timbrar y su id es la llave de idempotencia. Si la respuesta se
    // pierde (red, 5xx), el siguiente intento manda la misma llave: Facturación devuelve la misma
    // factura en vez de timbrar otra y cobrar otro folio. Sin link, esa fila es una `pending`.
    // Una `pending` que quedó de un intento anterior solo sirve si era de este mismo tipo.
    let row: InvRow | null = target ?? rows.find((r) => r.provider === FX && r.status === "pending" && (r.kind ?? "total") === kind) ?? null;
    if (!row) {
      const fields = { business_id: businessId, order_id: orderId, provider: FX, status: "pending", total: plan.total, created_by: user?.id ?? null };
      let { data: ins, error } = await supabase.from("invoices").insert({ ...fields, kind }).select("id").single();
      // Sin 0104 no hay tipo: por el total se guarda como siempre; lo demás no se puede registrar.
      if (error && kind !== "total") return { ok: false, error: "migration-0104" };
      if (error) ({ data: ins, error } = await supabase.from("invoices").insert(fields).select("id").single());
      if (error || !ins) return { ok: false, error: error?.message ?? "insert" };
      row = { id: ins.id as string, provider: FX, status: "pending", total: plan.total, uuid: null, link_code: null, link_url: null, link_expires: null, external_id: null, kind };
    } else if (target && (target.kind ?? "total") !== kind && target.kind !== undefined) {
      // El link que se liga era de otro tipo (p. ej. un link por el total y hoy se timbra el
      // finiquito): la fila pasa a ser de la factura que de verdad se emite.
      await supabase.from("invoices").update({ kind }).eq("id", target.id);
    }
    const r = await createCfdi(cfg.apiKey, `hiraticket:${row.id}`, target
      // Con link: emisor y marca salen del link. Los conceptos también cuando es de un solo
      // concepto exacto; si no, van los del pedido de hoy (el link pudo quedarse viejo).
      ? { receptor, ...metodo, link: target.link_code as string, ...(plan.single ? {} : { conceptos: toConcepts(plan.lines) }), ...(relacionados?.uuids.length ? { relacionados } : {}) }
      : { emisor: cfg.emisor, receptor, conceptos: toConcepts(plan.lines), ...metodo, ...(cfg.marca ? { marca: cfg.marca } : {}), ...(relacionados?.uuids.length ? { relacionados } : {}) });
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
        if (!retried && now.status && now.status !== "link_enviado") return issueInvoice(orderId, fiscal, paymentForm, false, sendEmail, confirmTax, true, sat, group, false, choice, retention, false);
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
        ok: false, error: r.status === 0 ? undefined : r.error, code: r.status === 402 ? "sin-folios" : r.status === 401 ? "disconnected" : unknown ? "retry" : undefined,
        ...(r.status === 402 ? { foliosUrl: `${FACTURACION_SITE}/dashboard/folios` } : {}),
      };
    }
    const cfdi = r.data;
    await recordIssuedInvoice(supabase, cfg, { id: row.id, business_id: businessId, order_id: orderId }, cfdi, { actorId: user?.id ?? null, eventText: eventTextFor(kind) });
    const { data: saved } = await supabase.from("invoices").select("pdf_url").eq("id", row.id).maybeSingle();
    revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
    return {
      ok: true, invoiceId: row.id, uuid: cfdi.uuid ?? undefined, pdfUrl: await signMediaUrl((saved?.pdf_url as string) ?? null, 3600),
      publicUrl: cfdi.liga_publica, total: cfdi.total, simulated: cfdi.simulado, kind,
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
  /** `confirm-tax`: igual que al emitir. `already-issued`: el pedido ya tiene factura.
   *  `disconnected`: hay que volver a conectar el plugin. */
  code?: string;
  url?: string; sent?: boolean; reused?: boolean; expires?: string;
  /** El link que ya tenía el pedido se puso al día con lo que dice hoy; la liga es la misma. */
  updated?: boolean;
  /** Había un link y se cambió por uno nuevo (Facturación no pudo actualizarlo o allá ya no servía). */
  replaced?: boolean;
  total?: number; orderTotal?: number;
  /** Qué factura producirá el link: por el total o un anticipo. */
  kind?: InvoiceKind;
}

/**
 * Manda al cliente un link para que se facture solo (Hiraticket Facturación). El cliente captura
 * su RFC y recibe su factura; cuando lo hace, el webhook `link.facturado` deja la factura en el
 * pedido.
 *
 * Un pedido tiene UN link. Si dice lo mismo que el pedido de hoy, se reenvía tal cual. Si cambió el
 * monto, los conceptos (una clave SAT que se capturó después, un precio) o la fecha límite, ese
 * mismo link se pone al día en Facturación y la liga que ya tiene el cliente sigue sirviendo. Solo
 * se crea otro cuando allá ya no está abierto (se cerró o entró a la global) o la Facturación de
 * enfrente aún no sabe cambiar links; en ese caso el anterior se cierra antes, porque un link
 * abierto de más permitiría facturar dos veces y metería la venta a la factura global.
 */
export async function sendInvoiceLink(orderId: string, opts: { confirmTax?: boolean; send?: boolean; sat?: SatOverrides | null; until?: string | null; group?: GroupChoice; saveGroupAsDefault?: boolean; choice?: KindChoice | null; retention?: string | null; saveRetentionAsDefault?: boolean } = {}): Promise<LinkResult> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const ctx = await planOrderInvoice(supabase, orderId, opts.sat, opts.group);
  if (!ctx) return { ok: false, error: "order" };
  const { order } = ctx;
  const businessId = order.business_id;
  const cfg = await loadFxConfig(businessId);
  if (!cfg || !cfg.emisor) return { ok: false, error: "not-configured" };

  const rows = await orderInvoices(supabase, orderId);
  if (orderClosed(rows)) return { ok: false, code: "already-issued" };
  // Por el link se factura el total (pagado o a crédito, PPD) o un anticipo: el cliente se factura
  // solo. Un finiquito no, porque relaciona los folios de los anticipos y eso lo arma el pedido.
  const kind: InvoiceKind = opts.choice?.kind === "anticipo" ? "anticipo" : opts.choice?.kind === "ppd" ? "ppd" : "total";
  const { plan: kindPlan, error: kindErr } = planForKind(ctx.plan, order.code, { kind, amount: opts.choice?.amount }, anticiposOf(rows));
  if (kindErr) return { ok: false, error: kindErr };
  // Retenciones: las elegidas en la ventana, o las del negocio por defecto. Van en los conceptos del link.
  const plan = withRetention(kindPlan, isRetentionId(opts.retention) ? opts.retention : cfg.retention);
  if (!plan.ok) return { ok: false, error: planError(plan) };
  if (plan.addsTax && !opts.confirmTax) return { ok: false, code: "confirm-tax", total: plan.total, orderTotal: plan.orderTotal };

  await saveSatToCatalog(supabase, ctx.catalog, opts.sat);
  await saveSatToOrder(supabase, orderId, opts.sat);
  if (opts.saveGroupAsDefault && opts.group) await saveGroupDefault(supabase, businessId, opts.group);
  if (opts.saveRetentionAsDefault && isRetentionId(opts.retention)) await saveRetentionDefault(supabase, businessId, opts.retention);

  const live = liveLinks(rows);
  // El link del pedido es el más reciente; si quedaron otros de antes de esta regla, se cierran.
  // Si al cerrar uno resulta que el cliente ya se había facturado con él, esa es la factura.
  let link: InvRow | null = live[0] ?? null;
  for (const old of live.slice(1)) {
    const closed = await closeLinkRow(supabase, cfg, linkRef(old, businessId, orderId), user?.id ?? null);
    if (closed.status === "issued") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); return { ok: false, code: "already-issued" }; }
    if (closed.status === null) return { ok: false, error: closed.error };
  }
  // Dice lo de hoy si tiene el mismo monto y la misma huella, no venció y no se acaban de capturar
  // datos del SAT (sus conceptos se crearon sin ellos). Sin la columna de la huella (`undefined`)
  // se compara solo por monto, como antes; con huella nula (link de antes de guardarla) no se sabe.
  const fresh = Object.keys(cleanSat(opts.sat)).length > 0;
  const sig = planSig(plan);
  const same = (r: InvRow) => r.link_sig === undefined || r.link_sig === sig;
  let reused = false, updated = false, replaced = false;
  if (link) {
    const current = !fresh && !!link.link_url && (!link.link_expires || link.link_expires >= today()) && Math.abs((Number(link.total) || 0) - plan.total) < 0.005 && same(link) && (link.kind ?? "total") === kind;
    if (current) {
      reused = true;
      if (validUntil(opts.until) && link.link_expires !== opts.until) {
        // Se reenvía el mismo link pero con otra fecha límite: se le cambia allá y aquí.
        const r = await updateLinkExpiry(cfg.apiKey, link.link_code!, opts.until!);
        if (!r.ok) return { ok: false, error: r.status === 0 ? undefined : r.error, ...(r.status === 401 ? { code: "disconnected" } : {}) };
        await supabase.from("invoices").update({ link_expires: r.data?.vence ?? opts.until }).eq("id", link.id);
        link = { ...link, link_expires: r.data?.vence ?? opts.until! };
      }
    } else {
      const p = await patchLinkRow(supabase, cfg, link, order, plan, user?.id ?? null, opts.until, kind);
      if (p.row) { link = p.row; updated = true; }
      else if (p.status === "issued") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); return { ok: false, code: "already-issued" }; }
      else if (p.code === "disconnected") return { ok: false, code: "disconnected" };
      else if (p.code === "unsupported") {
        const closed = await closeLinkRow(supabase, cfg, linkRef(link, businessId, orderId), user?.id ?? null);
        if (closed.status === "issued") { revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat"); return { ok: false, code: "already-issued" }; }
        if (closed.status === null) return { ok: false, error: closed.error };
        link = null; replaced = true;
      } else if (p.status) { link = null; replaced = true; } // allá ya estaba cerrado o en la global
      else return { ok: false, error: p.error };
    }
  }
  if (!link) {
    const made = await newLinkRow(supabase, cfg, order, plan, user?.id ?? null, opts.until, kind);
    if (!made.row) return { ok: false, error: made.error, code: made.code };
    link = made.row;
  }

  let sent = false;
  if (opts.send !== false && order.conversation_id) {
    const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
    const first = ((contact?.name as string) ?? "").split(" ")[0];
    const money = "$" + Number(link.total ?? plan.total).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const until = link.link_expires ? ` (vence el ${new Date(`${link.link_expires}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long" })})` : "";
    const what = kind === "anticipo" ? `factura de tu anticipo de ${money} MXN del pedido ${order.code}`
      : kind === "ppd" ? `factura a crédito (PPD) del pedido ${order.code} por ${money} MXN`
      : `factura del pedido ${order.code} por ${money} MXN`;
    const body = `Hola${first ? ` ${first}` : ""} 👋 si necesitas ${what}, captura tus datos aquí: ${link.link_url} 🧾${until}.`;
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
    kind: "file", text: `Link de facturación${kind === "anticipo" ? " del anticipo" : kind === "ppd" ? " a crédito (PPD)" : ""} ${updated ? "actualizado y " : ""}${sent ? (reused ? "reenviado" : "enviado") : updated ? "listo" : "creado"} · ${link.link_code}${replaced ? " (sustituye al anterior)" : ""}`,
  });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, url: link.link_url ?? undefined, sent, reused, updated, replaced, expires: link.link_expires ?? undefined, total: Number(link.total ?? plan.total), orderTotal: plan.orderTotal, kind };
}

export interface PaymentResult {
  ok: boolean; error?: string;
  /** `sin-folios` · `disconnected` · `retry` (sin respuesta: antes de reintentar hay que ver en
   *  Facturación si el complemento ya se timbró, porque este paso no es idempotente). */
  code?: string;
  invoiceId?: string; uuid?: string; pdfUrl?: string | null; publicUrl?: string | null; simulated?: boolean;
  /** Número de parcialidad que le tocó y lo que le queda por pagar a la factura PPD. */
  partiality?: number; remaining?: number;
  foliosUrl?: string;
}

/**
 * Registra un abono a una factura PPD del pedido y timbra su complemento de pago (CFDI tipo P) en
 * Hiraticket Facturación. El complemento queda como fila `pago` colgada de la factura (`parent_id`),
 * con su folio, su PDF y su liga, igual que una factura. La parcialidad y el saldo los lleva
 * Facturación; aquí solo se evita abonar más de lo que falta.
 */
export async function stampPaymentComplement(invoiceId: string, input: { amount: number; date: string; form: string }): Promise<PaymentResult> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: inv } = await supabase.from("invoices").select("id, business_id, order_id, provider, status, kind, external_id, total").eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, error: "no-invoice" };
  if (inv.provider !== FX || inv.status !== "issued" || inv.kind !== "ppd" || !inv.external_id) return { ok: false, error: "not-ppd" };
  const amount = r2(Number(input.amount) || 0);
  if (!(amount > 0)) return { ok: false, error: "amount" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > todayMx()) return { ok: false, error: "date" };
  if (!input.form || input.form === "99") return { ok: false, error: "form" };
  const { data: kids } = await supabase.from("invoices").select("total").eq("parent_id", invoiceId).eq("status", "issued");
  const remaining = r2((Number(inv.total) || 0) - (kids ?? []).reduce((s, k) => s + (Number(k.total) || 0), 0));
  if (amount > remaining + 0.005) return { ok: false, error: "exceeds", remaining };
  const businessId = inv.business_id as string, orderId = inv.order_id as string;
  const cfg = await loadFxConfig(businessId);
  if (!cfg) return { ok: false, error: "not-configured" };

  const r = await createPayment(cfg.apiKey, inv.external_id as string, { monto: amount, fecha: input.date, forma_pago: input.form });
  if (!r.ok || !r.data) {
    const unknown = r.status === 0 || r.status >= 500;
    return {
      ok: false, error: r.status === 0 ? undefined : r.error,
      code: r.status === 402 ? "sin-folios" : r.status === 401 ? "disconnected" : unknown ? "retry" : undefined,
      ...(r.status === 402 ? { foliosUrl: `${FACTURACION_SITE}/dashboard/folios` } : {}),
    };
  }
  const p = r.data;
  const pdfPath = p.pdf ? await hostInvoicePdf(businessId, orderId, p.uuid || p.id, await fetchCfdiPdf(cfg.apiKey, p.id)) : null;
  const { data: ins } = await supabase.from("invoices").insert({
    business_id: businessId, order_id: orderId, provider: FX, status: "issued", kind: "pago", parent_id: invoiceId,
    external_id: p.id, uuid: p.uuid || null, total: amount, public_url: p.liga_publica ?? null, xml_url: p.xml ?? null, pdf_url: pdfPath, created_by: user?.id ?? null,
  }).select("id").single();
  const money = "$" + amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: user?.id ?? null,
    kind: "file", text: `Complemento de pago ${p.parcialidad} por ${money} · ${p.uuid || p.id}${p.simulado ? " (simulado)" : ""}`,
  });
  await supabase.from("plugin_usage").insert({ business_id: businessId, plugin_id: FX, unit: "factura", qty: 1, meta: { uuid: p.uuid, total: amount, simulado: p.simulado, complemento: true } });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return {
    ok: true, invoiceId: (ins?.id as string) ?? undefined, uuid: p.uuid ?? undefined, pdfUrl: await signMediaUrl(pdfPath, 3600), publicUrl: p.liga_publica,
    simulated: p.simulado, partiality: p.parcialidad, remaining: p.saldo_factura,
  };
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

/** Cambia hasta cuándo puede facturarse el cliente con el link abierto de un pedido: darle más
 *  tiempo, o menos. Se cambia en Facturación y luego aquí; una fecha de hoy en adelante vuelve a
 *  abrir uno que ya se veía vencido. Devuelve la fecha que quedó. */
export async function setInvoiceLinkExpiry(invoiceId: string, until: string): Promise<{ ok: boolean; until?: string; error?: string; code?: string }> {
  if (!validUntil(until)) return { ok: false, error: "date" };
  const supabase = await createClient();
  const user = await getSessionUser();
  const { data: inv } = await supabase.from("invoices").select("id, business_id, order_id, status, link_code, link_expires").eq("id", invoiceId).maybeSingle();
  if (!inv?.link_code) return { ok: false, error: "no-link" };
  // Uno que aquí ya se marcó vencido también se puede extender: allá sigue abierto (el vencimiento
  // se mira por la fecha), así que al darle más tiempo vuelve a servir.
  if (inv.status !== "link_enviado" && inv.status !== "vencido") return { ok: false, code: "not-open" };
  const cfg = await loadFxConfig(inv.business_id as string);
  if (!cfg) return { ok: false, error: "not-configured" };
  const r = await updateLinkExpiry(cfg.apiKey, inv.link_code as string, until);
  if (!r.ok) {
    if (r.status === 401) return { ok: false, code: "disconnected" };
    // 409: allá ya no está abierto (se facturó, entró a la global o se cerró). Se trae ese estado.
    if (r.status === 409) { await refreshInvoiceLink(invoiceId); return { ok: false, code: "not-open" }; }
    return { ok: false, error: r.status === 0 ? undefined : r.error };
  }
  const vence = r.data?.vence ?? until;
  await supabase.from("invoices").update({ link_expires: vence, status: "link_enviado" }).eq("id", invoiceId);
  const fecha = new Date(`${vence}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  await supabase.from("events").insert({
    business_id: inv.business_id, parent_type: "order", parent_id: inv.order_id, actor_id: user?.id ?? null,
    kind: "file", text: `Link de facturación ${inv.link_code}: ahora se puede usar hasta el ${fecha}`,
  });
  revalidatePath("/orders"); revalidatePath("/kanban"); revalidatePath("/chat");
  return { ok: true, until: vence };
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
