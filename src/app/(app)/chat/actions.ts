"use server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyBusiness } from "@/lib/queries";
import { getConversationDetail, type ConvDetail } from "@/lib/chat";
import { encryptBody, decryptBody } from "@/lib/msgcrypto";
import { ownsMediaPath, STICKER_MIME } from "@/lib/stickers";
import { ensureTag } from "@/lib/tags";
import { flushCloudOutbox, sendCloudReactionFor } from "@/lib/cloud-outbox";
import { officialSessionOf } from "@/lib/cloud-session";
import { listTemplates } from "@/lib/whatsapp-cloud";
import { VAR_RE } from "@/lib/template-rules";
import { CANNED_COLS, cannedMediaFields, type CannedMessage } from "@/lib/canned";
import { pushTransfer } from "@/lib/push";

/** Load a single conversation's full detail (for the order drawer's embedded chat). */
export async function loadConvDetail(convId: string): Promise<ConvDetail | null> {
  return getConversationDetail(convId);
}

/** Decrypted, truncated body for a toast preview. Realtime payloads carry the STORED (possibly
 *  encrypted) body, so the notifier calls this instead of reading the payload. RLS-scoped. */
export async function getToastPreview(kind: "wa" | "internal", id: string): Promise<string> {
  const { supabase } = await ctx();
  const table = kind === "internal" ? "internal_messages" : "messages";
  const { data } = await supabase.from(table).select("business_id, body").eq("id", id).maybeSingle();
  if (!data) return "";
  return decryptBody(data.business_id as string, (data.body as string) ?? "").slice(0, 90);
}

async function ctx() {
  const supabase = await createClient();
  const user = await getSessionUser();
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
    body: encryptBody(businessId, body),
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
  await flushCloudOutbox(businessId); // official sessions send here; whatsmeow ignores it
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

  // Threads belong to the connected business number (0078): reuse only this number's conversation
  // (or an unclaimed legacy one), and stamp whatever we end up using.
  const { data: sess } = await supabase.from("whatsapp_sessions").select("phone").eq("business_id", businessId).eq("status", "connected").not("phone", "is", null).limit(1).maybeSingle();
  const numberPhone = (sess?.phone as string) ?? null;

  // Reuse an open conversation with this contact if one exists, else create it.
  let convQuery = supabase.from("conversations").select("id").eq("business_id", businessId).eq("contact_id", contact.id).neq("status", "resolved");
  if (numberPhone) convQuery = convQuery.or(`number_phone.is.null,number_phone.eq.${numberPhone}`);
  let { data: conv } = await convQuery.order("last_message_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) {
    const ins = await supabase.from("conversations").insert({ business_id: businessId, contact_id: contact.id, status: "open", unread: 0, number_phone: numberPhone }).select("id").single();
    conv = ins.data;
  } else if (numberPhone) {
    await supabase.from("conversations").update({ number_phone: numberPhone }).eq("id", conv.id).is("number_phone", null);
  }
  if (!conv) return { ok: false, error: "conversation" };

  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: conv.id, direction: "out", type: "text",
    body: encryptBody(businessId, text), author_id: userId, state: "queued",
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
  await flushCloudOutbox(businessId);
  return { ok: true, convId: conv.id };
}

/** Empty the chat "trash": permanently delete conversations with no activity in 90+ days, plus their
 *  messages (FK cascade) and conversation notes/events — to free DB space. The CONTACT is kept on
 *  purpose, so if they message again we still have their info. */
export async function emptyChatTrash(businessId: string): Promise<{ deleted: number }> {
  const { supabase } = await ctx();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: convs } = await supabase.from("conversations").select("id").eq("business_id", businessId).lt("last_message_at", cutoff);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (!ids.length) return { deleted: 0 };
  // notes/events use a generic parent_id (no FK cascade) → clear them explicitly. Best-effort.
  await supabase.from("notes").delete().eq("parent_type", "conversation").in("parent_id", ids);
  await supabase.from("events").delete().eq("parent_type", "conversation").in("parent_id", ids);
  // Deleting the conversations cascades their messages (messages.conversation_id ON DELETE CASCADE).
  // Contacts are intentionally NOT touched.
  await supabase.from("conversations").delete().in("id", ids);
  return { deleted: ids.length };
}

export interface WaTemplateOption {
  name: string;
  language: string;
  body: string;
  header: string | null;
  footer: string | null;
  varCount: number;
}

/** Approved Meta templates of this business's official WABA — for the closed-24h-window composer.
 *  Empty for whatsmeow businesses (they have no window and no WABA). */
export async function getWaTemplates(): Promise<WaTemplateOption[]> {
  const biz = await getMyBusiness();
  if (!biz) return [];
  const session = await officialSessionOf(biz.id);
  if (!session) return [];
  const res = await listTemplates(session.wabaId, session.token);
  if (!res.ok) return [];
  return res.data.data
    .filter((t) => t.status === "APPROVED")
    .map((t) => {
      const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
      const header = t.components?.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT")?.text ?? null;
      const footer = t.components?.find((c) => c.type === "FOOTER")?.text ?? null;
      const vars = new Set(Array.from(body.matchAll(VAR_RE)).map((m) => Number(m[1])));
      return { name: t.name, language: t.language, body, header, footer, varCount: vars.size };
    })
    .filter((t) => t.body);
}

/** Send an approved template into the conversation (the only way to reach a customer once the 24h
 *  window closed). Stores the rendered text for display; cloud-outbox sends the real template. */
export async function sendWaTemplate(
  convId: string,
  tpl: { name: string; language: string; body: string },
  params: string[],
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return { ok: false, error: "conversation" };
  const session = await officialSessionOf(businessId);
  if (!session) return { ok: false, error: "no-official-session" };

  const rendered = tpl.body.replace(VAR_RE, (_, n) => params[Number(n) - 1] ?? "");
  const { error } = await supabase.from("messages").insert({
    business_id: businessId,
    conversation_id: convId,
    direction: "out",
    type: "text",
    body: encryptBody(businessId, rendered),
    author_id: userId,
    state: "queued",
    meta: { template: { name: tpl.name, lang: tpl.language, params } },
  });
  if (error) return { ok: false, error: error.message };
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  await flushCloudOutbox(businessId);
  return { ok: true };
}

/** Re-queue a failed outbound message so the worker tries to send it again (resets backoff). */
export async function retryMessage(messageId: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: m } = await supabase.from("messages").select("business_id").eq("id", messageId).maybeSingle();
  await supabase.from("messages").update({ state: "queued", send_attempts: 0, next_retry_at: null }).eq("id", messageId).eq("direction", "out").in("state", ["failed", "sending"]);
  if (m?.business_id) await flushCloudOutbox(m.business_id as string);
}

/** Edit an outbound message (worker re-sends an edit to WhatsApp). */
export async function editMessage(messageId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase } = await ctx();
  const { data: m } = await supabase.from("messages").select("business_id").eq("id", messageId).maybeSingle();
  if (!m) return;
  await supabase.from("messages").update({ body: encryptBody(m.business_id as string, text), pending_op: "edit" }).eq("id", messageId).eq("direction", "out");
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
  // Official sessions have no worker: send the reaction through the Cloud API right away.
  await sendCloudReactionFor(messageId, toggleOff ? "" : emoji);
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
    // body copied verbatim: if encrypted, the target conv is the same business → same tenant key.
    type: m.type, body: m.body, author_id: userId, state: "queued", forwarded: true,
    media_url: m.media_url, media_mime: m.media_mime, media_name: m.media_name,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", targetConvId);
  await flushCloudOutbox(businessId);
}

/** Send a sticker the business already has (picked from the tray): reuse the stored WebP path so the
 *  worker re-sends it as a real sticker — no re-upload needed. `path` identifies it (0070), so a
 *  sticker that only ever existed in an internal chat can be sent to a customer too. */
export async function sendSticker(convId: string, path: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId || !ownsMediaPath(businessId, path)) return;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: convId, direction: "out",
    type: "sticker", author_id: userId, state: "queued",
    media_url: path, media_mime: STICKER_MIME,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  await flushCloudOutbox(businessId);
}

/** Save a sticker to favorites with an optional name + tags (or update those if already saved).
 *  Keyed by the stored file (0070) so stickers from internal chats también se pueden guardar. */
export async function saveStickerFavorite(path: string, name: string, tags: string[]): Promise<void> {
  const { supabase, userId } = await ctx();
  const business = await getMyBusiness();
  if (!business || !ownsMediaPath(business.id, path)) return;
  const meta = { name: name.trim() || null, tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean) };
  // Por usuario (0069): antes la unicidad era (negocio, sticker) y el favorito de uno era el de
  // todos — marcarlo o quitarlo se lo cambiaba al resto del equipo.
  const { data: existing } = await supabase.from("sticker_favorites").select("id").eq("business_id", business.id).eq("media_url", path).eq("created_by", userId ?? "").maybeSingle();
  if (existing) {
    const { error } = await supabase.from("sticker_favorites").update(meta).eq("id", existing.id);
    if (error) await supabase.from("sticker_favorites").update({}).eq("id", existing.id); // name/tags (0034) not applied
  } else {
    const base = { business_id: business.id, media_url: path, created_by: userId };
    const { error } = await supabase.from("sticker_favorites").insert({ ...base, ...meta });
    if (error) await supabase.from("sticker_favorites").insert(base); // name/tags (0034) not applied
  }
}

/** Remove a sticker from favorites (keyed by its stored WebP). */
export async function removeStickerFavorite(path: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const business = await getMyBusiness();
  if (!business || !ownsMediaPath(business.id, path)) return;
  // Solo el mío: quitarlo de mi bandeja no debe borrarlo de la de mis compañeros.
  await supabase.from("sticker_favorites").delete().eq("business_id", business.id).eq("media_url", path).eq("created_by", userId ?? "");
}

/** Queue an outbound media message (file already uploaded to storage). */
export async function sendMediaMessage(
  convId: string,
  // `thumb` y `size` los calcula el navegador al subir (ver `@/lib/imageThumb`): es el único lugar
  // donde el archivo está a mano sin volver a bajarlo. Sin la miniatura, la burbuja no tiene nada
  // que pintar y termina cargando el original completo.
  input: { type: string; mediaUrl: string; mime: string; name?: string; caption?: string; thumb?: string; size?: number },
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("messages").insert({
    business_id: businessId, conversation_id: convId, direction: "out",
    type: input.type, body: input.caption ? encryptBody(businessId, input.caption) : null, author_id: userId, state: "queued",
    media_url: input.mediaUrl, media_mime: input.mime, media_name: input.name || null,
    media_size: input.size ?? null,
    meta: input.thumb ? { thumb: input.thumb } : null,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
  await flushCloudOutbox(businessId);
}

async function setConvStatusImpl(
  convId: string,
  status: "open" | "pending" | "resolved",
): Promise<{ flows: string[] }> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return { flows: [] };

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
  const flows = await runConvStatusAutomations(convId, businessId, status, userId);
  return { flows };
}

/** Fire enabled automations triggered by a conversation reaching a status. Returns fired flow names. */
async function runConvStatusAutomations(convId: string, businessId: string, status: string, userId: string | null): Promise<string[]> {
  const supabase = await createClient();
  const fired: string[] = [];
  const { data: autos } = await supabase
    .from("automations").select("id, name, action_type, action_payload, trigger_value, runs")
    .eq("business_id", businessId).eq("enabled", true).eq("trigger_type", "conversation_status");

  // A pinned conversation ("mantener conmigo") is never auto-reassigned by flows.
  const { data: lockRow } = await supabase.from("conversations").select("locked_to").eq("id", convId).maybeSingle();
  const locked = !!(lockRow as { locked_to?: string | null } | null)?.locked_to;

  for (const a of autos ?? []) {
    if (a.trigger_value && a.trigger_value !== status) continue;
    // Skip auto-reassignment on a pinned conversation (don't count it as a run either).
    if (locked && (a.action_type === "assign_agent" || a.action_type === "transfer_area")) continue;
    const payload = (a.action_payload as { template?: string; area?: string; agent?: string; tag?: string }) ?? {};

    if (a.action_type === "send_template" && payload.template) {
      const { data: conv } = await supabase.from("conversations").select("contact:contacts(name)").eq("id", convId).maybeSingle();
      const { data: tpl } = await supabase.from("canned_messages").select(CANNED_COLS).eq("business_id", businessId).eq("title", payload.template).maybeSingle();
      if (tpl) {
        const first = (((conv?.contact as { name?: string } | null)?.name) ?? "").split(" ")[0];
        const body = String(tpl.body).replace(/\{\{name\}\}/g, first).replace(/\{\{order_number\}\}/g, "").replace(/\{\{total\}\}/g, "");
        // Si la plantilla lleva archivo, el flujo manda el archivo con el texto de pie —- lo mismo
        // que sale al elegirla a mano en el chat. Antes solo salía el texto.
        await supabase.from("messages").insert({
          business_id: businessId, conversation_id: convId, direction: "out",
          ...cannedMediaFields(tpl as unknown as CannedMessage),
          body: body ? encryptBody(businessId, body) : null, author_id: userId, state: "queued",
        });
        await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);
        await flushCloudOutbox(businessId);
      }
    } else if (a.action_type === "transfer_area" && payload.area) {
      const { data: ar } = await supabase.from("areas").select("route_to, name").eq("id", payload.area).maybeSingle();
      const routed = (ar?.route_to as string) ?? null;
      await supabase.from("conversations").update({ area_id: payload.area, assignee_id: routed }).eq("id", convId);
      // Con `target_id` el evento dice a QUIÉN le tocó, y eso es lo que enciende tanto el aviso en
      // vivo como el push. Sin él, un flujo podía dejarte un chat encima sin que nada te lo dijera.
      const row = { business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "swap", text: "Auto: transferido de área" };
      const { error: e1 } = await supabase.from("events").insert({ ...row, target_id: routed });
      if (e1) await supabase.from("events").insert(row); // 0068 sin aplicar
      await pushTransfer({ businessId, actorId: userId, targetId: routed, conversationIds: [convId], areaName: ((ar?.name as string) ?? "").trim() || null });
    } else if (a.action_type === "notify_agent") {
      await supabase.from("events").insert({ business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "bell", text: "Auto: notificación al agente" });
    } else if (a.action_type === "assign_agent" && payload.agent) {
      await supabase.from("conversations").update({ assignee_id: payload.agent }).eq("id", convId);
      const row = { business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "swap", text: "Auto: asignado a agente" };
      const { error: e2 } = await supabase.from("events").insert({ ...row, target_id: payload.agent });
      if (e2) await supabase.from("events").insert(row); // 0068 sin aplicar
      await pushTransfer({ businessId, actorId: userId, targetId: payload.agent, conversationIds: [convId] });
    } else if (a.action_type === "add_tag" && payload.tag) {
      const { data: conv } = await supabase.from("conversations").select("contact_id").eq("id", convId).maybeSingle();
      if (conv?.contact_id) {
        const { data: c } = await supabase.from("contacts").select("tags").eq("id", conv.contact_id).maybeSingle();
        const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), payload.tag]));
        await supabase.from("contacts").update({ tags }).eq("id", conv.contact_id);
        await ensureTag(supabase, businessId, payload.tag as string);
      }
    }
    await supabase.from("automations").update({ runs: (a.runs ?? 0) + 1 }).eq("id", a.id);
    fired.push((a.name as string) || "Flujo");
  }
  return fired;
}

/** Mark a conversation read (reset unread) when it's opened. */
export async function markConvRead(convId: string): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ unread: 0 }).eq("id", convId);
}

async function acceptConvImpl(convId: string): Promise<void> {
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

/** "Mantener conmigo": pin the conversation to the current agent. It stays assigned to them
 *  through status changes / reopens and is skipped by auto-assign & area-routing flows. */
export async function lockConvToMe(convId: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId || !userId) return;
  await supabase.from("conversations").update({ locked_to: userId, assignee_id: userId }).eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "conversation", parent_id: convId,
    actor_id: userId, kind: "lock", text: "Cliente mantenido con el agente",
  });
}

/** "Soltar cliente": release the pin so the conversation can be reassigned again. */
export async function unlockConv(convId: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("conversations").update({ locked_to: null }).eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId, parent_type: "conversation", parent_id: convId,
    actor_id: userId, kind: "lock", text: "Cliente soltado",
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

/** Bulk-set status on several conversations at once. */
export async function bulkSetStatus(convIds: string[], status: "open" | "pending" | "resolved"): Promise<void> {
  if (!convIds.length) return;
  const { supabase } = await ctx();
  await supabase.from("conversations").update(status === "resolved" ? { status, unread: 0 } : { status }).in("id", convIds);
}

/**
 * Transferencia MASIVA: varios chats a un agente (o a nadie). Suelta cualquier "mantener conmigo".
 *
 * Hacía exactamente lo mismo que la transferencia de uno en uno pero sin dejar rastro ni avisar a
 * nadie: ni evento en la bitácora ni notificación. O sea, mover un chat quedaba registrado y mover
 * veinte no —- justo al revés de lo que conviene. Ahora escribe el mismo evento `swap` por chat y
 * manda UN aviso con el total, que es como se lee bien: "te transfirió 20 chats", no veinte avisos.
 */
export async function bulkAssign(convIds: string[], agentId: string | null): Promise<void> {
  if (!convIds.length) return;
  const { supabase, userId } = await ctx();
  await supabase.from("conversations").update({ assignee_id: agentId, locked_to: null }).in("id", convIds);

  const businessId = await businessOf(convIds[0]);
  if (!businessId) return;
  let label = "Devuelto a sin asignar";
  if (agentId) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", agentId).maybeSingle();
    label = `Transferido a ${(p?.full_name as string) || "un agente"}`;
  }
  const rows = convIds.map((id) => ({
    business_id: businessId, parent_type: "conversation", parent_id: id,
    actor_id: userId, kind: "swap", text: label,
  }));
  // Mismo repliegue que en la transferencia de uno: `target_id` es 0068 y puede no estar aplicada.
  const { error } = await supabase.from("events").insert(rows.map((r) => ({ ...r, target_id: agentId })));
  if (error) await supabase.from("events").insert(rows);

  await pushTransfer({ businessId, actorId: userId, targetId: agentId, conversationIds: convIds });
}

/** Bulk-delete several conversations (messages cascade; notes/events cleared). */
export async function bulkDeleteConvs(convIds: string[]): Promise<void> {
  if (!convIds.length) return;
  const { supabase } = await ctx();
  await supabase.from("notes").delete().eq("parent_type", "conversation").in("parent_id", convIds);
  await supabase.from("events").delete().eq("parent_type", "conversation").in("parent_id", convIds);
  await supabase.from("conversations").delete().in("id", convIds);
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
  const { data: c } = await supabase.from("contacts").select("tags, business_id").eq("id", contactId).maybeSingle();
  const tags = Array.from(new Set([...((c?.tags as string[]) ?? []), clean]));
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
  if (c?.business_id) await ensureTag(supabase, c.business_id as string, clean);
}

/** Remove a tag from a contact. */
export async function removeContactTag(contactId: string, tag: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("tags").eq("id", contactId).maybeSingle();
  const tags = ((c?.tags as string[]) ?? []).filter((t) => t !== tag);
  await supabase.from("contacts").update({ tags }).eq("id", contactId);
}

/**
 * Pide que se busque el nombre de WhatsApp de este contacto.
 *
 * Comprueba ANTES si hay quien pueda atenderlo, y por eso devuelve un motivo en vez de nada. Quien
 * lo atiende es el worker de whatsmeow, y ese **excluye a propósito las sesiones oficiales** (Cloud
 * API). Así que en un número oficial esto encendía una bandera que nadie iba a mirar jamás: el
 * botón no hacía nada, no lo decía, y la bandera se quedaba puesta para siempre —- en producción
 * había una del 25 de agosto esperando.
 *
 * Y esos negocios ni lo necesitan: la vía oficial ya adopta el nombre del perfil que viene en el
 * webhook, sin pisar los nombres puestos a mano (ver `ensureConversation` en cloud-ingest.ts). El
 * nombre les llega solo; lo que no tiene sentido es ofrecerles un botón imposible.
 */
export async function requestContactInfo(contactId: string): Promise<{ ok: boolean; reason?: "official" | "offline" }> {
  const { supabase } = await ctx();
  const { data: c } = await supabase.from("contacts").select("business_id").eq("id", contactId).maybeSingle();
  if (!c) return { ok: false };
  const { data: sessions } = await supabase
    .from("whatsapp_sessions").select("status, connect_method").eq("business_id", c.business_id);
  // `connect_method` nulo = QR, que es como nacieron las sesiones antes de que existiera la columna.
  const wa = (sessions ?? []).filter((s) => ((s.connect_method as string | null) ?? "qr") !== "official");
  if (!wa.length) return { ok: false, reason: "official" };
  // Con la sesión caída la bandera se queda esperando —- eso SÍ es correcto, el worker la atiende al
  // reconectar—, pero conviene decirlo para que no parezca que el botón se tragó el clic.
  if (!wa.some((s) => s.status === "connected")) return { ok: false, reason: "offline" };
  await supabase.from("contacts").update({ fetch_requested: new Date().toISOString() }).eq("id", contactId);
  return { ok: true };
}

export async function setConvHidden(convId: string, hidden: boolean): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ hidden }).eq("id", convId);
}

/** "Stop listening": when muted, the worker drops incoming messages for this conversation. */
export async function setConvMuted(convId: string, muted: boolean): Promise<void> {
  const { supabase } = await ctx();
  await supabase.from("conversations").update({ muted }).eq("id", convId);
}

/** Delete a contact and all their chats: conversations (messages cascade) + conversation
 *  notes/events, then the contact row. Orders are kept (their contact link is nulled by FK). */
export async function deleteContact(contactId: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: convs } = await supabase.from("conversations").select("id").eq("contact_id", contactId);
  const ids = (convs ?? []).map((c) => c.id as string);
  if (ids.length) {
    await supabase.from("notes").delete().eq("parent_type", "conversation").in("parent_id", ids);
    await supabase.from("events").delete().eq("parent_type", "conversation").in("parent_id", ids);
    await supabase.from("conversations").delete().in("id", ids);
  }
  await supabase.from("contacts").delete().eq("id", contactId);
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

async function transferConvImpl(
  convId: string,
  mode: "agent" | "area" | "unassign",
  destId: string,
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  // A manual transfer is a deliberate reassignment, so it releases any "mantener conmigo" lock.
  // Build the activity label with the destination (agent name / area name) so the log shows who.
  let label = "Devuelto a sin asignar";
  // A quién queda asignado. Se guarda el ID (no solo el nombre en el texto) para poder avisarle
  // solo a esa persona: con el nombre suelto, nadie puede saber si el destinatario es él.
  let targetId: string | null = null;
  let areaName: string | null = null;
  if (mode === "unassign") {
    await supabase.from("conversations").update({ assignee_id: null, locked_to: null }).eq("id", convId);
  } else if (mode === "agent") {
    await supabase.from("conversations").update({ assignee_id: destId, locked_to: null }).eq("id", convId);
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", destId).maybeSingle();
    label = `Transferido a ${(p?.full_name as string) || "un agente"}`;
    targetId = destId;
  } else {
    // Route to the area's default agent, if set.
    const { data: area } = await supabase
      .from("areas").select("route_to, name").eq("id", destId).maybeSingle();
    await supabase
      .from("conversations")
      .update({ area_id: destId, assignee_id: (area?.route_to as string) ?? null, locked_to: null })
      .eq("id", convId);
    areaName = ((area?.name as string) ?? "").trim() || null;
    label = `Transferido al área ${areaName ?? ""}`.trim();
    targetId = (area?.route_to as string) ?? null; // el área puede enrutar a un agente concreto
  }
  const row = { business_id: businessId, parent_type: "conversation", parent_id: convId, actor_id: userId, kind: "swap", text: label };
  // target_id es 0068 — si aún no está aplicada, el evento se guarda igual sin él.
  const { error } = await supabase.from("events").insert({ ...row, target_id: targetId });
  if (error) await supabase.from("events").insert(row);

  // El aviso va DESPUÉS de guardar y con await: si la transferencia no se guardó no hay nada que
  // avisar, y `pushTransfer` se traga sus errores, así que no puede tumbar la acción. Sin esto la
  // transferencia solo existía como toast del navegador —- o sea, nada con la app cerrada, y nada
  // tampoco si el destinatario está parado en otra organización.
  await pushTransfer({ businessId, actorId: userId, targetId, conversationIds: [convId], areaName });
}

/** Pide al worker que baje un adjunto que se dejó pendiente por pesado.
 *
 *  El worker es un background worker sin puerto HTTP, así que la petición viaja por la base con el
 *  mismo mecanismo que editar/borrar: pending_op. El worker lo recoge en pollOps, baja el archivo y
 *  rellena media_url — y el UPDATE llega al chat por realtime, sin que la UI tenga que sondear. */
export async function requestMediaFetch(messageId: string): Promise<{ ok: boolean }> {
  const { supabase } = await ctx();
  const { error } = await supabase.from("messages")
    .update({ pending_op: "fetch_media", media_fetch_error: null })
    .eq("id", messageId).is("media_url", null);
  return { ok: !error };
}

/** URL firmada del adjunto de un mensaje, para la miniatura de una notificación.
 *  El payload de realtime trae la RUTA de storage, no algo que el navegador pueda pintar. */
export async function getMediaPreviewUrl(messageId: string): Promise<string | null> {
  const { supabase } = await ctx();
  const { data } = await supabase.from("messages").select("media_url").eq("id", messageId).maybeSingle();
  const path = (data as { media_url?: string | null } | null)?.media_url;
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const admin = createAdminClient();
  const { data: signed } = await admin.storage.from("media").createSignedUrl(path, 60 * 10);
  return signed?.signedUrl ?? null;
}

export async function acceptConv(convId: string): Promise<void> {
  return acceptConvImpl(convId);
}

export async function setConvStatus(convId: string, status: "open" | "pending" | "resolved"): Promise<{ flows: string[] }> {
  return setConvStatusImpl(convId, status);
}

export async function transferConv(convId: string, mode: "agent" | "area" | "unassign", destId: string): Promise<void> {
  return transferConvImpl(convId, mode, destId);
}
