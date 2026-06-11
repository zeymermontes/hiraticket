"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function actorCtx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

async function orderBusiness(orderId: string): Promise<string | null> {
  const { supabase } = await actorCtx();
  const { data } = await supabase.from("orders").select("business_id").eq("id", orderId).maybeSingle();
  return (data?.business_id as string) ?? null;
}

/** Move an order to a new pipeline stage (Kanban drag / status change). */
export async function moveOrderStage(orderId: string, stageId: string): Promise<void> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return;
  await supabase.from("orders").update({ stage_id: stageId, updated_at: new Date().toISOString() }).eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "status", text: "Cambio de etapa",
  });
  await runStageAutomations(orderId, businessId, stageId, userId);
  revalidatePath("/kanban");
  revalidatePath("/orders");
  revalidatePath("/chat");
  revalidatePath("/flows");
}

/** Fire enabled automations triggered by an order reaching a stage. */
async function runStageAutomations(orderId: string, businessId: string, stageId: string, userId: string | null) {
  const supabase = await createClient();
  const { data: autos } = await supabase
    .from("automations").select("id, action_type, action_payload, trigger_value, runs")
    .eq("business_id", businessId).eq("enabled", true).eq("trigger_type", "order_stage");

  for (const a of autos ?? []) {
    if (a.trigger_value && a.trigger_value !== stageId) continue;
    const payload = (a.action_payload as { template?: string; area?: string; agent?: string; tag?: string }) ?? {};

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
            direction: "out", type: "text", body, author_id: userId, state: "queued",
          });
          await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", order.conversation_id);
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
      }
    }

    await supabase.from("automations").update({ runs: (a.runs ?? 0) + 1 }).eq("id", a.id);
  }
}

/** Move an order to a different area/department. */
export async function moveOrderArea(orderId: string, areaId: string): Promise<void> {
  const { supabase, userId } = await actorCtx();
  const businessId = await orderBusiness(orderId);
  if (!businessId) return;
  const { data: area } = await supabase.from("areas").select("route_to").eq("id", areaId).maybeSingle();
  await supabase.from("orders")
    .update({ area_id: areaId, assignee_id: (area?.route_to as string) ?? null, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "order", parent_id: orderId,
    actor_id: userId, kind: "swap", text: "Movido de área",
  });
  revalidatePath("/kanban");
  revalidatePath("/orders");
}

/**
 * Creates the caller's business with a working default pipeline (no sample data).
 * Used by the first-run onboarding wizard.
 */
export async function createBusiness(name: string, mode: string = "business"): Promise<void> {
  const supabase = await createClient();
  const personal = mode === "personal";
  const { error } = await supabase.rpc("create_business", {
    p_name: name.trim() || (personal ? "Mi espacio" : "Mi negocio"),
    p_vertical: personal ? "personal" : "imprenta",
  });
  if (error) throw new Error(error.message);
  // Set the workspace mode + default noun (orders→"Pedido" / tasks→"Tarea") on the new business.
  const { data: biz } = await supabase.from("businesses").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (biz) {
    const businessId = biz.id as string;
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
  revalidatePath("/", "layout");
}

/** Marks the one-time onboarding as done (finished or skipped). */
export async function completeOnboarding(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding", { p_business: businessId });
  if (error) throw new Error(error.message);
  revalidatePath("/", "layout");
}
