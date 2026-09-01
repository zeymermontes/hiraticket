/**
 * Flujos que cuelgan de un PEDIDO: qué hace una automatización cuando se dispara.
 *
 * Existía dos veces el mismo `switch` de acciones —- una en `runStageAutomations` (etapa) y otra en
 * `runConvStatusAutomations` (conversación) —- y el disparador de pagos habría sido la tercera. Los
 * dos lados del pedido viven ahora aquí, en una sola función: si mañana alguien arregla el
 * reemplazo de variables de las plantillas, no puede arreglarlo en un sitio y olvidar el otro.
 * El lado de conversación se queda donde está: es otro padre, otra tabla y otras variables.
 *
 * Recibe el cliente de Supabase en vez de crearlo, y no es un detalle: el webhook de MercadoPago
 * acredita pagos SIN SESIÓN, así que ahí hay que entrar con la llave de servicio. Un runner que
 * llamara a `createClient()` por su cuenta se toparía con RLS y no dispararía nada —- en silencio,
 * que es la peor forma de no funcionar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

import { encryptBody } from "@/lib/msgcrypto";
import { CANNED_COLS, cannedMediaFields, type CannedMessage } from "@/lib/canned";
import { ensureTag } from "@/lib/tags";
import { flushCloudOutbox } from "@/lib/cloud-outbox";

export interface FlowRow {
  id: string;
  name: string | null;
  action_type: string;
  action_payload: unknown;
  trigger_value: string | null;
  trigger_config?: unknown;
  runs: number | null;
}

/**
 * Ejecuta la acción de UNA automatización sobre un pedido.
 *
 * `sendAfter` escalona los envíos masivos (mover 40 pedidos de etapa no puede soltar 40 mensajes
 * de golpe); null = ahora.
 */
export async function runOrderFlowAction(supabase: AnySupabase, opts: {
  automation: FlowRow;
  orderId: string;
  businessId: string;
  userId: string | null;
  sendAfter?: string | null;
}): Promise<void> {
  const { automation: a, orderId, businessId, userId, sendAfter = null } = opts;
  const payload = (a.action_payload as { template?: string; area?: string; agent?: string; tag?: string }) ?? {};

  if (a.action_type === "send_template" && payload.template) {
    const { data: order } = await supabase
      .from("orders").select("code,total,contact_id,conversation_id").eq("id", orderId).maybeSingle();
    if (!order?.conversation_id) return;
    const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
    const { data: tpl } = await supabase.from("canned_messages").select(CANNED_COLS).eq("business_id", businessId).eq("title", payload.template).maybeSingle();
    if (!tpl) return;
    const first = (contact?.name ?? "").split(" ")[0];
    const body = String(tpl.body)
      .replace(/\{\{name\}\}/g, first)
      .replace(/\{\{order_number\}\}/g, order.code as string)
      .replace(/\{\{total\}\}/g, String(order.total));
    // Con archivo, el flujo manda el adjunto y el texto va de pie. Ver `cannedMediaFields`.
    await supabase.from("messages").insert({
      business_id: businessId, conversation_id: order.conversation_id,
      direction: "out", ...cannedMediaFields(tpl as unknown as CannedMessage),
      body: body ? encryptBody(businessId, body) : null, author_id: userId, state: "queued",
      next_retry_at: sendAfter,
    });
    await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
    // Sesiones oficiales: se manda ya si toca; lo escalonado sale en vaciados posteriores.
    if (!sendAfter) await flushCloudOutbox(businessId);
    return;
  }

  if (a.action_type === "transfer_area" && payload.area) {
    const { data: ar } = await supabase.from("areas").select("route_to").eq("id", payload.area).maybeSingle();
    await supabase.from("orders").update({ area_id: payload.area, assignee_id: (ar?.route_to as string) ?? null }).eq("id", orderId);
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "swap", text: "Auto: transferido de área",
    });
    return;
  }

  if (a.action_type === "notify_agent") {
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "bell", text: "Auto: notificación al agente",
    });
    return;
  }

  if (a.action_type === "assign_agent" && payload.agent) {
    await supabase.from("orders").update({ assignee_id: payload.agent }).eq("id", orderId);
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "swap", text: "Auto: asignado a agente",
    });
    return;
  }

  if (a.action_type === "add_tag" && payload.tag) {
    const { data: o } = await supabase.from("orders").select("contact_id").eq("id", orderId).maybeSingle();
    if (!o?.contact_id) return;
    const { data: c } = await supabase.from("contacts").select("tags").eq("id", o.contact_id).maybeSingle();
    const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), payload.tag]));
    await supabase.from("contacts").update({ tags }).eq("id", o.contact_id);
    await ensureTag(supabase, businessId, payload.tag as string);
  }
}

/** Los valores que puede tomar `trigger_value` de un flujo de pago. */
export const PAYMENT_TRIGGER_VALUES = ["any", "anticipo", "settled"] as const;
export type PaymentTriggerValue = (typeof PAYMENT_TRIGGER_VALUES)[number];

/**
 * Dispara los flujos de "se acredita un pago".
 *
 * Se llama desde TODOS los caminos por los que entra dinero —- aprobar un comprobante, registrar un
 * abono a mano, la tarjeta por el webhook y "marcar pagado" —- y no solo desde el botón de aprobar.
 * Un flujo que se dispara con la transferencia pero no con la misma cantidad pagada con tarjeta
 * sería una trampa: quien lo configuró creería que cubre "cuando me paguen".
 *
 * `trigger_value` acota:
 *   · `any`      — cualquier pago que entre.
 *   · `anticipo` — solo cuando se cubre un cobro de tipo anticipo (0089). Es el caso para el que se
 *                  construyeron las órdenes de cobro: "ya dio el anticipo → mándale que arrancamos".
 *   · `settled`  — solo cuando ESE pago deja el pedido saldado.
 *
 * Nunca revienta hacia arriba: un flujo que falla no puede tumbar el registro del dinero, que es
 * lo único aquí que no se puede rehacer.
 */
export async function runPaymentAutomations(supabase: AnySupabase, opts: {
  orderId: string;
  businessId: string;
  userId: string | null;
  /** Concepto del cobro que este pago cubrió, si cubrió alguno. */
  chargeKind?: string | null;
  /** ¿El pedido quedó saldado con este pago? */
  settled: boolean;
}): Promise<string[]> {
  const fired: string[] = [];
  try {
    const { data: autos, error } = await supabase
      .from("automations").select("id, name, action_type, action_payload, trigger_value, trigger_config, runs")
      .eq("business_id", opts.businessId).eq("enabled", true).eq("trigger_type", "payment_approved");
    if (error || !autos?.length) return fired;

    for (const a of autos as FlowRow[]) {
      const want = (a.trigger_value ?? "any") as PaymentTriggerValue;
      if (want === "settled" && !opts.settled) continue;
      if (want === "anticipo" && opts.chargeKind !== "anticipo") continue;

      await runOrderFlowAction(supabase, { automation: a, orderId: opts.orderId, businessId: opts.businessId, userId: opts.userId });
      await supabase.from("automations").update({ runs: (a.runs ?? 0) + 1 }).eq("id", a.id);
      fired.push(a.name || "Flujo");
    }
  } catch {
    // El dinero ya se registró. Un aviso o una etiqueta que no salen se pueden rehacer a mano.
  }
  return fired;
}
