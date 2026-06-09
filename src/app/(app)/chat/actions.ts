"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

async function businessOf(convId: string): Promise<string | null> {
  const { supabase } = await ctx();
  const { data } = await supabase
    .from("conversations")
    .select("business_id")
    .eq("id", convId)
    .maybeSingle();
  return (data?.business_id as string) ?? null;
}

export async function sendMessage(convId: string, text: string, replyTo?: string): Promise<void> {
  const body = text.trim();
  if (!body) return;
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  await supabase.from("messages").insert({
    business_id: businessId,
    conversation_id: convId,
    direction: "out",
    type: "text",
    body,
    author_id: userId,
    // 'queued' → the WhatsApp worker picks it up and sends it, then flips to 'sent'.
    state: "queued",
    reply_to: replyTo ?? null,
  });
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

  revalidatePath("/chat");
}

/** Edit an outbound message (worker re-sends an edit to WhatsApp). */
export async function editMessage(messageId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase } = await ctx();
  await supabase.from("messages").update({ body: text, pending_op: "edit" }).eq("id", messageId).eq("direction", "out");
  revalidatePath("/chat");
}

/** Delete an outbound message for everyone (worker revokes it). */
export async function deleteMessage(messageId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("messages").update({ pending_op: "delete" }).eq("id", messageId).eq("direction", "out");
  revalidatePath("/chat");
}

/** Queue an outbound media message (file already uploaded to storage). */
export async function sendMediaMessage(
  convId: string,
  input: { type: string; mediaUrl: string; mime: string; name?: string; caption?: string },
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: convId, direction: "out",
    type: input.type, body: input.caption || null, author_id: userId, state: "queued",
    media_url: input.mediaUrl, media_mime: input.mime, media_name: input.name || null,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  revalidatePath("/chat");
}

export async function setConvStatus(
  convId: string,
  status: "open" | "pending" | "resolved",
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  await supabase
    .from("conversations")
    .update({ status, unread: status === "resolved" ? 0 : undefined })
    .eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: status === "resolved" ? "check" : "status",
    text: `Estado → ${status}`,
  });
  await runConvStatusAutomations(convId, businessId, status, userId);
  revalidatePath("/chat");
  revalidatePath("/flows");
}

/** Fire enabled automations triggered by a conversation reaching a status. */
async function runConvStatusAutomations(convId: string, businessId: string, status: string, userId: string | null) {
  const supabase = await createClient();
  const { data: autos } = await supabase
    .from("automations").select("id, action_type, action_payload, trigger_value, runs")
    .eq("business_id", businessId).eq("enabled", true).eq("trigger_type", "conversation_status");

  for (const a of autos ?? []) {
    if (a.trigger_value && a.trigger_value !== status) continue;
    const payload = (a.action_payload as { template?: string; area?: string; agent?: string; tag?: string }) ?? {};

    if (a.action_type === "send_template" && payload.template) {
      const { data: conv } = await supabase.from("conversations").select("contact:contacts(name)").eq("id", convId).maybeSingle();
      const { data: tpl } = await supabase.from("canned_messages").select("body").eq("business_id", businessId).eq("title", payload.template).maybeSingle();
      if (tpl) {
        const first = (((conv?.contact as { name?: string } | null)?.name) ?? "").split(" ")[0];
        const body = String(tpl.body).replace(/\{\{name\}\}/g, first).replace(/\{\{order_number\}\}/g, "").replace(/\{\{total\}\}/g, "");
        await supabase.from("messages").insert({ business_id: businessId, conversation_id: convId, direction: "out", type: "text", body, author_id: userId, state: "queued" });
        await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
      }
    } else if (a.action_type === "transfer_area" && payload.area) {
      const { data: ar } = await supabase.from("areas").select("route_to").eq("id", payload.area).maybeSingle();
      await supabase.from("conversations").update({ area_id: payload.area, assignee_id: (ar?.route_to as string) ?? null }).eq("id", convId);
      await supabase.from("events").insert({ business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "swap", text: "Auto: transferido de área" });
    } else if (a.action_type === "notify_agent") {
      await supabase.from("events").insert({ business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "bell", text: "Auto: notificación al agente" });
    } else if (a.action_type === "assign_agent" && payload.agent) {
      await supabase.from("conversations").update({ assignee_id: payload.agent }).eq("id", convId);
      await supabase.from("events").insert({ business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "swap", text: "Auto: asignado a agente" });
    } else if (a.action_type === "add_tag" && payload.tag) {
      const { data: conv } = await supabase.from("conversations").select("contact_id").eq("id", convId).maybeSingle();
      if (conv?.contact_id) {
        const { data: c } = await supabase.from("contacts").select("tags").eq("id", conv.contact_id).maybeSingle();
        const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), payload.tag]));
        await supabase.from("contacts").update({ tags }).eq("id", conv.contact_id);
      }
    }
    await supabase.from("automations").update({ runs: (a.runs ?? 0) + 1 }).eq("id", a.id);
  }
}

/** Mark a conversation read (reset unread) when it's opened. */
export async function markConvRead(convId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ unread: 0 }).eq("id", convId);
  revalidatePath("/chat");
}

export async function acceptConv(convId: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("conversations").update({ assignee_id: userId }).eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: "user",
    text: "Aceptado",
  });
  revalidatePath("/chat");
}

export async function addConvNote(convId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("notes").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    author_id: userId,
    body: text,
  });
  revalidatePath("/chat");
}

/** Permanently delete a conversation and its messages (FK cascade). */
export async function deleteConv(convId: string): Promise<void> {
  const { supabase } = await ctx();
  const businessId = await businessOf(convId);
  if (businessId) {
    await supabase.from("notes").delete().eq("parent_type", "conversation").eq("parent_id", convId);
    await supabase.from("events").delete().eq("parent_type", "conversation").eq("parent_id", convId);
  }
  await supabase.from("conversations").delete().eq("id", convId);
  revalidatePath("/chat");
}

/** Rename the contact behind a chat. */
export async function renameContact(contactId: string, name: string): Promise<void> {
  const { supabase } = await ctx();
  const clean = name.trim();
  if (!clean) return;
  await supabase.from("contacts").update({ name: clean }).eq("id", contactId);
  revalidatePath("/chat");
}

/** Add a tag to a contact (deduplicated). */
export async function addContactTag(contactId: string, tag: string): Promise<void> {
  const clean = tag.trim();
  if (!clean) return;
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", contactId).maybeSingle();
  const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), clean]));
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
  revalidatePath("/chat");
}

/** Remove a tag from a contact. */
export async function removeContactTag(contactId: string, tag: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", contactId).maybeSingle();
  const tags = ((c?.tags as string[]) ?? []).filter((t) => t !== tag);
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
  revalidatePath("/chat");
  revalidatePath("/orders");
}

/** Ask the worker to (re)fetch the contact's WhatsApp name + profile photo. */
export async function requestContactInfo(contactId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("contacts").update({ fetch_requested: new Date().toISOString() }).eq("id", contactId);
  revalidatePath("/chat");
}

export async function setConvHidden(convId: string, hidden: boolean): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ hidden }).eq("id", convId);
  revalidatePath("/chat");
}

/** Snooze (postpone) a conversation until `untilISO`, or pass null to un-snooze. */
export async function snoozeConv(convId: string, untilISO: string | null): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  await supabase.from("conversations").update({ snoozed_until: untilISO }).eq("id", convId);
  if (businessId) {
    await supabase.from("events").insert({
      business_id: businessId, parent_type: "conversation", parent_id: convId,
      actor_id: userId, kind: "clock",
      text: untilISO ? "Pospuesto" : "Reactivado",
    });
  }
  revalidatePath("/chat");
}

export async function transferConv(
  convId: string,
  mode: "agent" | "area",
  destId: string,
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  if (mode === "agent") {
    await supabase.from("conversations").update({ assignee_id: destId }).eq("id", convId);
  } else {
    // Route to the area's default agent, if set.
    const { data: area } = await supabase
      .from("areas").select("route_to").eq("id", destId).maybeSingle();
    await supabase
      .from("conversations")
      .update({ area_id: destId, assignee_id: (area?.route_to as string) ?? null })
      .eq("id", convId);
  }
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: "swap",
    text: "Transferido",
  });
  revalidatePath("/chat");
}
