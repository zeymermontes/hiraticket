import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPluginRuntimeConfig } from "@/lib/plugins";
import { encryptSecret } from "@/lib/secrets";
import { appBaseUrl } from "@/lib/url";
import { encryptBody } from "@/lib/msgcrypto";
import { flushCloudOutbox } from "@/lib/cloud-outbox";
import { mediaPath } from "@/lib/mediaSign";
import { pushCustomerInvoiced } from "@/lib/push";
import { LINK_INVOICED_EVENT } from "@/lib/invoiceEvents";
import { planInvoice, productKey, toNetPrice, fromNetPrice, cleanSat, type InvoicePlan, type InvoiceLine, type SatOverrides } from "@/lib/invoiceLines";
import {
  PLUGIN_ID, fxUrl, fetchCfdiPdf, listProducts, upsertProduct, upsertProducts, deleteRemoteProduct, closeLink, getLink,
  setWebhook, WEBHOOK_EVENTS_PRODUCTS,
  type FxCfdi, type FxConcept, type FxProduct, type FxProductInput,
} from "@/lib/facturacion";

// Lo que comparten las acciones del pedido, el webhook entrante y el catálogo para hablar con
// Hiraticket Facturación: leer la configuración del plugin, armar los conceptos de un pedido,
// registrar la factura cuando llega y sincronizar productos.
//
// Las funciones reciben el cliente de base de datos de quien llama. Con el del usuario, RLS decide
// si puede; con el de servicio (webhook), quien llama ya verificó la firma.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

export type SyncMode = "off" | "push" | "pull" | "ambos";
export interface FxConfig {
  apiKey: string; emisor: string; marca: string; linkDays: number; sync: SyncMode; autoWhatsapp: boolean; webhookSecret: string;
}

/** Configuración ACTIVA del plugin, con secretos descifrados. null si no está instalado o le falta
 *  la llave. Nunca sale del servidor. */
export async function loadFxConfig(businessId: string): Promise<FxConfig | null> {
  const c = await getPluginRuntimeConfig(businessId, PLUGIN_ID);
  const apiKey = c?.api_key?.trim();
  if (!c || !apiKey) return null;
  const days = Math.round(Number(c.link_vigencia_dias));
  const sync = (["push", "pull", "ambos"].includes(c.sync_productos) ? c.sync_productos : "off") as SyncMode;
  return {
    apiKey, emisor: (c.emisor || "").trim().toUpperCase(), marca: (c.marca || "").trim(),
    linkDays: days >= 1 && days <= 365 ? days : 30, sync,
    autoWhatsapp: c.auto_whatsapp === "true", webhookSecret: c._webhook_secret || "",
  };
}

/* ---------- webhook ---------- */

/** A dónde nos avisa Facturación de lo que pasa en la cuenta de este negocio. */
export const fxWebhookUrl = (businessId: string) => `${appBaseUrl()}/api/plugins/facturacion/webhook?biz=${businessId}`;
/** Lo que se guarda junto al secreto para saber qué eventos quedaron registrados. */
export const eventsTag = (eventos: string[] | undefined) => [...(eventos ?? [])].sort().join(",");
export const hasProductEvents = (tag: string | undefined) => WEBHOOK_EVENTS_PRODUCTS.every((e) => (tag ?? "").split(",").includes(e));

/**
 * Un webhook registrado antes de que existieran los avisos del catálogo no los recibe: Facturación
 * no los activa sola. Aquí se vuelve a registrar (misma dirección) para pedirlos. Se intenta como
 * mucho una vez al día por negocio, porque cada registro cambia el secreto y no hay prisa: mientras
 * tanto la sincronización por lista sigue trayendo los cambios.
 *
 * No toca nada si la cuenta ya manda sus avisos a otro sistema (409): eso lo decide el usuario al
 * guardar la configuración del plugin.
 */
export async function ensureProductEvents(businessId: string): Promise<void> {
  const raw = await getPluginRuntimeConfig(businessId, PLUGIN_ID);
  const apiKey = raw?.api_key?.trim();
  if (!raw || !apiKey || !raw._webhook_secret || hasProductEvents(raw._webhook_events)) return;
  const last = Date.parse(raw._webhook_checked_at || "");
  if (!Number.isNaN(last) && Date.now() - last < 24 * 3600_000) return;
  const url = fxWebhookUrl(businessId);
  if (!url.startsWith("https://")) return;
  const admin = createAdminClient();
  const save = async (patch: Record<string, string>) => {
    const { data } = await admin.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", PLUGIN_ID).maybeSingle();
    if (data) await admin.from("business_plugins").update({ config: { ...((data.config as Record<string, unknown>) ?? {}), ...patch } }).eq("business_id", businessId).eq("plugin_id", PLUGIN_ID);
  };
  const w = await setWebhook(apiKey, url, false);
  const checked = { _webhook_checked_at: new Date().toISOString() };
  if (!w.ok || !w.data?.secreto) { await save(checked); return; }
  await save({ ...checked, _webhook_secret: encryptSecret(w.data.secreto), _webhook_events: eventsTag(w.data.webhook?.eventos) });
}

/* ---------- pedido → conceptos ---------- */

export interface OrderForInvoice {
  id: string; business_id: string; code: string; total: number; contact_id: string | null; conversation_id: string | null;
}

/** Carga el pedido y arma el plan de facturación (qué renglones, a qué tasa, por cuánto). Vale
 *  para cualquier proveedor de CFDI: la regla de precios es una sola.
 *
 *  `sat` son los datos del SAT que se capturaron al facturar para los renglones que no los tenían.
 *  Entran al plan de esta factura; `catalog` (lo que hay guardado, sin ellos) sirve para saber a
 *  qué productos hay que guardárselos. */
export async function planOrderInvoice(db: DB, orderId: string, sat?: SatOverrides | null, group?: GroupChoice): Promise<{ order: OrderForInvoice; plan: InvoicePlan; catalog: CatalogSat; group: GroupInfo } | null> {
  // discount (0058) y requires_invoice/tax_rate (0050) pueden no existir: se cae a lo básico.
  let { data: o, error } = await db.from("orders").select("id, business_id, code, total, contact_id, conversation_id, tax_rate, discount").eq("id", orderId).maybeSingle();
  if (error) ({ data: o, error } = await db.from("orders").select("id, business_id, code, total, contact_id, conversation_id").eq("id", orderId).maybeSingle() as never);
  if (!o) return null;
  const row = o as Record<string, unknown>;
  const businessId = row.business_id as string;
  const [{ data: biz }, itemsFull, prodRes, pcfg] = await Promise.all([
    db.from("businesses").select("invoice_add_tax, invoice_tax_rate").eq("id", businessId).maybeSingle(),
    db.from("order_items").select("name, qty, unit_price, subtotal, sat_code, sat_unit").eq("order_id", orderId),
    db.from("products").select("id, name, sat_code, sat_unit, iva").eq("business_id", businessId).order("name"),
    getPluginRuntimeConfig(businessId, PLUGIN_ID),
  ]);
  // sat_code/sat_unit del renglón son de 0097: sin ellas se lee lo de siempre.
  const itemsRes = itemsFull.error ? await db.from("order_items").select("name, qty, unit_price, subtotal").eq("order_id", orderId) : itemsFull;
  type ItemRow = { name: string | null; qty: number | null; unit_price: number | null; subtotal: number | null; sat_code?: string | null; sat_unit?: string | null };
  const itemRows = (itemsRes.data ?? []) as ItemRow[];
  const b = (biz ?? {}) as { invoice_add_tax?: boolean; invoice_tax_rate?: number };
  // Sin 0096 la consulta de productos falla: se factura con la clave genérica, como antes.
  const products = new Map<string, { id: string; sat_code: string | null; sat_unit: string | null; iva: number | null }>();
  for (const p of (prodRes.error ? [] : prodRes.data ?? []) as Record<string, unknown>[]) {
    products.set(productKey(p.name as string), {
      id: p.id as string, sat_code: (p.sat_code as string) || null, sat_unit: (p.sat_unit as string) || null,
      iva: p.iva == null ? null : Number(p.iva),
    });
  }
  const catalog: CatalogSat = new Map([...products].map(([k, v]) => [k, { id: v.id, sat_code: v.sat_code, sat_unit: v.sat_unit }]));
  // Lo capturado antes para un renglón de este pedido manda sobre el catálogo; lo que se captura
  // ahora (`sat`) manda sobre los dos.
  for (const it of itemRows) {
    if (!it.sat_code && !it.sat_unit) continue;
    const k = productKey(it.name);
    const cur = products.get(k);
    products.set(k, { id: cur?.id ?? "", sat_code: it.sat_code || cur?.sat_code || null, sat_unit: it.sat_unit || cur?.sat_unit || null, iva: cur?.iva ?? null });
  }
  for (const [k, v] of Object.entries(cleanSat(sat))) {
    const cur = products.get(k);
    products.set(k, { id: cur?.id ?? "", sat_code: v.code || cur?.sat_code || null, sat_unit: v.unit || cur?.sat_unit || null, iva: cur?.iva ?? null });
  }
  // Todo en un concepto: lo que se eligió ahora, o lo que el negocio dejó por defecto en el plugin.
  // El concepto es un producto del catálogo; sus datos del SAT son los que ya se cruzaron arriba
  // con lo capturado, así que una clave que se capture aquí para él también cuenta.
  const prodRows = (prodRes.error ? [] : prodRes.data ?? []) as { id: string; name: string | null; sat_code: string | null; sat_unit: string | null; iva: number | null }[];
  const defaultOn = pcfg?.agrupar === "true";
  const defaultProductId = (pcfg?.agrupar_producto || "").trim() || null;
  const choice = group === undefined || group === null ? { on: defaultOn, productId: defaultProductId } : group;
  const gp = choice.on && choice.productId ? prodRows.find((p) => p.id === choice.productId) ?? null : null;
  const gk = gp ? productKey(gp.name) : "";
  const gsat = gp ? products.get(gk) : undefined;
  const plan = planInvoice({
    order: { total: Number(row.total) || 0, tax_rate: row.tax_rate == null ? null : Number(row.tax_rate), discount: row.discount == null ? null : Number(row.discount) },
    business: { invoice_add_tax: b.invoice_add_tax ?? true, invoice_tax_rate: Number(b.invoice_tax_rate ?? 16) },
    items: itemRows,
    products,
    group: gp ? { description: (gp.name ?? "").trim(), satCode: gsat?.sat_code ?? gp.sat_code, satUnit: gsat?.sat_unit ?? gp.sat_unit, iva: gp.iva == null ? null : Number(gp.iva), sku: gp.id, key: gk } : null,
  });
  return {
    order: { id: row.id as string, business_id: businessId, code: row.code as string, total: Number(row.total) || 0, contact_id: (row.contact_id as string) ?? null, conversation_id: (row.conversation_id as string) ?? null },
    plan,
    catalog,
    group: {
      on: choice.on, productId: gp ? gp.id : choice.on ? choice.productId : null, defaultOn, defaultProductId,
      options: prodRows.map((p) => ({ id: p.id, name: (p.name ?? "").trim(), satCode: p.sat_code || null, satUnit: p.sat_unit || null })),
    },
  };
}

/**
 * Lo capturado al facturar se queda también en los renglones del pedido que no lo tenían. Así no
 * se vuelve a pedir para un renglón escrito a mano (no hay producto del catálogo donde guardarlo)
 * ni cuando quien factura no puede editar el catálogo. Sin 0097 no hay dónde: no pasa nada.
 */
export async function saveSatToOrder(db: DB, orderId: string, sat: SatOverrides | null | undefined): Promise<void> {
  const clean = cleanSat(sat);
  if (!Object.keys(clean).length) return;
  const { data, error } = await db.from("order_items").select("id, name, sat_code, sat_unit").eq("order_id", orderId);
  if (error) return;
  for (const it of (data ?? []) as { id: string; name: string | null; sat_code: string | null; sat_unit: string | null }[]) {
    const v = clean[productKey(it.name)];
    if (!v) continue;
    const patch: Record<string, string> = {};
    if (v.code && !it.sat_code) patch.sat_code = v.code;
    if (v.unit && !it.sat_unit) patch.sat_unit = v.unit;
    if (Object.keys(patch).length) await db.from("order_items").update(patch).eq("id", it.id);
  }
}

/** Datos del SAT que el catálogo tiene guardados, por nombre normalizado. */
export type CatalogSat = Map<string, { id: string; sat_code: string | null; sat_unit: string | null }>;

/** Cómo facturar los renglones: juntos en un concepto del catálogo (`on` con `productId`) o
 *  desglosados. `undefined` = como lo tenga por defecto el negocio (configuración del plugin). */
export type GroupChoice = { on: boolean; productId: string | null } | null | undefined;
/** Lo que se le enseña a quien factura: qué se eligió, qué hay por defecto y de qué conceptos del
 *  catálogo se puede escoger. */
export interface GroupInfo {
  on: boolean; productId: string | null;
  defaultOn: boolean; defaultProductId: string | null;
  options: { id: string; name: string; satCode: string | null; satUnit: string | null }[];
}

/** Guarda en la configuración del plugin cómo se agrupa por defecto. Solo quien puede editar la
 *  configuración (RLS) lo cambia; si no puede, no pasa nada y se devuelve `false`. */
export async function saveGroupDefault(db: DB, businessId: string, choice: { on: boolean; productId: string | null }): Promise<boolean> {
  const { data } = await db.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", PLUGIN_ID).maybeSingle();
  if (!data) return false;
  const cfg = { ...((data.config as Record<string, unknown>) ?? {}), agrupar: choice.on ? "true" : "false", agrupar_producto: choice.on && choice.productId ? choice.productId : "" };
  const { count, error } = await db.from("business_plugins").update({ config: cfg, updated_at: new Date().toISOString() }, { count: "exact" }).eq("business_id", businessId).eq("plugin_id", PLUGIN_ID);
  return !error && !!count;
}

/**
 * Lo capturado al facturar se le guarda al producto del catálogo, para no volver a pedirlo en el
 * siguiente pedido. Solo llena lo que estaba vacío (nunca pisa una clave que ya tenía) y solo
 * toca renglones que sí son productos del catálogo. Es un extra: si quien factura no puede
 * editar el catálogo, la factura sale igual con lo que capturó.
 */
export async function saveSatToCatalog(db: DB, catalog: CatalogSat, sat: SatOverrides | null | undefined): Promise<void> {
  for (const [k, v] of Object.entries(cleanSat(sat))) {
    const prod = catalog.get(k);
    if (!prod?.id) continue;
    const patch: Record<string, string> = {};
    if (v.code && !prod.sat_code) patch.sat_code = v.code;
    if (v.unit && !prod.sat_unit) patch.sat_unit = v.unit;
    if (!Object.keys(patch).length) continue;
    const { error } = await db.from("products").update(patch).eq("id", prod.id);
    if (!error) after(() => pushProduct(prod.id).catch(() => {}));
  }
}

const SAT_CODE = /^\d{8}$/;
export const toConcepts = (lines: InvoiceLine[]): FxConcept[] => lines.map((l) => ({
  descripcion: l.description, cantidad: l.qty, precio: l.price, iva: l.iva,
  ...(l.discount > 0 ? { descuento: l.discount } : {}),
  ...(l.satCode && SAT_CODE.test(l.satCode) ? { clave: l.satCode } : {}),
  ...(l.satUnit ? { unidad: l.satUnit } : {}),
  ...(l.sku ? { sku: l.sku } : {}),
}));

/* ---------- factura emitida ---------- */

/** Guarda el PDF timbrado en nuestro bucket (privado) y devuelve la RUTA, o null. */
export async function hostInvoicePdf(businessId: string, orderId: string, name: string, pdf: Uint8Array | null): Promise<string | null> {
  if (!pdf) return null;
  const path = `invoices/${businessId}/${orderId}/${name.replace(/[^A-Za-z0-9._-]/g, "")}.pdf`;
  const up = await createAdminClient().storage.from("media").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  return up.error ? null : path;
}

export interface InvoiceRowRef { id: string; business_id: string; order_id: string }

/** Deja la fila de `invoices` como EMITIDA con los datos del CFDI: folio, total, ligas y PDF propio.
 *  La usan el timbrado directo, el webhook `link.facturado` y la consulta manual del link.
 *
 *  Es idempotente y atómica: el paso a `issued` es un UPDATE condicionado a que la fila aún no lo
 *  esté. Si el webhook y la consulta manual llegan a la vez, solo uno "gana" y deja el rastro en la
 *  actividad (y manda el WhatsApp); el otro ve `changed: false` y no repite nada. */
export async function recordIssuedInvoice(
  db: DB, cfg: FxConfig, inv: InvoiceRowRef, cfdi: FxCfdi, opts: { actorId: string | null; eventText: string },
): Promise<{ changed: boolean }> {
  const { data: won } = await db.from("invoices").update({
    status: "issued", external_id: cfdi.id, uuid: cfdi.uuid || null, total: cfdi.total ?? null,
    public_url: cfdi.liga_publica ?? null, xml_url: cfdi.xml ?? null,
  }).eq("id", inv.id).neq("status", "issued").select("id");
  if (!won?.length) return { changed: false };
  if (cfdi.pdf) {
    const pdfPath = await hostInvoicePdf(inv.business_id, inv.order_id, cfdi.uuid || cfdi.id, await fetchCfdiPdf(cfg.apiKey, cfdi.id));
    if (pdfPath) await db.from("invoices").update({ pdf_url: pdfPath }).eq("id", inv.id);
  }
  await db.from("events").insert({
    business_id: inv.business_id, parent_type: "order", parent_id: inv.order_id, actor_id: opts.actorId,
    kind: "file", text: `${opts.eventText} · ${cfdi.uuid || cfdi.id}${cfdi.simulado ? " (simulada)" : ""}`,
  });
  await db.from("plugin_usage").insert({ business_id: inv.business_id, plugin_id: PLUGIN_ID, unit: "factura", qty: 1, meta: { uuid: cfdi.uuid, total: cfdi.total, simulado: cfdi.simulado } });
  return { changed: true };
}

/** El cliente se facturó desde el link: se registra la factura y, si el negocio lo pidió, se le
 *  manda por WhatsApp. Devuelve si esta llamada fue la que la registró. */
export async function settleLinkInvoice(db: DB, cfg: FxConfig, inv: InvoiceRowRef, cfdi: FxCfdi, actorId: string | null): Promise<boolean> {
  const { changed } = await recordIssuedInvoice(db, cfg, inv, cfdi, { actorId, eventText: LINK_INVOICED_EVENT });
  if (changed && cfg.autoWhatsapp) await sendInvoiceToChat(db, inv.order_id, inv.id, null);
  // El equipo se entera sin tener que abrir el pedido: push a quien lo tiene asignado (o a todos).
  if (changed) after(() => pushCustomerInvoiced({ businessId: inv.business_id, orderId: inv.order_id, total: cfdi.total }).catch(() => {}));
  return changed;
}

/* ---------- links ---------- */

export interface LinkRowRef extends InvoiceRowRef { link_code: string }

/** Pone la fila al día con lo que Facturación dice del link: facturado (deja la factura en el
 *  pedido, igual que el webhook), vencido, cerrado o en la factura global. Devuelve el estatus que
 *  quedó en la fila, o null si no se pudo consultar. */
export async function syncLinkRow(db: DB, cfg: FxConfig, row: LinkRowRef, actorId: string | null): Promise<{ status: string | null; error?: string }> {
  const r = await getLink(cfg.apiKey, row.link_code);
  // El link ya no existe del otro lado (lo borraron): para nosotros es un link cerrado.
  if (r.status === 404) { await db.from("invoices").update({ status: "cerrado" }).eq("id", row.id).eq("status", "link_enviado"); return { status: "cerrado" }; }
  if (!r.ok || !r.data) return { status: null, error: r.status === 0 ? undefined : r.error };
  const st = r.data.estatus;
  if (st === "facturado" && r.data.cfdi) { await settleLinkInvoice(db, cfg, row, r.data.cfdi, actorId); return { status: "issued" }; }
  if (st === "vencido" || st === "global" || st === "cerrado") {
    await db.from("invoices").update({ status: st }).eq("id", row.id).eq("status", "link_enviado");
    return { status: st };
  }
  return { status: "link_enviado" };
}

/** Cierra en Facturación un link que ya no debe usarse y deja la fila en `cerrado`. Un link
 *  abierto (o vencido) sin factura entra a la factura global del negocio, así que el que se queda
 *  colgado no solo permite facturar dos veces: esa venta se factura dos veces sola.
 *
 *  Si Facturación dice que ya se facturó o que ya entró a la global (409), no se fuerza nada: se
 *  lee el estado real y se refleja. Devuelve el estatus final de la fila, o null si no se pudo. */
export async function closeLinkRow(db: DB, cfg: FxConfig, row: LinkRowRef, actorId: string | null): Promise<{ status: string | null; error?: string }> {
  const r = await closeLink(cfg.apiKey, row.link_code);
  if (r.ok || r.status === 404) {
    await db.from("invoices").update({ status: "cerrado" }).eq("id", row.id).eq("status", "link_enviado");
    return { status: "cerrado" };
  }
  if (r.status === 409) return syncLinkRow(db, cfg, row, actorId);
  return { status: null, error: r.status === 0 ? undefined : r.error };
}

/** Un pedido que se cancela o se borra ya no es una venta: se cierran sus links abiertos para que
 *  no entren a la factura global. Sin el plugin activo, o sin links, no hace nada. */
export async function closeOrderLinks(db: DB, orderId: string, actorId: string | null): Promise<void> {
  const { data, error } = await db.from("invoices").select("id, business_id, order_id, link_code").eq("order_id", orderId).eq("provider", PLUGIN_ID).eq("status", "link_enviado").not("link_code", "is", null);
  if (error || !data?.length) return;
  const cfg = await loadFxConfig(data[0].business_id as string);
  if (!cfg) return;
  for (const r of data) {
    const res = await closeLinkRow(db, cfg, { id: r.id as string, business_id: r.business_id as string, order_id: r.order_id as string, link_code: r.link_code as string }, actorId);
    if (res.status === "cerrado") {
      await db.from("events").insert({ business_id: r.business_id, parent_type: "order", parent_id: orderId, actor_id: actorId, kind: "file", text: `Link de facturación cerrado · ${r.link_code}` });
    }
  }
}

/** Manda la factura al chat del pedido: el PDF adjunto si lo tenemos; si no, la liga pública. */
export async function sendInvoiceToChat(db: DB, orderId: string, invoiceId: string, authorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const [{ data: order }, invRes] = await Promise.all([
    db.from("orders").select("business_id, code, conversation_id, contact_id").eq("id", orderId).maybeSingle(),
    db.from("invoices").select("uuid, pdf_url, public_url").eq("id", invoiceId).maybeSingle(),
  ]);
  // public_url es de 0096: sin ella se vuelve a leer lo de siempre.
  const inv = (invRes.error
    ? (await db.from("invoices").select("uuid, pdf_url").eq("id", invoiceId).maybeSingle()).data
    : invRes.data) as { uuid: string | null; pdf_url: string | null; public_url?: string | null } | null;
  if (!order?.conversation_id) return { ok: false, error: "no-conversation" };
  if (!inv) return { ok: false, error: "no-invoice" };
  const { data: contact } = await db.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
  const first = ((contact?.name as string) ?? "").split(" ")[0];
  const businessId = order.business_id as string;
  // El PDF va ADJUNTO, no como enlace: el bucket es privado y un enlace firmado caduca; el
  // archivo en el chat del cliente se queda. Con la ruta en media_url, el worker y la API oficial
  // lo mandan como documento igual que cualquier archivo. Sin PDF propio va la liga pública de la
  // factura (no caduca y trae PDF y XML); sin ninguna, solo el texto.
  const pdfPath = mediaPath(inv.pdf_url);
  const link = !pdfPath && inv.public_url ? ` Descárgala aquí: ${fxUrl(inv.public_url)}` : "";
  const body = `¡Hola ${first}! 🧾 Aquí está tu factura del pedido ${order.code}.${inv.uuid ? ` Folio fiscal: ${inv.uuid}.` : ""}${link}`;
  await db.from("messages").insert({
    business_id: businessId, conversation_id: order.conversation_id,
    direction: "out", type: pdfPath ? "document" : "text", body: encryptBody(businessId, body), author_id: authorId, state: "queued",
    ...(pdfPath ? { media_url: pdfPath, media_mime: "application/pdf", media_name: `Factura-${order.code}.pdf` } : {}),
  });
  await db.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
  await flushCloudOutbox(businessId);
  return { ok: true };
}

/* ---------- productos ---------- */

// El catálogo se mantiene igual en los dos sistemas de tres formas que se complementan:
//
//   · Hiraticket → Facturación: al crear, editar o borrar aquí se llama a su API en ese momento.
//   · Facturación → Hiraticket: su webhook avisa de cada cambio (`producto.creado`,
//     `producto.actualizado`, `producto.eliminado`; `productos.importados` cuando una sola operación
//     tocó más de 100 y hay que traerlos por lista).
//   · «Sincronizar ahora» y la sincronización al abrir el catálogo, por si un aviso no llegó.
//
// Para que un cambio no rebote ni un aviso viejo pise uno nuevo, cada producto guarda en
// `synced_at` la fecha `actualizado` de la versión de Facturación que ya tiene. Todo lo que llegue
// con una fecha igual o anterior se ignora: eso cubre el eco de nuestro propio envío (Facturación
// lo anuncia con la misma fecha que nos devolvió) y los avisos que llegan desordenados por
// reintentos. Lo que entra de allá se escribe directo en la base y no dispara un envío de vuelta.

const IVAS = [0, 0.08, 0.16];
interface LocalProduct { id: string; name: string; price: number; sat_code: string | null; sat_unit: string | null; iva: number | null; facturacion_id: string | null; synced_at?: string | null; active?: boolean }
type Biz = { invoice_add_tax: boolean; invoice_tax_rate: number };

async function bizTax(db: DB, businessId: string): Promise<Biz> {
  const { data } = await db.from("businesses").select("invoice_add_tax, invoice_tax_rate").eq("id", businessId).maybeSingle();
  const b = (data ?? {}) as Partial<Biz>;
  return { invoice_add_tax: b.invoice_add_tax ?? true, invoice_tax_rate: Number(b.invoice_tax_rate ?? 16) };
}

function toRemote(p: LocalProduct, biz: Biz): FxProductInput {
  // Sin IVA propio va la tasa del negocio. Si no se mandara, Facturación pondría 16 % por defecto
  // y el siguiente pull lo traería de vuelta como IVA propio del producto: mal para un negocio de
  // zona fronteriza (8 %).
  const own = p.iva != null ? Number(p.iva) : (Number(biz.invoice_tax_rate) || 0) / 100;
  const iva = IVAS.includes(own) ? own : undefined;
  return {
    ...(p.facturacion_id ? { id: p.facturacion_id } : {}),
    sku: p.id, nombre: p.name, precio: toNetPrice(Number(p.price) || 0, biz, p.iva != null ? Number(p.iva) : null),
    ...(p.sat_code && SAT_CODE.test(p.sat_code) ? { clave: p.sat_code } : {}),
    ...(p.sat_unit ? { unidad: p.sat_unit.toUpperCase() } : {}),
    ...(iva !== undefined ? { iva } : {}),
  };
}

const PRODUCT_COLS = "id, name, price, sat_code, sat_unit, iva, facturacion_id, synced_at";
const pushes = (m: SyncMode) => m === "push" || m === "ambos";
const pulls = (m: SyncMode) => m === "pull" || m === "ambos";
/** Fecha ISO a microsegundos. `Date.parse` se queda en milisegundos y las fechas de la base traen
 *  seis decimales: dos escrituras dentro del mismo milisegundo parecerían la misma versión. */
function micros(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return NaN;
  const frac = /\.(\d+)/.exec(iso)?.[1] ?? "";
  return Math.floor(ms / 1000) * 1e6 + Number((frac + "000000").slice(0, 6));
}
/** ¿`a` es posterior a `b`? Sin `b` (nunca sincronizado) cualquier fecha lo es. */
const newer = (a: string | null | undefined, b: string | null | undefined) => !b || (!!a && micros(a) > micros(b));

/** Hiraticket → Facturación, un producto. Se llama después de crear o editar, sin frenar la
 *  respuesta. No hace nada si el plugin no está activo o la sincronización no va en ese sentido. */
export async function pushProduct(productId: string): Promise<void> {
  const db = createAdminClient();
  const { data: p } = await db.from("products").select(`business_id, ${PRODUCT_COLS}`).eq("id", productId).maybeSingle();
  if (!p) return;
  const businessId = (p as unknown as { business_id: string }).business_id;
  const cfg = await loadFxConfig(businessId);
  if (!cfg || !pushes(cfg.sync)) return;
  const local = p as unknown as LocalProduct;
  const biz = await bizTax(db, businessId);
  let r = await upsertProduct(cfg.apiKey, toRemote(local, biz));
  // El id guardado ya no existe allá (lo borraron en el panel): se vuelve a casar por sku o nombre.
  if (!r.ok && r.status === 404 && local.facturacion_id) r = await upsertProduct(cfg.apiKey, toRemote({ ...local, facturacion_id: null }, biz));
  if (r.ok && r.data?.id) await db.from("products").update({ facturacion_id: r.data.id, synced_at: r.data.actualizado || new Date().toISOString() }).eq("id", productId);
}

/** Borra allá el producto que se acaba de borrar aquí. Los datos se leen ANTES de borrar la fila. */
export async function removeRemoteProduct(businessId: string, facturacionId: string | null): Promise<void> {
  if (!facturacionId) return;
  const cfg = await loadFxConfig(businessId);
  if (!cfg || !pushes(cfg.sync)) return;
  await deleteRemoteProduct(cfg.apiKey, facturacionId); // un 404 es que ya no estaba: da igual
}

export interface SyncResult { ok: boolean; error?: string; pushed: number; created: number; updated: number; deactivated: number }

async function saveSyncState(businessId: string, patch: Record<string, string>): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", PLUGIN_ID).maybeSingle();
  if (!data) return;
  await admin.from("business_plugins").update({ config: { ...((data.config as Record<string, unknown>) ?? {}), ...patch } }).eq("business_id", businessId).eq("plugin_id", PLUGIN_ID);
}

/** Índices del catálogo local para casar un producto de Facturación: por su id de allá, por sku
 *  (= id de aquí) y por nombre, en ese orden. */
function indexLocals(locals: LocalProduct[]) {
  return {
    byRemoteId: new Map(locals.filter((p) => p.facturacion_id).map((p) => [p.facturacion_id as string, p])),
    byId: new Map(locals.map((p) => [p.id, p])),
    byName: new Map(locals.map((p) => [productKey(p.name), p])),
  };
}
type LocalIndex = ReturnType<typeof indexLocals>;

/** Deja un producto de Facturación reflejado aquí: lo crea si no existe o le pone lo que cambió.
 *  Lo usan el pull y el webhook. Una versión que ya tenemos (o más vieja) no hace nada. */
async function applyRemoteProduct(db: DB, businessId: string, biz: Biz, idx: LocalIndex, rp: FxProduct): Promise<{ result: "created" | "updated" | "linked" | "skipped"; error?: string }> {
  const stamp = rp.actualizado || new Date().toISOString();
  const iva = rp.exento ? 0 : IVAS.includes(Number(rp.iva)) ? Number(rp.iva) : null;
  const price = fromNetPrice(Number(rp.precio) || 0, biz, iva);
  const local = idx.byRemoteId.get(rp.id) ?? (rp.sku ? idx.byId.get(rp.sku) : undefined) ?? idx.byName.get(productKey(rp.nombre));
  if (!local) {
    const { data: ins, error } = await db.from("products").insert({
      business_id: businessId, name: rp.nombre, kind: "product", price,
      sat_code: rp.clave || null, sat_unit: rp.unidad || null, iva, facturacion_id: rp.id, synced_at: stamp,
    }).select("id").maybeSingle();
    if (error) return { result: "skipped", error: error.message };
    if (ins) {
      const np: LocalProduct = { id: ins.id as string, name: rp.nombre, price, sat_code: rp.clave, sat_unit: rp.unidad, iva, facturacion_id: rp.id, synced_at: stamp };
      idx.byRemoteId.set(rp.id, np); idx.byId.set(np.id, np); idx.byName.set(productKey(rp.nombre), np);
    }
    return { result: "created" };
  }
  if (local.facturacion_id === rp.id && !newer(rp.actualizado, local.synced_at)) return { result: "skipped" };
  const patch: Record<string, unknown> = {};
  if (local.name !== rp.nombre) patch.name = rp.nombre;
  // El precio va y viene con una división entre 1.16: solo cuenta como cambio si mueve un centavo.
  if (Math.abs((Number(local.price) || 0) - price) >= 0.01) patch.price = price;
  if ((local.sat_code || null) !== (rp.clave || null)) patch.sat_code = rp.clave || null;
  if ((local.sat_unit || null) !== (rp.unidad || null)) patch.sat_unit = rp.unidad || null;
  if ((local.iva == null ? null : Number(local.iva)) !== iva) patch.iva = iva;
  const changed = Object.keys(patch).length > 0;
  if (local.facturacion_id !== rp.id) patch.facturacion_id = rp.id;
  const { error } = await db.from("products").update({ ...patch, synced_at: stamp }).eq("id", local.id);
  if (error) return { result: "skipped", error: error.message };
  Object.assign(local, patch, { synced_at: stamp });
  idx.byRemoteId.set(rp.id, local);
  return { result: changed ? "updated" : "linked" };
}

/**
 * Sincroniza el catálogo según el modo configurado.
 *
 *   · push / ambos: manda a Facturación los productos de aquí que nunca se han mandado. En modo
 *     solo-push, la completa los manda todos.
 *   · pull / ambos: trae lo que cambió allá desde la última vez (`actualizado_desde`) y lo casa
 *     por id de Facturación, luego por sku (= id de aquí) y al final por nombre; lo que no existe
 *     se crea. La completa lista todo y desactiva aquí lo que ya no exista allá. No borra.
 *
 * `db` es el cliente de quien pidió sincronizar: con el del usuario, RLS decide si puede escribir
 * productos.
 */
export async function syncProducts(db: DB, businessId: string, full: boolean): Promise<SyncResult> {
  const res: SyncResult = { ok: true, pushed: 0, created: 0, updated: 0, deactivated: 0 };
  const cfg = await loadFxConfig(businessId);
  if (!cfg || cfg.sync === "off") return { ...res, ok: false, error: "off" };
  const raw = await getPluginRuntimeConfig(businessId, PLUGIN_ID);
  const biz = await bizTax(db, businessId);
  const { data: localRows, error: localErr } = await db.from("products").select(`${PRODUCT_COLS}, active`).eq("business_id", businessId);
  if (localErr) return { ...res, ok: false, error: "migration" };
  const locals = (localRows ?? []) as unknown as LocalProduct[];
  const now = new Date().toISOString();

  if (pushes(cfg.sync)) {
    // Solo-push: la completa manda todo, porque aquí está la verdad. En los dos sentidos se manda
    // únicamente lo que nunca se ha enlazado: un producto enlazado que ya no existe allá fue
    // borrado allá, y volver a mandarlo lo resucitaría en vez de desactivarlo aquí (abajo).
    const todo = locals.filter((p) => p.active !== false && (!p.facturacion_id || (full && cfg.sync === "push")));
    for (let i = 0; i < todo.length; i += 200) {
      const chunk = todo.slice(i, i + 200);
      let r = await upsertProducts(cfg.apiKey, chunk.map((p) => toRemote(p, biz)));
      // Un id de allá que ya no existe tumba el lote entero: se reintenta casando por sku o nombre.
      if (!r.ok && r.status === 404) r = await upsertProducts(cfg.apiKey, chunk.map((p) => toRemote({ ...p, facturacion_id: null }, biz)));
      if (!r.ok) return { ...res, ok: false, error: r.status === 401 ? "disconnected" : r.error };
      const remote = r.data?.datos ?? [];
      for (let j = 0; j < chunk.length; j++) {
        const rid = remote[j]?.id;
        if (!rid) continue;
        const stamp = remote[j].actualizado || now;
        chunk[j].facturacion_id = rid; chunk[j].synced_at = stamp;
        await db.from("products").update({ facturacion_id: rid, synced_at: stamp }).eq("id", chunk[j].id);
        res.pushed++;
      }
    }
  }

  if (pulls(cfg.sync)) {
    // Se pide desde un minuto antes de lo último visto: un cambio que se confirmó tarde del otro
    // lado puede traer una fecha anterior a la del cursor. Lo repetido se ignora por su fecha.
    const seen = full ? "" : raw?._products_cursor || "";
    const seenMs = seen ? Date.parse(seen) : NaN;
    const cursor = Number.isNaN(seenMs) ? seen : new Date(seenMs - 60_000).toISOString();
    let lost = false; // 401: la llave ya no vale
    const fetchAll = async (desde: string): Promise<FxProduct[] | null> => {
      const out: FxProduct[] = [];
      for (let page = 1; page <= 100; page++) {
        const r = await listProducts(cfg.apiKey, { desde: desde || undefined, pagina: page });
        if (r.status === 401) lost = true;
        if (!r.ok || !r.data) return null;
        out.push(...r.data.datos);
        if (out.length >= r.data.total || r.data.datos.length === 0) break;
      }
      return out;
    };
    let remote = await fetchAll(cursor);
    // La consulta incremental puede no estar disponible del otro lado: se lista todo.
    let listedAll = !cursor;
    if (!remote && cursor && !lost) { remote = await fetchAll(""); listedAll = true; }
    if (!remote) return { ...res, ok: false, error: lost ? "disconnected" : "list" };

    const idx = indexLocals(locals);
    let maxSeen = seen;
    for (const rp of remote) {
      if (rp.actualizado && newer(rp.actualizado, maxSeen)) maxSeen = rp.actualizado;
      const a = await applyRemoteProduct(db, businessId, biz, idx, rp);
      if (a.error) return { ...res, ok: false, error: a.error };
      if (a.result === "created") res.created++;
      else if (a.result === "updated") res.updated++;
    }
    if (full && listedAll) {
      const alive = new Set(remote.map((r) => r.id));
      for (const p of locals) {
        if (p.facturacion_id && !alive.has(p.facturacion_id) && p.active !== false) {
          await db.from("products").update({ active: false }).eq("id", p.id);
          res.deactivated++;
        }
      }
    }
    if (maxSeen) await saveSyncState(businessId, { _products_cursor: maxSeen });
  }

  await saveSyncState(businessId, { _products_synced_at: now });
  return res;
}

/* ---------- productos: avisos de Facturación (webhook) ---------- */

/** `producto.creado` / `producto.actualizado`: se refleja aquí en el momento. Solo si la
 *  sincronización del negocio trae cambios de allá (`pull` o `ambos`). */
export async function onRemoteProductSaved(businessId: string, cfg: FxConfig, rp: FxProduct): Promise<void> {
  if (!pulls(cfg.sync) || !rp?.id || !rp.nombre) return;
  const db = createAdminClient();
  const { data, error } = await db.from("products").select(`${PRODUCT_COLS}, active`).eq("business_id", businessId);
  if (error) return;
  await applyRemoteProduct(db, businessId, await bizTax(db, businessId), indexLocals((data ?? []) as unknown as LocalProduct[]), rp);
}

/** `producto.eliminado`: aquí NO se borra, se desactiva (igual que en la sincronización completa)
 *  y se suelta el enlace. Un borrado más viejo que la versión que tenemos se ignora: el producto
 *  se volvió a crear después. */
export async function onRemoteProductDeleted(businessId: string, cfg: FxConfig, d: { id?: string; sku?: string | null; eliminado?: string }): Promise<void> {
  if (!pulls(cfg.sync) || !d?.id) return;
  const db = createAdminClient();
  const { data } = await db.from("products").select("id, synced_at").eq("business_id", businessId).eq("facturacion_id", d.id).maybeSingle();
  if (!data) return;
  const when = d.eliminado || new Date().toISOString();
  if (!newer(when, data.synced_at as string | null)) return;
  await db.from("products").update({ active: false, facturacion_id: null, synced_at: when }).eq("id", data.id);
}

/* ---------- catálogo: lo que la pantalla necesita ---------- */

export interface CatalogFiscal {
  /** Modo de sincronización configurado en el plugin. */
  mode: SyncMode;
  lastSync: string | null;
  /** Datos fiscales por id de producto. */
  byId: Record<string, { sat_code: string | null; sat_unit: string | null; iva: number | null; linked: boolean }>;
}

/** Claves SAT de los productos y estado de la sincronización, para la pantalla de Catálogo. null
 *  si el plugin no está activo (o 0096 no está aplicada): la pantalla queda como siempre. */
export async function getCatalogFiscal(db: DB, businessId: string): Promise<CatalogFiscal | null> {
  const cfg = await loadFxConfig(businessId);
  if (!cfg) return null;
  const { data, error } = await db.from("products").select("id, sat_code, sat_unit, iva, facturacion_id").eq("business_id", businessId);
  if (error) return null;
  const raw = await getPluginRuntimeConfig(businessId, PLUGIN_ID);
  const byId: CatalogFiscal["byId"] = {};
  for (const p of (data ?? []) as Record<string, unknown>[]) {
    byId[p.id as string] = { sat_code: (p.sat_code as string) || null, sat_unit: (p.sat_unit as string) || null, iva: p.iva == null ? null : Number(p.iva), linked: !!p.facturacion_id };
  }
  return { mode: cfg.sync, lastSync: raw?._products_synced_at || null, byId };
}
