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

export interface FxResult<T> { ok: boolean; status: number; data?: T; error?: string; code?: string }

async function call<T>(apiKey: string, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<FxResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
    if (!res.ok) return { ok: false, status: res.status, error: j?.error || `HTTP ${res.status}`, code: j?.code };
    return { ok: true, status: res.status, data: (j ?? ({} as T)) as T };
  } catch {
    return { ok: false, status: 0, error: "network", code: "red" };
  } finally {
    clearTimeout(timer);
  }
}

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
}
export interface FxReceiver { rfc: string; nombre?: string; regimen?: string; cp?: string; uso?: string; correo?: string }

export const createCfdi = (k: string, idempotencyKey: string, body: { emisor: string; receptor: FxReceiver; conceptos: FxConcept[]; forma_pago: string; metodo_pago?: string; marca?: string }) =>
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
  vence: string; estatus: "abierto" | "facturado" | "vencido" | "global" | string; cfdi_id: string | null; creado: string;
  cfdi?: FxCfdi;
}
export const createLink = (k: string, body: { emisor: string; referencia: string; conceptos: FxConcept[]; descripcion?: string; vence?: string; marca?: string }) =>
  call<FxLink>(k, "POST", "/links", body);
export const getLink = (k: string, codigo: string) => call<FxLink>(k, "GET", `/links/${encodeURIComponent(codigo)}`);

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
export const WEBHOOK_EVENTS = ["link.facturado", "cfdi.timbrado", "cfdi.cancelado"];
export interface FxWebhook { url: string; eventos: string[]; ultimo_envio: string | null; ultimo_estatus: number | null; ultimo_error: string | null }
export const getWebhook = (k: string) => call<{ webhook: FxWebhook | null }>(k, "GET", "/webhooks");
export const setWebhook = (k: string, url: string, reemplazar: boolean) =>
  call<{ webhook: FxWebhook; secreto: string }>(k, "PUT", "/webhooks", { url, eventos: WEBHOOK_EVENTS, reemplazar });
export const deleteWebhook = (k: string) => call<unknown>(k, "DELETE", "/webhooks");
