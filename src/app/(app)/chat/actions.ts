"use server";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";

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

export async function sendMessage(convId: string, text: string, replyTo?: string, mentions?: { jid: string; name: string }[]): Promise<void> {
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
    // Group @mentions: worker reads meta.mentions → ContextInfo.MentionedJID; UI renders names.
    meta: mentions && mentions.length ? { mentions } : null,
  });
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

}

/** Start a new 1:1 conversation: find-or-create the contact by phone, ensure an open conversation,
 *  and queue the first outbound message. Returns the conversation id to navigate to. */
export async function startConversation(phone: string, firstMessage: string): Promise<{ ok: boolean; convId?: string; error?: string }> {
  const d = phone.replace(/\D/g, "");
  if (d.length < 8) return { ok: false, error: "invalid-phone" };
  const text = firstMessage.trim();
  if (!text) return { ok: false, error: "empty-message" };
  const { supabase, userId } = await ctx();
  const biz = await getMyBusiness();
  if (!biz) return { ok: false, error: "no-business" };
  const businessId = biz.id;
  const normalized = "+" + d;

  // Find-or-create the contact by phone.
  let { data: contact } = await supabase.from("contacts").select("id").eq("business_id", businessId).eq("phone", normalized).maybeSingle();
  if (!contact) {
    const ins = await supabase.from("contacts").insert({ business_id: businessId, name: normalized, phone: normalized }).select("id").single();
    contact = ins.data;
  }
  if (!contact) return { ok: false, error: "contact" };

  // Reuse an open conversation with this contact if one exists, else create it.
  let { data: conv } = await supabase.from("conversations").select("id").eq("business_id", businessId).eq("contact_id", contact.id).neq("status", "resolved").order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) {
    const ins = await supabase.from("conversations").insert({ business_id: businessId, contact_id: contact.id, status: "open", unread: 0 }).select("id").single();
    conv = ins.data;
  }
  if (!conv) return { ok: false, error: "conversation" };

  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: conv.id, direction: "out", type: "text",
    body: text, author_id: userId, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
  return { ok: true, convId: conv.id };
}

/** Re-queue a failed outbound message so the worker tries to send it again (resets backoff). */
export async function retryMessage(messageId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("messages").update({ state: "queued", send_attempts: 0, next_retry_at: null }).eq("id", messageId).eq("direction", "out").in("state", ["failed", "sending"]);
}

/** Edit an outbound message (worker re-sends an edit to WhatsApp). */
export async function editMessage(messageId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase } = await ctx();
  await supabase.from("messages").update({ body: text, pending_op: "edit" }).eq("id", messageId).eq("direction", "out");
}

/** Add/replace/remove the agent's emoji reaction on a message (worker sends it to WhatsApp). */
export async function reactToMessage(messageId: string, emoji: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: m } = await supabase.from("messages").select("reactions").eq("id", messageId).maybeSingle();
  const cur = (Array.isArray(m?.reactions) ? m!.reactions : []) as { emoji: string; by: string }[];
  const mine = cur.find((r) => r.by === "agent");
  const others = cur.filter((r) => r.by !== "agent");
  const toggleOff = mine?.emoji === emoji;
  const next = toggleOff ? others : [...others, { emoji, by: "agent" }];
  await supabase.from("messages").update({ reactions: next, pending_op: "react", react_emoji: toggleOff ? "" : emoji }).eq("id", messageId);
}

/** Delete an outbound message for everyone (worker revokes it). */
export async function deleteMessage(messageId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("messages").update({ pending_op: "delete" }).eq("id", messageId).eq("direction", "out");
}

/** Forward a message's content into another conversation as a new outbound message. */
export async function forwardMessage(messageId: string, targetConvId: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const { data: m } = await supabase.from("messages").select("type, body, media_url, media_mime, media_name").eq("id", messageId).maybeSingle();
  if (!m) return;
  const businessId = await businessOf(targetConvId);
  if (!businessId) return;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: targetConvId, direction: "out",
    type: m.type, body: m.body, author_id: userId, state: "queued", forwarded: true,
    media_url: m.media_url, media_mime: m.media_mime, media_name: m.media_name,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", targetConvId);
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
}

/** Rename the contact behind a chat. */
export async function renameContact(contactId: string, name: string): Promise<void> {
  const { supabase } = await ctx();
  const clean = name.trim();
  if (!clean) return;
  await supabase.from("contacts").update({ name: clean }).eq("id", contactId);
}

/** Add a tag to a contact (deduplicated). */
export async function addContactTag(contactId: string, tag: string): Promise<void> {
  const clean = tag.trim();
  if (!clean) return;
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", contactId).maybeSingle();
  const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), clean]));
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
}

/** Remove a tag from a contact. */
export async function removeContactTag(contactId: string, tag: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", contactId).maybeSingle();
  const tags = ((c?.tags as string[]) ?? []).filter((t) => t !== tag);
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
}

/** Ask the worker to (re)fetch the contact's WhatsApp name + profile photo. */
export async function requestContactInfo(contactId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("contacts").update({ fetch_requested: new Date().toISOString() }).eq("id", contactId);
}

export async function setConvHidden(convId: string, hidden: boolean): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ hidden }).eq("id", convId);
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
}
