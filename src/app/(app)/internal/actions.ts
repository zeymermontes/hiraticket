"use server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { getInternalThreads, getInternalMessages, type InternalThread, type InternalMsg } from "@/lib/internal";
import type { Agent } from "@/lib/chat";
import { encryptBody } from "@/lib/msgcrypto";
import { ownsMediaPath, STICKER_MIME } from "@/lib/stickers";

async function ctx() {
  const supabase = await createClient();
  const user = await getSessionUser();
  const biz = await getMyBusiness();
  return { supabase, userId: user?.id ?? null, businessId: biz?.id ?? null };
}

export async function loadInternalThreads(): Promise<{ threads: InternalThread[]; agents: Agent[]; meId: string } | null> {
  const { userId, businessId } = await ctx();
  if (!userId || !businessId) return null;
  const { threads, agents } = await getInternalThreads(businessId, userId);
  return { threads, agents, meId: userId };
}

export async function loadInternalMessages(channel: string, before?: string): Promise<InternalMsg[]> {
  const { businessId } = await ctx();
  if (!businessId) return [];
  return getInternalMessages(businessId, channel, { before });
}

export async function sendInternalMessage(channel: string, body: string, replyTo?: string | null, mentions?: string[]): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  await supabase.from("internal_messages").insert({
    business_id: businessId, channel, author_id: userId, body: encryptBody(businessId, text), mentions: mentions ?? [], reply_to: replyTo ?? null,
  });
  // Author has implicitly "read" their own send.
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}

/** Queue an internal media message (file already uploaded to the 'media' bucket). */
export async function sendInternalMedia(channel: string, input: { type: string; mediaUrl: string; mime: string; name?: string; caption?: string; thumb?: string; size?: number }): Promise<void> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  const row = {
    business_id: businessId, channel, author_id: userId, body: input.caption ? encryptBody(businessId, input.caption) : "",
    type: input.type, media_url: input.mediaUrl, media_mime: input.mime, media_name: input.name ?? null,
  };
  // meta/media_size llegan con la 0071. Si no está aplicada el insert falla, así que se reintenta
  // sin ellas: mandar la foto importa más que su miniatura.
  const { error } = await supabase.from("internal_messages").insert({
    ...row, media_size: input.size ?? null, meta: input.thumb ? { thumb: input.thumb } : null,
  });
  if (error) await supabase.from("internal_messages").insert(row);
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}

/** Send a sticker (picked from the tray) into an internal channel — reuses the stored WebP. */
export async function sendInternalSticker(channel: string, path: string): Promise<void> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId || !ownsMediaPath(businessId, path)) return;
  // Antes se buscaba el origen en `messages`, la tabla de WhatsApp: un sticker que solo había
  // existido entre el equipo no se podía reenviar. Ahora la ruta del archivo basta (0070).
  await supabase.from("internal_messages").insert({
    business_id: businessId, channel, author_id: userId, body: "", type: "sticker",
    media_url: path, media_mime: STICKER_MIME,
  });
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}

/** Forward an internal message (text or media) to another internal channel. */
export async function forwardInternalMessage(messageId: string, toChannel: string): Promise<void> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  const { data: m } = await supabase.from("internal_messages").select("body, type, media_url, media_mime, media_name").eq("id", messageId).maybeSingle();
  if (!m) return;
  await supabase.from("internal_messages").insert({
    business_id: businessId, channel: toChannel, author_id: userId, forwarded: true,
    body: m.body ?? "", type: (m.type as string) ?? "text", media_url: m.media_url ?? null, media_mime: m.media_mime ?? null, media_name: m.media_name ?? null,
  });
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel: toChannel, last_read_at: new Date().toISOString() });
}

/** Edit your own internal message. */
export async function editInternalMessage(id: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  await supabase.from("internal_messages").update({ body: encryptBody(businessId, text), edited: true }).eq("id", id).eq("author_id", userId);
}

/** Delete (soft) your own internal message. */
export async function deleteInternalMessage(id: string): Promise<void> {
  const { supabase, userId } = await ctx();
  if (!userId) return;
  await supabase.from("internal_messages").update({ deleted: true, body: "" }).eq("id", id).eq("author_id", userId);
}

/** Toggle a reaction (one emoji per user) on an internal message. */
export async function reactInternalMessage(id: string, emoji: string): Promise<void> {
  const { supabase, userId } = await ctx();
  if (!userId) return;
  const { data: m } = await supabase.from("internal_messages").select("reactions").eq("id", id).maybeSingle();
  const cur = (Array.isArray(m?.reactions) ? m!.reactions : []) as { emoji: string; by: string }[];
  const mine = cur.find((r) => r.by === userId);
  let next: { emoji: string; by: string }[];
  if (mine && mine.emoji === emoji) next = cur.filter((r) => r.by !== userId); // tap same → remove
  else next = [...cur.filter((r) => r.by !== userId), { emoji, by: userId }];  // replace mine
  await supabase.from("internal_messages").update({ reactions: next }).eq("id", id);
}

export async function markInternalRead(channel: string): Promise<void> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}
