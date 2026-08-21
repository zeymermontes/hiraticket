import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptBody } from "@/lib/msgcrypto";
import { pushInboundMessage } from "@/lib/push";
import { officialSessionByPhoneNumberId, type CloudSession } from "@/lib/cloud-session";
import { getMediaInfo, downloadMedia } from "@/lib/whatsapp-cloud";

// Inbound pipeline for OFFICIAL (Cloud API / coexistence) sessions — the Node counterpart of the
// worker's handleIncoming. The Meta webhook routes every event here by phone_number_id. We mirror
// the worker's behavior so the chat UI can't tell the channels apart: same tables, same
// encrypted-at-rest bodies (encm:v1), same conversation side-effects (unread, reopen, last_message_at).
//
// Handled webhook fields:
//   messages            → live inbound + delivery/read/failed statuses
//   smb_message_echoes  → messages the owner sends from the phone's Business app (coexistence)
//   history             → up to 6 months of chat history shared during coexistence onboarding
//   smb_app_state_sync  → contact names synced from the phone

const BIG_MEDIA_BYTES = 20 * 1024 * 1024; // mirror the worker's cap

type CloudMsg = {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  image?: MediaPart;
  video?: MediaPart;
  audio?: MediaPart;
  document?: MediaPart & { filename?: string };
  sticker?: MediaPart;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  button?: { text?: string; payload?: string };
  context?: { id?: string };
  history_context?: { from_me?: boolean };
};
type MediaPart = { id?: string; mime_type?: string; caption?: string; sha256?: string };

type CloudValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: CloudMsg[];
  statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
  message_echoes?: CloudMsg[];
  history?: { threads?: { id?: string; messages?: CloudMsg[] }[] }[];
  state_sync?: { type?: string; contact?: { full_name?: string; phone_number?: string } }[];
};

type Admin = ReturnType<typeof createAdminClient>;

/** Entry point called by /api/whatsapp/webhook for every change. Never throws. */
export async function ingestCloudEvent(field: string, rawValue: unknown): Promise<void> {
  const value = (rawValue ?? {}) as CloudValue;
  const phoneNumberId = value.metadata?.phone_number_id ?? "";
  const session = await officialSessionByPhoneNumberId(phoneNumberId);
  if (!session) return; // number not onboarded (or disconnected) — ack and drop

  const supabase = createAdminClient();
  try {
    if (field === "messages") {
      const names = profileNames(value);
      for (const msg of value.messages ?? []) {
        await ingestMessage(supabase, session, msg, { live: true, names });
      }
      for (const st of value.statuses ?? []) await applyStatus(supabase, session, st);
      // Drain any due queued outbound (e.g. staggered campaign sends whose next_retry_at passed):
      // every status/message event doubles as a tick for this business. Terminates when empty.
      if (value.statuses?.length) {
        const { flushCloudOutbox } = await import("@/lib/cloud-outbox");
        await flushCloudOutbox(session.businessId);
      }
    } else if (field === "smb_message_echoes") {
      for (const msg of value.message_echoes ?? []) {
        await ingestMessage(supabase, session, msg, { live: true, names: {}, forceOut: true });
      }
    } else if (field === "history") {
      for (const chunk of value.history ?? []) {
        for (const thread of chunk.threads ?? []) {
          await ingestHistoryThread(supabase, session, thread);
        }
      }
    } else if (field === "smb_app_state_sync") {
      await syncContactNames(supabase, session, value.state_sync ?? []);
    }
  } catch (e) {
    console.error("[cloud-ingest]", field, e instanceof Error ? e.message : e);
  }
}

function profileNames(value: CloudValue): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of value.contacts ?? []) {
    if (c.wa_id && c.profile?.name) out[c.wa_id.replace(/\D/g, "")] = c.profile.name;
  }
  return out;
}

// ---------- contact + conversation (mirrors the worker's 1:1 upsert) ----------

async function ensureConversation(
  supabase: Admin,
  session: CloudSession,
  phoneDigits: string,
  name?: string,
): Promise<{ convId: string; muted: boolean; status: string; unread: number; lastAt: string | null; name: string } | null> {
  const businessId = session.businessId;
  const normalized = "+" + phoneDigits;

  let { data: contact } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("phone", normalized)
    .maybeSingle();
  if (!contact) {
    const ins = await supabase
      .from("contacts")
      .insert({ business_id: businessId, name: name || normalized, phone: normalized })
      .select("id, name")
      .single();
    contact = ins.data;
  } else if (name && (contact.name === normalized || contact.name === phoneDigits)) {
    // Placeholder (phone-as-name) → adopt the WhatsApp profile name; never clobber a custom name.
    await supabase.from("contacts").update({ name }).eq("id", contact.id);
  }
  if (!contact) return null;

  // Reuse the contact's most recent conversation OF THIS NUMBER — even a resolved one (the worker
  // reopens it). Strictly scoped by number_phone (0078): a freshly onboarded number never adopts
  // another number's threads, so switching numbers starts with a clean inbox.
  let query = supabase
    .from("conversations")
    .select("id, muted, status, unread, last_message_at")
    .eq("business_id", businessId)
    .eq("contact_id", contact.id);
  if (session.phone) query = query.eq("number_phone", session.phone);
  let { data: conv } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conv) {
    const ins = await supabase
      .from("conversations")
      .insert({
        business_id: businessId,
        contact_id: contact.id,
        status: "open",
        unread: 0,
        number_phone: session.phone,
      })
      .select("id, muted, status, unread, last_message_at")
      .single();
    conv = ins.data;
  }
  if (!conv) return null;
  return {
    convId: conv.id as string,
    muted: Boolean(conv.muted),
    status: (conv.status as string) ?? "open",
    unread: (conv.unread as number) ?? 0,
    lastAt: (conv.last_message_at as string | null) ?? null,
    // Para titular el push con el nombre del cliente y no con su número.
    name: ((contact.name as string) || normalized),
  };
}

/** Qué se lee en la notificación. Un adjunto no tiene texto, así que se nombra el tipo —- y de
 *  todas formas el cuerpo se recorta: una notificación no es el mensaje, es el aviso de que hay
 *  uno. */
function pushPreview(type: string, body: string | null): string {
  const t = (body ?? "").trim();
  if (t) return t.slice(0, 120);
  switch (type) {
    case "image": return "📷 Foto";
    case "video": return "🎥 Video";
    case "audio": return "🎤 Audio";
    case "sticker": return "🈸 Sticker";
    case "document": return "📄 Documento";
    case "location": return "📍 Ubicación";
    case "contact": return "👤 Contacto";
    default: return "Mensaje nuevo";
  }
}

/** ¿Ya salió una respuesta nuestra DESPUÉS de este momento? Un evento que Meta reentrega tarde
 *  puede ser de un mensaje que el agente ya contestó; volver a marcarlo no leído (o reabrir el
 *  chat) sería inventarle trabajo pendiente. Índice (conversation_id, created_at desc) de 0026. */
async function repliedAfter(supabase: Admin, convId: string, ts: string): Promise<boolean> {
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", convId)
    .eq("direction", "out")
    .gt("created_at", ts)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

// ---------- messages ----------

async function ingestMessage(
  supabase: Admin,
  session: CloudSession,
  msg: CloudMsg,
  opts: { live: boolean; names: Record<string, string>; forceOut?: boolean },
): Promise<void> {
  if (!msg.id) return;

  const bizDigits = (session.phone ?? "").replace(/\D/g, "");
  const fromDigits = (msg.from ?? "").replace(/\D/g, "");
  const outbound = opts.forceOut || msg.history_context?.from_me === true || (Boolean(bizDigits) && fromDigits === bizDigits);
  const peerDigits = outbound ? (msg.to ?? "").replace(/\D/g, "") : fromDigits;
  if (!peerDigits) return;

  // Reactions mutate the target message instead of creating a row.
  if (msg.type === "reaction" && msg.reaction?.message_id) {
    await applyReaction(supabase, session.businessId, msg.reaction, outbound);
    return;
  }

  // Dedupe by wamid (webhook retries, history overlapping live delivery, our own echoes).
  const { data: dupe } = await supabase
    .from("messages")
    .select("id")
    .eq("business_id", session.businessId)
    .eq("wa_id", msg.id)
    .limit(1)
    .maybeSingle();
  if (dupe) return;

  const conv = await ensureConversation(supabase, session, peerDigits, opts.names[peerDigits]);
  if (!conv) return;
  if (opts.live && conv.muted) return; // worker parity: muted conversations drop the message entirely

  const parsed = await parseContent(supabase, session, msg);
  if (!parsed) return; // unsupported type (interactive/order/system/…) — nothing to render yet

  const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();
  let replyTo: string | null = null;
  if (msg.context?.id) {
    const { data: quoted } = await supabase
      .from("messages")
      .select("id")
      .eq("business_id", session.businessId)
      .eq("wa_id", msg.context.id)
      .maybeSingle();
    replyTo = (quoted?.id as string) ?? null;
  }

  await supabase.from("messages").insert({
    business_id: session.businessId,
    conversation_id: conv.convId,
    direction: outbound ? "out" : "in",
    type: parsed.type,
    body: parsed.body ? encryptBody(session.businessId, parsed.body) : null,
    state: outbound ? "sent" : "delivered",
    wa_id: msg.id,
    media_url: parsed.mediaUrl,
    media_mime: parsed.mediaMime,
    media_name: parsed.mediaName,
    meta: parsed.meta,
    reply_to: replyTo,
    created_at: ts,
  });

  if (opts.live) {
    // Meta reentrega con la marca de tiempo ORIGINAL: tras un despliegue, un reinicio o un webhook
    // lento, un evento de hace horas puede aterrizar ahora. Guardarlo está bien —- en el hilo se ve
    // a su hora real—, pero NO puede reescribir el presente de la conversación. Sin esto,
    // last_message_at retrocedía: el chat pasaba a leerse "hace 5 h" y se re-ordenaba aunque lo
    // hubieran contestado hace un rato, y el unread/reabrir lo resucitaba ya respondido. De ahí el
    // reporte de "se recarga y aparecen chats de horas atrás". El reloj solo avanza, y los efectos
    // de "queda algo pendiente" se saltan si ya salió una respuesta después de ese mensaje.
    const prev = conv.lastAt ?? "";
    const late = Boolean(prev) && ts < prev;
    const patch: Record<string, unknown> = {};
    if (!late) patch.last_message_at = ts;
    if (outbound) {
      // Un eco tardío no borra el no leído de un mensaje del cliente que llegó después.
      if (!late && conv.unread > 0) patch.unread = 0;
    } else if (!late || !(await repliedAfter(supabase, conv.convId, ts))) {
      // Same side-effects as the worker: bump unread, surface the conversation, reopen resolved.
      patch.unread = conv.unread + 1;
      patch.hidden = false;
      patch.snoozed_until = null;
      if (conv.status === "resolved") patch.status = "open";
    }
    if (Object.keys(patch).length) await supabase.from("conversations").update(patch).eq("id", conv.convId);

    // Push a quien le toque. Solo para mensajes ENTRANTES y no tardíos: el eco de algo que mandó
    // el propio equipo no se avisa, y un webhook que aterriza tres horas tarde tampoco —- avisar de
    // un mensaje ya contestado es peor que no avisar. No se espera (`void`): un aviso que falla no
    // puede retrasar ni tumbar la ingesta del mensaje.
    if (!outbound && !late) {
      void pushInboundMessage({
        businessId: session.businessId,
        conversationId: conv.convId,
        title: conv.name,
        body: pushPreview(parsed.type, parsed.body),
      });
    }
  } else {
    // History backfill: never touch unread/status, only keep last_message_at moving forward.
    const { data: cur } = await supabase.from("conversations").select("last_message_at").eq("id", conv.convId).maybeSingle();
    const prev = (cur?.last_message_at as string) ?? "";
    if (!prev || ts > prev) {
      await supabase.from("conversations").update({ last_message_at: ts }).eq("id", conv.convId);
    }
  }
}

async function ingestHistoryThread(
  supabase: Admin,
  session: CloudSession,
  thread: { id?: string; messages?: CloudMsg[] },
): Promise<void> {
  const threadDigits = (thread.id ?? "").replace(/@.*/, "").replace(/\D/g, "");
  const msgs = thread.messages ?? [];
  for (const msg of msgs) {
    // History payloads sometimes omit `to`; the thread id is the peer.
    if (!msg.to && threadDigits) msg.to = threadDigits;
    if (!msg.from && threadDigits) msg.from = threadDigits;
    await ingestMessage(supabase, session, msg, { live: false, names: {} });
  }
}

type Parsed = {
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  meta: Record<string, unknown> | null;
};

async function parseContent(supabase: Admin, session: CloudSession, msg: CloudMsg): Promise<Parsed | null> {
  const none = { mediaUrl: null, mediaMime: null, mediaName: null, meta: null };

  if (msg.type === "text") {
    const body = msg.text?.body ?? "";
    if (!body) return null;
    return { type: "text", body, ...none };
  }

  // Taps on interactive replies (list/button) and on template quick-reply buttons arrive as their
  // own types — surface them as plain text (the tapped option IS what the customer said).
  if (msg.type === "interactive" && msg.interactive) {
    const pick = msg.interactive.button_reply ?? msg.interactive.list_reply;
    if (!pick?.title) return null;
    return { type: "text", body: pick.title, ...none, meta: { wa_reply: { id: pick.id ?? null } } };
  }
  if (msg.type === "button" && msg.button?.text) {
    return { type: "text", body: msg.button.text, ...none, meta: { wa_reply: { payload: msg.button.payload ?? null } } };
  }

  if (msg.type === "location" && msg.location) {
    return {
      type: "location",
      body: null,
      ...none,
      meta: {
        lat: msg.location.latitude,
        lng: msg.location.longitude,
        name: msg.location.name ?? null,
        address: msg.location.address ?? null,
      },
    };
  }

  if (msg.type === "contacts" && Array.isArray(msg.contacts)) {
    return { type: "contact", body: null, ...none, meta: { contacts: msg.contacts } };
  }

  const mediaTypes = ["image", "video", "audio", "document", "sticker"] as const;
  const mt = mediaTypes.find((t) => t === msg.type);
  if (mt) {
    const part = msg[mt] as (MediaPart & { filename?: string }) | undefined;
    if (!part) return null;
    const stored = part.id ? await storeMedia(supabase, session, part.id, msg.id ?? part.id, part.mime_type) : null;
    return {
      type: mt,
      body: part.caption ?? null,
      mediaUrl: stored?.path ?? null,
      mediaMime: stored?.mime ?? part.mime_type ?? null,
      mediaName: part.filename ?? null,
      meta: stored ? null : { media_error: "cloud media unavailable" },
    };
  }

  return null;
}

/** Download inbound media from Meta's CDN and store it in the same bucket/layout the worker uses
 *  (<businessId>/in/<wamid>.<ext>), so the chat UI renders it identically. */
async function storeMedia(
  supabase: Admin,
  session: CloudSession,
  mediaId: string,
  waId: string,
  fallbackMime?: string,
): Promise<{ path: string; mime: string } | null> {
  const info = await getMediaInfo(mediaId, session.token);
  if (!info.ok || !info.data.url) return null;
  if ((info.data.file_size ?? 0) > BIG_MEDIA_BYTES) return null;

  const bytes = await downloadMedia(info.data.url, session.token);
  if (!bytes) return null;

  const mime = info.data.mime_type || fallbackMime || "application/octet-stream";
  const path = `${session.businessId}/in/${waId.replace(/[^A-Za-z0-9._-]/g, "_")}.${extOf(mime)}`;
  const { error } = await supabase.storage.from("media").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) return null;
  return { path, mime };
}

function extOf(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/amr": "amr",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
  };
  const clean = mime.split(";")[0].trim();
  return map[clean] ?? (clean.split("/")[1] || "bin").slice(0, 8);
}

// ---------- statuses (sent → delivered → read / failed) ----------

async function applyStatus(
  supabase: Admin,
  session: CloudSession,
  st: { id?: string; status?: string; errors?: { title?: string; message?: string }[] },
): Promise<void> {
  if (!st.id || !st.status) return;
  const map: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
  const state = map[st.status];
  if (!state) return;

  const patch: Record<string, unknown> = { state };
  if (state === "failed") {
    const e = st.errors?.[0];
    patch.fail_reason = (e ? [e.title, e.message].filter(Boolean).join(": ") : "failed").slice(0, 300);
  }
  let q = supabase
    .from("messages")
    .update(patch)
    .eq("business_id", session.businessId)
    .eq("wa_id", st.id)
    .eq("direction", "out");
  // Never downgrade a 'read' back to 'delivered' when receipts arrive out of order.
  if (state === "delivered") q = q.neq("state", "read");
  await q;
}

// ---------- reactions ----------

async function applyReaction(
  supabase: Admin,
  businessId: string,
  reaction: { message_id?: string; emoji?: string },
  fromBusiness: boolean,
): Promise<void> {
  const { data: target } = await supabase
    .from("messages")
    .select("id, reactions")
    .eq("business_id", businessId)
    .eq("wa_id", reaction.message_id)
    .maybeSingle();
  if (!target) return;

  const by = fromBusiness ? "agent" : "contact";
  const list = (Array.isArray(target.reactions) ? target.reactions : []) as { emoji: string; by: string }[];
  const next = list.filter((r) => r.by !== by);
  if (reaction.emoji) next.push({ emoji: reaction.emoji, by });
  await supabase.from("messages").update({ reactions: next }).eq("id", target.id);
}

// ---------- coexistence contact-name sync ----------

async function syncContactNames(
  supabase: Admin,
  session: CloudSession,
  entries: { type?: string; contact?: { full_name?: string; phone_number?: string } }[],
): Promise<void> {
  for (const e of entries) {
    if (e.type !== "contact") continue;
    const digits = (e.contact?.phone_number ?? "").replace(/\D/g, "");
    const name = (e.contact?.full_name ?? "").trim();
    if (!digits || !name) continue;
    const normalized = "+" + digits;
    // Only fill placeholder names (phone-as-name) — never clobber a name an agent typed.
    await supabase
      .from("contacts")
      .update({ name })
      .eq("business_id", session.businessId)
      .eq("phone", normalized)
      .in("name", [normalized, digits]);
  }
}
