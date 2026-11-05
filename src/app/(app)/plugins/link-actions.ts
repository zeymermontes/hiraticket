"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { PLUGIN_ID as FX, FACTURACION_HOST, integratorConfigured, linkRequest, linkPoll, linkRedeem, type FxLinkResult, type FxResult } from "@/lib/facturacion";
import { syncProducts, fxWebhookUrl, eventsTag } from "@/lib/facturacionOps";

// Conectar el plugin con la cuenta de Hiraticket Facturación del negocio SIN copiar la llave a mano.
//
// Dos caminos, mismo resultado (Facturación crea la llave y registra el webhook en un paso):
//
//   A · El código nace aquí. «Conectar con Facturación» pide un código, abre la pantalla de
//       Facturación donde el dueño entra, elige su RFC y autoriza, y mientras tanto esta app
//       pregunta cada pocos segundos si ya lo hizo.
//   B · El código nace allá. El dueño lo genera en su panel de Facturación y lo escribe aquí (o
//       llega ya escrito en la liga /plugins?facturacion=CODIGO).
//
// SEGURIDAD
//   · Las tres llamadas a Facturación llevan un secreto de integrador que solo conocen los dos
//     servidores (FACTURACION_INTEGRATOR_SECRET). Sin él cualquiera podría pedir un código a nombre
//     de Hiraticket y quedarse con la llave de quien lo autorizara.
//   · Solo un administrador del negocio puede iniciar o terminar una conexión (lo decide RLS: es
//     quien puede escribir business_plugins).
//   · La llave y el secreto del webhook se guardan cifrados y nunca viajan al navegador. El
//     `estado` con el que se consulta el código también se guarda cifrado en el servidor: quien
//     solo vea el código en pantalla no puede cobrar el resultado.

type SB = Awaited<ReturnType<typeof createClient>>;
type Cfg = Record<string, unknown>;

/**
 * Por qué no se pudo hablar con Facturación, dicho de forma que se pueda arreglar. "No se pudo
 * conectar, intenta de nuevo" servía igual para una caída pasajera que para una variable de entorno
 * mal pegada, y lo segundo no se arregla reintentando. Ningún mensaje lleva el secreto.
 */
function linkFailure(r: FxResult<unknown>, fallback: string): string {
  if (r.status === 0) {
    if (r.code === "token") return "El secreto de integrador de este servidor está mal escrito: trae comillas, puntos suspensivos o un salto de línea. Hay que corregir la variable FACTURACION_INTEGRATOR_SECRET en Render (solo el valor, sin comillas) y volver a desplegar.";
    if (r.code === "url") return `La dirección de Facturación configurada en este servidor no es válida (${FACTURACION_HOST}). La variable FACTURACION_API_BASE debe empezar con https:// o no existir.`;
    if (r.code === "timeout") return `Hiraticket Facturación (${FACTURACION_HOST}) tardó demasiado en responder. Intenta de nuevo en un momento.`;
    const net = r.code?.startsWith("red:") ? ` · ${r.code.slice(4)}` : "";
    return `No se pudo conectar con Hiraticket Facturación (${FACTURACION_HOST}${net}). Intenta de nuevo; si sigue igual, revisa que esa dirección sea la correcta.`;
  }
  // Con secreto de integrador, un 401 solo puede ser que los dos servidores no tienen el mismo.
  if (r.status === 401) return "Facturación no reconoció a este servidor: el secreto de integrador no es el mismo en los dos servicios (o trae espacios). Tiene que ser idéntico en FACTURACION_INTEGRATOR_SECRET y en la variable de Facturación.";
  if (r.status === 429) return "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.";
  return r.error || fallback;
}

export interface LinkStatus {
  /** `linked`: quedó conectado. `pending`: falta que autoricen en Facturación. `none`: no hay nada en curso. */
  status: "linked" | "pending" | "none" | "error";
  error?: string;
  /** Vía A en curso: código que el dueño debe ver también en Facturación, y dónde autorizar. */
  code?: string; url?: string; expires?: string;
  /** Al quedar conectado: con qué cuenta y RFC. */
  info?: string;
}

export interface FacturacionState {
  /** El servidor tiene el secreto de integrador: se puede conectar por código. */
  canLink: boolean;
  connected: boolean;
  /** La llave salió de una vinculación (no se pegó a mano). */
  linked: boolean;
  account: string | null;
  emisor: string | null;
  pending: { code: string; url: string; expires: string } | null;
}

/** Lee la config del plugin y comprueba que quien llama puede ESCRIBIRLA (administrador). El
 *  UPDATE de sondeo no cambia nada salvo `updated_at`; con RLS, cero filas = no es administrador. */
async function adminConfig(supabase: SB, businessId: string): Promise<{ cfg: Cfg } | { error: string }> {
  const probe = await supabase.from("business_plugins").update({ updated_at: new Date().toISOString() }, { count: "exact" }).eq("business_id", businessId).eq("plugin_id", FX);
  if (probe.error) return { error: probe.error.message };
  if (!probe.count) return { error: "Solo un administrador puede conectar el plugin, y primero hay que activarlo." };
  const { data } = await supabase.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", FX).maybeSingle();
  return { cfg: ((data?.config as Cfg) ?? {}) };
}

const saveCfg = (supabase: SB, businessId: string, cfg: Cfg) =>
  supabase.from("business_plugins").update({ config: cfg, updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("plugin_id", FX);

/** Facturación exige https en la dirección del webhook siempre. En producción ya lo es; en una
 *  instalación local (http://localhost) se manda la variante https para poder probar la conexión,
 *  aunque ahí los avisos no vayan a llegar. */
const hookUrl = (businessId: string) => fxWebhookUrl(businessId).replace(/^http:\/\//, "https://");

const clearPending = (cfg: Cfg): Cfg => {
  const next = { ...cfg };
  delete next._link_code; delete next._link_state; delete next._link_url; delete next._link_expires;
  return next;
};

async function requester(supabase: SB, businessId: string) {
  const user = await getSessionUser();
  const { data: biz } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const nombre = (meta.full_name || meta.name || user?.email || "Administrador").toString().slice(0, 120);
  return { negocio: ((biz?.name as string) || "Negocio").slice(0, 120), solicitante: { nombre, ...(user?.email ? { correo: user.email } : {}) } };
}

/** Guarda lo que entrega Facturación al conectar: llave y secreto cifrados, RFC, marca y eventos. */
async function applyLink(supabase: SB, businessId: string, cfg: Cfg, r: FxLinkResult): Promise<LinkStatus> {
  const next: Cfg = {
    ...clearPending(cfg),
    api_key: encryptSecret(r.llave),
    emisor: (r.emisor?.rfc || "").toUpperCase(),
    marca: r.marca?.id || "",
    _webhook_secret: encryptSecret(r.secreto_webhook),
    _webhook_events: eventsTag(r.eventos),
    _webhook_checked_at: new Date().toISOString(),
    _linked: "1",
    _link_account: r.cuenta?.nombre || "",
  };
  const { error } = await saveCfg(supabase, businessId, next);
  if (error) return { status: "error", error: error.message };
  // Con la sincronización de productos ya elegida, los dos catálogos arrancan iguales.
  const mode = String(next.sync_productos || "off");
  if (mode !== "off") after(() => syncProducts(createAdminClient(), businessId, true).then(() => undefined, () => undefined));
  revalidatePath("/plugins"); revalidatePath("/catalog");
  const f = r.folios;
  const folios = f ? (f.ambiente === "sandbox" ? " Cuenta de práctica." : ` Folios disponibles: ${Number(f.disponibles ?? 0) + Number(f.plan?.restantes_este_mes ?? 0)}.`) : "";
  return { status: "linked", info: `Conectado con ${r.cuenta?.nombre || "tu cuenta"} · ${r.emisor?.nombre || ""} (${r.emisor?.rfc || ""}).${folios}` };
}

/** Lo que la pantalla necesita saber de la conexión, sin ningún secreto. */
export async function getFacturacionState(businessId: string): Promise<FacturacionState> {
  const supabase = await createClient();
  const { data } = await supabase.from("business_plugins").select("config").eq("business_id", businessId).eq("plugin_id", FX).maybeSingle();
  const cfg = ((data?.config as Cfg) ?? {});
  const live = typeof cfg._link_expires === "string" && Date.parse(cfg._link_expires) > Date.now() && typeof cfg._link_code === "string";
  return {
    canLink: integratorConfigured(),
    connected: typeof cfg.api_key === "string" && cfg.api_key.length > 0,
    linked: cfg._linked === "1",
    account: (cfg._link_account as string) || null,
    emisor: (cfg.emisor as string) || null,
    pending: live ? { code: cfg._link_code as string, url: (cfg._link_url as string) || "", expires: cfg._link_expires as string } : null,
  };
}

/** Vía A, paso 1: pide el código. Devuelve la liga que hay que abrir para autorizar. */
export async function startFacturacionLink(businessId: string): Promise<LinkStatus> {
  if (!integratorConfigured()) return { status: "error", error: "Esta instalación todavía no puede conectarse por código. Usa la llave manual." };
  const supabase = await createClient();
  const a = await adminConfig(supabase, businessId);
  if ("error" in a) return { status: "error", error: a.error };
  const estado = randomBytes(16).toString("hex");
  const who = await requester(supabase, businessId);
  const r = await linkRequest({ negocio: who.negocio, negocio_id: businessId, solicitante: who.solicitante, webhook_url: hookUrl(businessId), estado });
  if (!r.ok || !r.data?.codigo) return { status: "error", error: linkFailure(r, "No se pudo pedir el código.") };
  const { error } = await saveCfg(supabase, businessId, {
    ...a.cfg, _link_code: r.data.codigo, _link_state: encryptSecret(estado), _link_url: r.data.url, _link_expires: r.data.vence,
  });
  if (error) return { status: "error", error: error.message };
  return { status: "pending", code: r.data.codigo, url: r.data.url, expires: r.data.vence };
}

/** Vía A, paso 2: ¿ya autorizaron? El navegador llama aquí cada pocos segundos. El resultado solo
 *  se puede leer una vez, así que se guarda en la misma llamada en que llega. */
export async function pollFacturacionLink(businessId: string): Promise<LinkStatus> {
  const supabase = await createClient();
  const a = await adminConfig(supabase, businessId);
  if ("error" in a) return { status: "error", error: a.error };
  const code = typeof a.cfg._link_code === "string" ? a.cfg._link_code : "";
  const estado = typeof a.cfg._link_state === "string" ? decryptSecret(a.cfg._link_state) : "";
  if (!code || !estado) return { status: "none" };
  const r = await linkPoll(code, estado);
  if (r.status === 202) return { status: "pending", code, url: (a.cfg._link_url as string) || "", expires: (a.cfg._link_expires as string) || "" };
  if (r.ok && r.data?.llave) return applyLink(supabase, businessId, a.cfg, r.data);
  // Sin respuesta o error pasajero: el código sigue vivo, se vuelve a preguntar.
  if (r.status === 0 || r.status >= 500 || r.status === 429) return { status: "pending", code, url: (a.cfg._link_url as string) || "", expires: (a.cfg._link_expires as string) || "" };
  // Venció, lo cancelaron allá o el estado no coincide: el código ya no sirve.
  await saveCfg(supabase, businessId, clearPending(a.cfg));
  const st = (r.data as { estatus?: string } | undefined)?.estatus;
  return { status: "error", error: st === "cancelado" ? "La conexión se canceló en Facturación." : st === "entregado" ? "Ese código ya se usó. Pide uno nuevo." : "El código venció. Pide uno nuevo." };
}

/** Deja de esperar un código de la vía A (el dueño cerró la ventana o se arrepintió). */
export async function cancelFacturacionLink(businessId: string): Promise<void> {
  const supabase = await createClient();
  const a = await adminConfig(supabase, businessId);
  if ("error" in a) return;
  await saveCfg(supabase, businessId, clearPending(a.cfg));
}

/** Vía B: canjea el código que el dueño generó en su panel de Facturación. */
export async function redeemFacturacionCode(businessId: string, codeRaw: string): Promise<LinkStatus> {
  if (!integratorConfigured()) return { status: "error", error: "Esta instalación todavía no puede conectarse por código. Usa la llave manual." };
  const code = codeRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) return { status: "error", error: "El código tiene 8 caracteres, como K7P2-M4XQ." };
  const supabase = await createClient();
  const a = await adminConfig(supabase, businessId);
  if ("error" in a) return { status: "error", error: a.error };
  const who = await requester(supabase, businessId);
  const r = await linkRedeem({ codigo: code, negocio: who.negocio, negocio_id: businessId, solicitante: who.solicitante, webhook_url: hookUrl(businessId) });
  if (r.ok && r.data?.llave) return applyLink(supabase, businessId, a.cfg, r.data);
  return {
    status: "error",
    error: r.status === 404 ? "Ese código no existe. Revisa que esté bien escrito."
      : r.status === 410 ? "Ese código venció o ya se usó. Genera uno nuevo en Facturación."
      : linkFailure(r, "No se pudo canjear el código."),
  };
}
