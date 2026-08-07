import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptBody, isEncryptedBody } from "@/lib/msgcrypto";
import { officialSessionOf, type CloudSession } from "@/lib/cloud-session";
import { sendCloudPayload } from "@/lib/whatsapp-cloud";

// Outbound dispatcher for OFFICIAL (Cloud API) sessions — the Node counterpart of the worker's
// pollOutbound. Producers keep writing to the same outbox (messages with state='queued'); for
// businesses on the official session the worker never picks them up (no whatsmeow client), so every
// producer calls flushCloudOutbox(businessId) right after inserting. Messages follow the same state
// machine: queued → sending (atomic claim) → sent (with wa_id) → delivered/read via the webhook's
// status events; a Meta rejection lands in failed + fail_reason (retryable from the chat UI).

const BATCH = 25;

type QueuedRow = {
  id: string;
  conversation_id: string;
  type: string;
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_name: string | null;
  reply_to: string | null;
  meta: { template?: { name: string; lang: string; params?: string[] } } | null;
  conversation: {
    is_group: boolean | null;
    contact: { phone: string | null } | null;
  } | null;
};

/** Send every due queued outbound of this business through the Cloud API. No-op without an
 *  official connected session, so it's safe to call unconditionally from any producer. */
export async function flushCloudOutbox(businessId: string): Promise<void> {
  const session = await officialSessionOf(businessId);
  if (!session) return;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, type, body, media_url, media_mime, media_name, reply_to, meta, " +
        "conversation:conversations!inner(is_group, contact:contacts(phone))",
    )
    .eq("business_id", businessId)
    .eq("direction", "out")
    .eq("state", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  for (const row of (data ?? []) as unknown as QueuedRow[]) {
    await sendOne(supabase, session, businessId, row);
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function sendOne(supabase: Admin, session: CloudSession, businessId: string, m: QueuedRow) {
  // Claim atomically so a concurrent flush (two tabs, webhook + action) can't double-send.
  const { data: claimed } = await supabase
    .from("messages")
    .update({ state: "sending" })
    .eq("id", m.id)
    .eq("state", "queued")
    .select("id");
  if (!claimed?.length) return;

  const fail = (reason: string) =>
    supabase.from("messages").update({ state: "failed", fail_reason: reason.slice(0, 300) }).eq("id", m.id);

  if (m.conversation?.is_group) {
    await fail("La API oficial de WhatsApp no soporta grupos / the Cloud API does not support groups");
    return;
  }
  const to = (m.conversation?.contact?.phone ?? "").replace(/\D/g, "");
  if (!to) {
    await fail("contact has no phone");
    return;
  }

  const body = decryptBody(businessId, m.body ?? "");
  if (m.body && isEncryptedBody(m.body) && !body) {
    // Same guard as the worker: an undecryptable body must not go out garbled.
    await fail("cannot decrypt body — MESSAGE_SECRET_KEY missing/mismatched");
    return;
  }

  // Template sends (24h window closed) carry their spec in meta.template; the stored body is the
  // rendered text for display only — Meta receives the template name + parameters.
  const tpl = m.meta?.template;
  const payload = tpl
    ? {
        type: "template",
        template: {
          name: tpl.name,
          language: { code: tpl.lang },
          ...(tpl.params?.length
            ? { components: [{ type: "body", parameters: tpl.params.map((t) => ({ type: "text", text: t })) }] }
            : {}),
        },
      }
    : await buildPayload(supabase, m, body);
  if (!payload) {
    await fail(`type '${m.type}' is not supported on the official API yet`);
    return;
  }

  // Reply context: Cloud API wants the wamid of the quoted message.
  if (m.reply_to) {
    const { data: quoted } = await supabase.from("messages").select("wa_id").eq("id", m.reply_to).maybeSingle();
    if (quoted?.wa_id) payload.context = { message_id: quoted.wa_id };
  }

  const res = await sendCloudPayload(session.phoneNumberId, session.token, to, payload);
  if (res.ok) {
    await supabase
      .from("messages")
      .update({ state: "sent", wa_id: res.data.messages?.[0]?.id ?? null, send_attempts: 0, next_retry_at: null })
      .eq("id", m.id);
  } else {
    await fail(res.error);
  }
}

/** Map our message row to a Cloud API /messages payload. Media goes out as a short-lived signed
 *  URL of the stored file (Meta fetches it immediately). Returns null for unsupported types. */
async function buildPayload(
  supabase: Admin,
  m: QueuedRow,
  body: string,
): Promise<Record<string, unknown> | null> {
  if (m.type === "text") {
    if (!body) return null;
    return { type: "text", text: { body, preview_url: true } };
  }

  const media = ["image", "video", "audio", "document", "sticker"];
  if (media.includes(m.type)) {
    const link = await mediaLink(supabase, m.media_url);
    if (!link) return null;
    const part: Record<string, unknown> = { link };
    if (body && (m.type === "image" || m.type === "video" || m.type === "document")) part.caption = body;
    if (m.type === "document" && m.media_name) part.filename = m.media_name;
    return { type: m.type, [m.type]: part };
  }

  return null;
}

/** Send the agent's reaction through the Cloud API (official sessions have no worker to do it).
 *  No-op for whatsmeow businesses — their pending_op 'react' is handled by pollOps. */
export async function sendCloudReactionFor(messageId: string, emoji: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: m } = await supabase
    .from("messages")
    .select("business_id, wa_id, conversation:conversations!inner(is_group, contact:contacts(phone))")
    .eq("id", messageId)
    .maybeSingle();
  const row = m as unknown as
    | { business_id: string; wa_id: string | null; conversation: QueuedRow["conversation"] }
    | null;
  if (!row?.wa_id || row.conversation?.is_group) return;
  const session = await officialSessionOf(row.business_id);
  if (!session) return;
  const to = (row.conversation?.contact?.phone ?? "").replace(/\D/g, "");
  if (!to) return;
  await sendCloudPayload(session.phoneNumberId, session.token, to, {
    type: "reaction",
    reaction: { message_id: row.wa_id, emoji },
  });
  // The op is done — don't leave a pending_op the (absent) worker would never clear.
  await supabase.from("messages").update({ pending_op: null, react_emoji: null }).eq("id", messageId);
}

async function mediaLink(supabase: Admin, mediaUrl: string | null): Promise<string | null> {
  if (!mediaUrl) return null;
  if (/^https?:\/\//.test(mediaUrl)) return mediaUrl;
  const { data } = await supabase.storage.from("media").createSignedUrl(mediaUrl, 3600);
  return data?.signedUrl ?? null;
}
