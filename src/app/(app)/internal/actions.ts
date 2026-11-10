"use server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";
import { getInternalThreads, getInternalMessages, type InternalThread, type InternalMsg, type InternalReceipt } from "@/lib/internal";
import type { Agent } from "@/lib/chat";
import { encryptBody } from "@/lib/msgcrypto";
import { ownsMediaPath, STICKER_MIME } from "@/lib/stickers";

async function ctx() {
  const supabase = await createClient();
  const user = await getSessionUser();
  const biz = await getMyBusiness();
  return { supabase, userId: user?.id ?? null, businessId: biz?.id ?? null };
}

export async function loadInternalThreads(): Promise<{ threads: InternalThread[]; agents: Agent[]; receipts: InternalReceipt[]; meId: string } | null> {
  const { userId, businessId } = await ctx();
  if (!userId || !businessId) return null;
  const { threads, agents, receipts } = await getInternalThreads(businessId, userId);
  return { threads, agents, receipts, meId: userId };
}

export async function loadInternalMessages(channel: string, before?: string): Promise<InternalMsg[]> {
  const { businessId } = await ctx();
  if (!businessId) return [];
  return getInternalMessages(businessId, channel, { before });
}

/** Todos los mensajes del canal entre dos fechas (ambas incluidas), cronológico: "exportar chat". */
export async function loadInternalMessageRange(channel: string, after: string, until: string): Promise<InternalMsg[]> {
  const { businessId } = await ctx();
  if (!businessId) return [];
  const out: InternalMsg[] = [];
  let before: string | undefined;
  for (let i = 0; i < 40; i++) {
    const page = await getInternalMessages(businessId, channel, { after, until, before, limit: 500 });
    if (!page.length) break;
    out.unshift(...page);
    if (page.length < 500) break;
    before = page[0].created_at;
  }
  return out;
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
  // La ruta viene del navegador: tiene que ser un archivo de este negocio (ver sendMediaMessage).
  if (!userId || !businessId || !ownsMediaPath(businessId, input.mediaUrl)) return;
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

/**
 * Reenvía un mensaje del chat de un CLIENTE al chat interno: al canal del equipo o al mensaje
 * directo con un compañero. El texto y el archivo se copian tal cual (los dos chats cifran con la
 * misma llave del negocio y guardan los archivos en el mismo sitio), así que no hay que descargar
 * y volver a subir nada.
 *
 * Solo se reenvía a canales de quien llama (el del equipo y sus propios mensajes directos) y solo
 * un mensaje de su mismo negocio: RLS ya impide leer el de otro, y aquí se comprueba además.
 */
export async function forwardToInternal(messageId: string, channels: string[]): Promise<{ ok: boolean; sent: number }> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId || !Array.isArray(channels) || !channels.length) return { ok: false, sent: 0 };
  const { data: m } = await supabase.from("messages")
    .select("business_id, type, body, media_url, media_mime, media_name, deleted").eq("id", messageId).maybeSingle();
  if (!m || m.business_id !== businessId || m.deleted) return { ok: false, sent: 0 };
  const { threads } = await getInternalThreads(businessId, userId);
  const mine = new Set(threads.map((t) => t.key));
  const targets = [...new Set(channels)].filter((c) => mine.has(c));
  if (!targets.length) return { ok: false, sent: 0 };
  // Lo que no trae archivo viaja como texto (una ubicación o un contacto se reenvían por su texto).
  const type = m.media_url ? ((m.type as string) || "document") : "text";
  const { error } = await supabase.from("internal_messages").insert(targets.map((channel) => ({
    business_id: businessId, channel, author_id: userId, forwarded: true,
    body: (m.body as string | null) ?? "", type,
    media_url: m.media_url ?? null, media_mime: m.media_mime ?? null, media_name: m.media_name ?? null,
  })));
  if (error) return { ok: false, sent: 0 };
  const now = new Date().toISOString();
  await supabase.from("internal_reads").upsert(targets.map((channel) => ({ business_id: businessId, user_id: userId, channel, last_read_at: now })));
  return { ok: true, sent: targets.length };
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
