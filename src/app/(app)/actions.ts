"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE, listMyOrgs } from "@/lib/queries";
import { getSessionUser } from "@/lib/auth";
import { encryptBody } from "@/lib/msgcrypto";
import { ensureTag } from "@/lib/tags";
import { markOrderPaid } from "@/lib/payments";
import { flushCloudOutbox } from "@/lib/cloud-outbox";
import { resolveConfirmPaymentStageId } from "@/lib/confirmPaymentStage";

async function actorCtx() {
  const supabase = await createClient();
  const user = await getSessionUser();
  return { supabase, userId: user?.id ?? null };
}

async function orderBusiness(orderId: string): Promise<string | null> {
  const { supabase } = await actorCtx();
  const { data } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  return (data?.business_id as string) ?? null;
}

/** Move an order to a new pipeline stage (Kanban drag / status change). Returns the names of any
 *  flows that fired so the caller can toast "flujo activado", plus `confirmPayment`: true si el
 *  cliente debe preguntar "¿marcar como pagado?" (0075) — llegó a la etapa configurada en Ajustes
 *  y ningún flujo ya decidió el pago por su cuenta. */
export async function moveOrderStage(orderId: string, stageId: string): Promise<{ flows: string[]; confirmPayment: boolean }> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return { flows: [], confirmPayment: false };
  await supabase.from("orders").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "status", text: "Cambio de etapa",
  });
  const { flows, markPaidPref } = await runStageAutomations(orderId, businessId, stageId, userId);
  revalidatePath("/kanban");
  revalidatePath("/orders");
  revalidatePath("/chat");
  revalidatePath("/flows");
  const confirmPayment = await resolveConfirmPayment(supabase, orderId, businessId, stageId, markPaidPref, userId);
  return { flows, confirmPayment };
}

/** 0075: ¿esta etapa es la de "confirmar pago" del negocio, y si sí, quién decide el pago? Si un
 *  flujo apuntado a esta etapa ya trae trigger_config.mark_paid, se aplica aquí mismo (sin
 *  preguntar); si no hay ninguno, el llamador le pregunta al humano que movió el pedido. */
async function resolveConfirmPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, orderId: string, businessId: string, stageId: string, markPaidPref: boolean | null, userId: string | null,
): Promise<boolean> {
  const [{ data: biz }, { data: stages }, { data: order }] = await Promise.all([
    supabase.from("businesses").select("confirm_payment_stage_id, confirm_payment_enabled").eq("id", businessId).maybeSingle(),
    supabase.from("stages").select("id, position").eq("business_id", businessId).order("position", { ascending: true }),
    supabase.from("orders").select("pay_status").eq("id", orderId).maybeSingle(),
  ]);
  if ((order?.pay_status as string) === "paid") return false; // ya está pagado, no hay nada que preguntar
  const resolved = resolveConfirmPaymentStageId((stages ?? []) as { id: string }[], (biz?.confirm_payment_stage_id as string) ?? null);
  if (!resolved || resolved !== stageId) return false;
  if (markPaidPref === true) { await markOrderPaid(supabase, orderId, userId); return false; }
  if (markPaidPref === false) return false; // el flujo decidió que no, tampoco se pregunta
  // Apagado (0076): sin un flujo que ya haya decidido (arriba), no se pregunta nada.
  if (biz?.confirm_payment_enabled === false) return false;
  return true; // nadie lo decidió por adelantado — que conteste quien movió el pedido
}

/** Fire enabled automations triggered by an order reaching a stage. Returns fired flow names plus
 *  `markPaidPref`: la preferencia de "marcar pagado" (0075) del primer flujo que trae esa
 *  etapa como trigger y define trigger_config.mark_paid — null si ninguno lo define. */
export async function runStageAutomations(orderId: string, businessId: string, stageId: string, userId: string | null, sendAfter?: string | null): Promise<{ flows: string[]; markPaidPref: boolean | null }> {
  const supabase = await createClient();
  const fired: string[] = [];
  let markPaidPref: boolean | null = null;
  const { data: autos } = await supabase
    .from("automations").select("id, name, action_type, action_payload, trigger_value, trigger_config, runs")
    .eq("business_id", businessId).eq("enabled", true).eq("trigger_type", "order_stage");

  for (const a of autos ?? []) {
    if (a.trigger_value && a.trigger_value !== stageId) continue;
    const payload = (a.action_payload as { template?: string; area?: string; agent?: string; tag?: string }) ?? {};
    const tconfig = (a.trigger_config as { mark_paid?: boolean }) ?? {};
    if (markPaidPref === null && typeof tconfig.mark_paid === "boolean") markPaidPref = tconfig.mark_paid;

    if (a.action_type === "send_template" && payload.template) {
      const { data: order } = await supabase
        .from("orders").select("code,total,contact_id,conversation_id").eq("id", orderId).maybeSingle();
      if (order?.conversation_id) {
        const { data: contact } = await supabase.from("contacts").select("name").eq("id", order.contact_id).maybeSingle();
        const { data: tpl } = await supabase.from("canned_messages").select("body").eq("business_id", businessId).eq("title", payload.template).maybeSingle();
        if (tpl) {
          const first = (contact?.name ?? "").split(" ")[0];
          const body = String(tpl.body)
            .replace(/\{\{name\}\}/g, first)
            .replace(/\{\{order_number\}\}/g, order.code as string)
            .replace(/\{\{total\}\}/g, String(order.total));
          await supabase.from("messages").insert({
            business_id: businessId, conversation_id: order.conversation_id,
            direction: "out", type: "text", body: encryptBody(businessId, body), author_id: userId, state: "queued",
            // Stagger bulk sends so the worker spaces them out (anti-spam); null = send now.
            next_retry_at: sendAfter ?? null,
          });
          await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
          // Official sessions: send now if due; staggered ones drain on later flushes (webhook ticks).
          if (!sendAfter) await flushCloudOutbox(businessId);
        }
      }
    } else if (a.action_type === "transfer_area" && payload.area) {
      const { data: ar } = await supabase.from("areas").select("route_to").eq("id", payload.area).maybeSingle();
      await supabase.from("orders").update({ area_id: payload.area, assignee_id: (ar?.route_to as string) ?? null }).eq("id", orderId);
      await supabase.from("events").insert({
        business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "swap", text: "Auto: transferido de área",
      });
    } else if (a.action_type === "notify_agent") {
      await supabase.from("events").insert({
        business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "bell", text: "Auto: notificación al agente",
      });
    } else if (a.action_type === "assign_agent" && payload.agent) {
      await supabase.from("orders").update({ assignee_id: payload.agent }).eq("id", orderId);
      await supabase.from("events").insert({
        business_id: businessId, parent_type: "order", parent_id: orderId, actor_id: userId, kind: "swap", text: "Auto: asignado a agente",
      });
    } else if (a.action_type === "add_tag" && payload.tag) {
      const { data: o } = await supabase.from("orders").select("contact_id").eq("id", orderId).maybeSingle();
      if (o?.contact_id) {
        const { data: c } = await supabase.from("contacts").select("tags").eq("id", o.contact_id).maybeSingle();
        const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), payload.tag]));
        await supabase.from("contacts").update({ tags }).eq("id", o.contact_id);
        await ensureTag(supabase, businessId, payload.tag as string);
      }
    }

    await supabase.from("automations").update({ runs: (a.runs ?? 0) + 1 }).eq("id", a.id);
    fired.push((a.name as string) || "Flujo");
  }
  return { flows: fired, markPaidPref };
}

/** Move an order to a different area/department. */
export async function moveOrderArea(orderId: string, areaId: string): Promise<void> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return;
  const { data: area } = await supabase.from("areas").select("route_to, name").eq("id", areaId).maybeSingle();
  await supabase.from("orders")
    .update({ area_id: areaId, assignee_id: (area?.route_to as string) ?? null, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "swap", text: `Movido al área ${(area?.name as string) ?? ""}`.trim(),
  });
  revalidatePath("/kanban");
  revalidatePath("/orders");
}

/**
 * Creates the caller's business with a working default pipeline (no sample data).
 * Used by the first-run onboarding wizard.
 */
export async function createBusiness(name: string, mode: string = "business", extra = false): Promise<void> {
  const supabase = await createClient();
  const personal = mode === "personal";

  // El guarda contra el doble envío se queda, pero deja de significar "una por cuenta".
  //
  // Sigue protegiendo el alta INICIAL: crear no es idempotente —- cada llamada siembra sus etapas,
  // áreas, suscripción y sesión de WhatsApp—, así que un doble clic o un getMyBusiness que falló y
  // devolvió a alguien al asistente no pueden acabar en dos negocios. Lo que ya no hace es impedir
  // una organización ADICIONAL pedida a propósito (`extra`), que es justo lo contrario.
  const user = await getSessionUser();
  if (user && !extra) {
    const { data: existing, error: memErr } = await supabase
      .from("business_members").select("business_id").eq("user_id", user.id).limit(1).maybeSingle();
    if (memErr) throw new Error(`No se pudo verificar tu membresía: ${memErr.message}`);
    if (existing?.business_id) { revalidatePath("/", "layout"); return; }
  }

  const { data: newId, error } = await supabase.rpc("create_business", {
    p_name: name.trim() || (personal ? "Mi espacio" : "Mi negocio"),
    p_vertical: personal ? "personal" : "imprenta",
  });
  if (error) throw new Error(error.message);
  // El id lo DEVUELVE el RPC. Antes se adivinaba con "el negocio más reciente", que con varias
  // organizaciones es una carrera esperando a pasar: dos altas casi simultáneas y configuras la
  // ajena. Ver create_business en 0006_onboarding.sql.
  const businessId = newId as string | null;
  if (businessId) {
    await supabase.from("businesses").update({ mode: personal ? "personal" : "business", object_singular: personal ? "Tarea" : "Pedido", product_stages: personal }).eq("id", businessId);
    if (personal) {
      // Replace the (business) seeded pipeline with task-oriented stages.
      await supabase.from("stages").delete().eq("business_id", businessId);
      const taskStages: [string, string][] = [
        ["Nueva", "slate"], ["Vista", "blue"], ["En proceso", "amber"],
        ["Esperando respuesta", "violet"], ["Resuelta", "teal"], ["Cancelada", "red"], ["Notificada", "green"],
      ];
      await supabase.from("stages").insert(taskStages.map(([name, color], i) => ({ business_id: businessId, name, color, position: i })));
    }
  }
  // La organización recién creada pasa a ser la activa: quien la crea quiere entrar en ella.
  if (businessId) (await cookies()).set(ORG_COOKIE, businessId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/**
 * Cambia de organización activa.
 *
 * Verificar la membresía aquí no es lo que da la seguridad —- eso ya lo hace getMyBusiness, que solo
 * sabe elegir entre las tuyas— pero sí evita dejar una cookie inútil que confunda al depurar.
 */
export async function setActiveOrg(businessId: string): Promise<{ ok: boolean }> {
  const orgs = await listMyOrgs();
  if (!orgs.some((o) => o.id === businessId)) return { ok: false };
  (await cookies()).set(ORG_COOKIE, businessId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // El layout entero se rearma: insignias, riel, realtime y la sección en la que estés.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Para el selector: las organizaciones de la persona, con su rol en cada una. */
export async function myOrgs() {
  return listMyOrgs();
}

/** Marks the one-time onboarding as done (finished or skipped). */
export async function completeOnboarding(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", { p_business: businessId });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
