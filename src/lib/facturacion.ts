import "server-only";

// Cliente de la API pública v1 de Hiraticket Facturación (CFDI 4.0).
// Documentación: https://facturacion.hiraticket.com/docs/api
//
// Cada negocio tiene su propia cuenta allá (su RFC, sus sellos, sus folios) y aquí solo guarda la
// llave de esa cuenta: `hf_live_…` timbra de verdad, `hf_test_…` simula todo sin gastar folios.
// Todo va en español y snake_case, con `precio` SIEMPRE unitario y sin impuestos.
//
// Nunca se registra la llave ni el secreto del webhook: los errores que salen de aquí llevan solo
// el mensaje que la API ya redactó para el usuario.

export const PLUGIN_ID = "hiraticket_facturacion";
export const FACTURACION_SITE = (process.env.FACTURACION_API_BASE || "https://facturacion.hiraticket.com").replace(/\/+$/, "");
const BASE = `${FACTURACION_SITE}/api/v1`;

// Facturación arma las ligas que devuelve (el link para que el cliente se facture, la página
// pública de la factura, la pantalla para autorizar la conexión) con el origen de la petición que
// recibe. Detrás del proxy de su servidor ese origen es interno, y a un cliente le llegó un link
// «http://localhost:10000/f/…». Aquí toda liga interna se cambia por la dirección pública de
// Facturación: al recibirla (respuestas y avisos) y al leer las que ya se guardaron así.
// En una instalación local la dirección de Facturación también es localhost: no se toca nada.
const LOOPBACK = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?=[/?#]|$)/i;
const SITE_IS_LOCAL = LOOPBACK.test(FACTURACION_SITE);
/** Una liga de Facturación con su dirección pública. Lo que no es una liga interna pasa igual. */
export function fxUrl<T extends string | null | undefined>(u: T): T {
  return (typeof u === "string" && !SITE_IS_LOCAL ? u.replace(LOOPBACK, FACTURACION_SITE) : u) as T;
}
/** Lo mismo para todo lo que traiga una respuesta o un aviso, a cualquier profundidad. */
export function fixFxUrls<T>(v: T): T {
  if (SITE_IS_LOCAL || v == null) return v;
  if (typeof v === "string") return fxUrl(v) as T;
  if (Array.isArray(v)) return v.map((x) => fixFxUrls(x)) as T;
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fixFxUrls(x)])) as T;
  return v;
}

/** A dónde apunta este servidor, para decirlo en un mensaje de error (es un dominio público). */
export const FACTURACION_HOST = (() => { try { return new URL(FACTURACION_SITE).host; } catch { return FACTURACION_SITE; } })();

export interface FxResult<T> { ok: boolean; status: number; data?: T; error?: string; code?: string }

/** Por qué una petición no llegó a tener respuesta:
 *  `token`   el token tiene caracteres que no caben en una cabecera HTTP (comillas tipográficas,
 *            puntos suspensivos, un salto de línea): la variable de entorno está mal pegada.
 *  `url`     la dirección base no es una URL válida (falta https://, por ejemplo).
 *  `timeout` no contestó en 20 s.   `red:<código>` falló la conexión (ECONNREFUSED, ENOTFOUND…).  */
function failureKind(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } } | null;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return "timeout";
  const msg = err?.message ?? "";
  if (err?.cause?.code === "ERR_INVALID_URL" || /parse URL|Invalid URL/i.test(msg)) return "url";
  if (/ByteString|invalid header value/i.test(msg)) return "token";
  return err?.cause?.code ? `red:${err.cause.code}` : "red";
}
/** La ruta sin la cadena de consulta (ahí viaja el `estado` de una vinculación). */
const safePath = (url: string) => { try { return new URL(url).pathname; } catch { return "(dirección inválida)"; } };

/** Una petición a Facturación con un token de portador: la llave de API del negocio para la API
 *  v1, o el secreto de integrador para la vinculación. */
async function request<T>(url: string, token: string, method: string, body?: unknown, headers?: Record<string, string>): Promise<FxResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const j = fixFxUrls((await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null);
    // En un error se conserva el cuerpo: algunas respuestas traen datos además del mensaje (el
    // estatus de un código de vinculación vencido, por ejemplo).
    if (!res.ok) return { ok: false, status: res.status, error: j?.error || `HTTP ${res.status}`, code: j?.code, data: (j ?? undefined) as T | undefined };
    return { ok: true, status: res.status, data: (j ?? ({} as T)) as T };
  } catch (e) {
    // Sin respuesta HTTP. No es lo mismo que Facturación esté caída a que este servidor esté mal
    // configurado, y desde la pantalla se veían igual. `code` dice cuál fue; nunca lleva el token.
    const why = failureKind(e);
    console.error(`[facturacion] sin respuesta de ${FACTURACION_HOST} (${method} ${safePath(url)}): ${why}`);
    return { ok: false, status: 0, error: "network", code: why };
  } finally {
    clearTimeout(timer);
  }
}

const call = <T>(apiKey: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
  request<T>(`${BASE}${path}`, apiKey, method, body, headers);

/* ---------- cuenta ---------- */
export interface FxIssuer { id: string; rfc: string; nombre: string; regimen: string; cp: string; csd_vence: string | null; prueba: boolean }
export const listIssuers = (k: string) => call<{ datos: FxIssuer[] }>(k, "GET", "/emisores");

export interface FxFolios { disponibles: number; ambiente: "produccion" | "sandbox"; plan: { nombre?: string; restantes_este_mes?: number } | null }
export const getFolios = (k: string) => call<FxFolios>(k, "GET", "/folios");

/* ---------- conceptos ---------- */
export interface FxConcept {
  descripcion: string; cantidad: number; precio: number; iva: number;
  clave?: string; unidad?: string; descuento?: number; sku?: string;
}

/* ---------- CFDI ---------- */
export interface FxCfdi {
  id: string; uuid: string | null; serie: string | null; folio: number | null; total: number; estatus: string;
  xml: string | null; pdf: string | null; liga_publica: string | null; simulado: boolean; sandbox: boolean;
  reutilizado?: boolean; folios_restantes?: number;
  /** Viene cuando se timbró con `link`: el link quedó facturado con este CFDI. */
  link?: { codigo: string; estatus: string };
}
export interface FxReceiver { rfc: string; nombre?: string; regimen?: string; cp?: string; uso?: string; correo?: string }

/** Timbra una factura. Con `link` (el código de un link de autofactura de la misma venta) el link
 *  queda `facturado` con este CFDI: el cliente ya no puede facturarse otra vez con él ni la venta
 *  entra a la factura global del negocio. Con `link`, `emisor`, `conceptos` y `marca` son
 *  opcionales: lo que no se mande se toma del link. */
export const createCfdi = (k: string, idempotencyKey: string, body: { emisor?: string; receptor: FxReceiver; conceptos?: FxConcept[]; forma_pago: string; metodo_pago?: string; marca?: string; link?: string }) =>
  call<FxCfdi>(k, "POST", "/cfdis", { metodo_pago: "PUE", ...body }, { "Idempotency-Key": idempotencyKey });

export const sendCfdi = (k: string, id: string, correo?: string) =>
  call<unknown>(k, "POST", `/cfdis/${encodeURIComponent(id)}/enviar`, correo ? { correo } : {});

/** PDF timbrado (bytes) para re-hospedarlo en nuestro bucket. null si es simulado o falla. */
export async function fetchCfdiPdf(apiKey: string, id: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${BASE}/cfdis/${encodeURIComponent(id)}/pdf`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("pdf")) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}

/* ---------- links de autofactura ---------- */
export interface FxLink {
  codigo: string; url: string; emisor: string; referencia: string; descripcion: string; total: number;
  /** `cerrado`: el negocio lo cerró sin factura; no se puede autofacturar ni entra a la global. */
  vence: string; estatus: "abierto" | "facturado" | "vencido" | "global" | "cerrado" | string; cfdi_id: string | null; creado: string;
  cfdi?: FxCfdi | null;
}
/** Crea un link de autofactura con `conceptos` (desglosado) o con `total` (un solo concepto por
 *  ese monto con IVA incluido, que timbra exacto). */
export const createLink = (k: string, body: { emisor: string; referencia: string; conceptos?: FxConcept[]; total?: number; descripcion?: string; vence?: string; marca?: string }) =>
  call<FxLink>(k, "POST", "/links", body);
export const getLink = (k: string, codigo: string) => call<FxLink>(k, "GET", `/links/${encodeURIComponent(codigo)}`);
/** Cierra un link sin factura. Idempotente; 409 si ya se facturó o entró a la factura global. */
export const closeLink = (k: string, codigo: string) => call<FxLink>(k, "DELETE", `/links/${encodeURIComponent(codigo)}`);

/* ---------- clientes ---------- */
export const upsertClient = (k: string, c: { rfc: string; nombre: string; regimen: string; cp: string; uso?: string; correo?: string }) =>
  call<unknown>(k, "POST", "/clientes", c);

/* ---------- productos ---------- */
export interface FxProduct {
  id: string; nombre: string; sku: string | null; clave: string; unidad: string; precio: number; iva: number;
  exento: boolean; actualizado: string;
}
export interface FxProductInput { id?: string; sku?: string; nombre: string; precio: number; clave?: string; unidad?: string; iva?: number }

export const listProducts = (k: string, opts: { desde?: string; pagina?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.desde) p.set("actualizado_desde", opts.desde);
  p.set("pagina", String(opts.pagina ?? 1));
  return call<{ datos: FxProduct[]; pagina: number; por_pagina: number; total: number }>(k, "GET", `/productos?${p}`);
};
export const upsertProduct = (k: string, prod: FxProductInput) => call<FxProduct>(k, "POST", "/productos", prod);
export const upsertProducts = (k: string, productos: FxProductInput[]) =>
  call<{ datos: FxProduct[]; creados: number; actualizados: number }>(k, "POST", "/productos", { productos });
export const deleteRemoteProduct = (k: string, id: string) => call<unknown>(k, "DELETE", `/productos/${encodeURIComponent(id)}`);

/* ---------- webhooks ---------- */
/** Los avisos de siempre: facturas y links. */
export const WEBHOOK_EVENTS_BASE = ["link.facturado", "cfdi.timbrado", "cfdi.cancelado"];
/** Avisos del catálogo, para reflejar aquí al momento lo que cambia allá. */
export const WEBHOOK_EVENTS_PRODUCTS = ["producto.creado", "producto.actualizado", "producto.eliminado", "productos.importados"];
export const WEBHOOK_EVENTS = [...WEBHOOK_EVENTS_BASE, ...WEBHOOK_EVENTS_PRODUCTS];
export interface FxWebhook { url: string; eventos: string[]; ultimo_envio: string | null; ultimo_estatus: number | null; ultimo_error: string | null }
export const getWebhook = (k: string) => call<{ webhook: FxWebhook | null }>(k, "GET", "/webhooks");
/** Registra (o cambia) el webhook de la cuenta. Devuelve el secreto, que solo se entrega aquí.
 *  Se pide la lista completa de eventos; un servidor que todavía no conozca los del catálogo
 *  responde 422 y se reintenta con los de siempre. `webhook.eventos` dice cuáles quedaron. */
export async function setWebhook(k: string, url: string, reemplazar: boolean) {
  type R = { webhook: FxWebhook; secreto: string };
  const full = await call<R>(k, "PUT", "/webhooks", { url, eventos: WEBHOOK_EVENTS, reemplazar });
  if (full.ok || full.status !== 422) return full;
  return call<R>(k, "PUT", "/webhooks", { url, eventos: WEBHOOK_EVENTS_BASE, reemplazar });
}
export const deleteWebhook = (k: string) => call<unknown>(k, "DELETE", "/webhooks");

/* ---------- catálogos del SAT ---------- */
export interface SatKey { clave: string; nombre: string }
/** Busca por nombre en el catálogo de claves de producto/servicio o de unidades del SAT (máx. 50).
 *  Con menos de 3 letras responde vacío. */
export const searchSatCatalog = (k: string, kind: "productos" | "unidades", q: string) =>
  call<{ datos: SatKey[] }>(k, "GET", `/catalogos/${kind}?q=${encodeURIComponent(q)}`);

/* ---------- vinculación por código ---------- */
// Conectar la cuenta del negocio sin copiar la llave a mano. Estas llamadas no llevan llave de
// negocio (todavía no existe): las autentica un secreto compartido entre los dos servidores.

const integratorSecret = () => (process.env.FACTURACION_INTEGRATOR_SECRET || "").trim();
/** ¿Este servidor puede vincular por código? Sin el secreto, solo queda la llave manual. */
export const integratorConfigured = () => integratorSecret().length > 0;
const LINK = `${FACTURACION_SITE}/api/vincular`;

/** Lo que Facturación entrega UNA sola vez al autorizar: la llave ya creada y el webhook ya registrado. */
export interface FxLinkResult {
  llave: string; secreto_webhook: string;
  cuenta: { id: string; nombre: string };
  emisor: { rfc: string; nombre: string };
  marca: { id: string; nombre: string } | null;
  eventos: string[];
  folios?: { disponibles?: number; ambiente?: string; plan?: { restantes_este_mes?: number } | null };
}
interface LinkParty { negocio: string; negocio_id: string; solicitante: { nombre: string; correo?: string }; webhook_url: string }

/** Vía A: pide un código para que el dueño lo autorice en Facturación. */
export const linkRequest = (b: LinkParty & { estado: string }) =>
  request<{ codigo: string; url: string; vence: string }>(`${LINK}/solicitar`, integratorSecret(), "POST", { integrador: "hiraticket", eventos: WEBHOOK_EVENTS, ...b });
/** Vía A: ¿ya autorizaron? 202 pendiente · 200 resultado (una vez) · 410 vencido, cancelado o entregado. */
export const linkPoll = (codigo: string, estado: string) =>
  request<FxLinkResult & { estatus?: string }>(`${LINK}/${encodeURIComponent(codigo)}?estado=${encodeURIComponent(estado)}`, integratorSecret(), "GET");
/** Vía B: canjea un código generado en el panel de Facturación. */
export const linkRedeem = (b: LinkParty & { codigo: string }) =>
  request<FxLinkResult>(`${LINK}/canjear`, integratorSecret(), "POST", { integrador: "hiraticket", eventos: WEBHOOK_EVENTS, ...b });
/** Desconectar: revoca la llave vinculada y quita su webhook. 409 si la llave se pegó a mano. */
export const unlinkKey = (k: string) => call<unknown>(k, "DELETE", "/vinculo");
