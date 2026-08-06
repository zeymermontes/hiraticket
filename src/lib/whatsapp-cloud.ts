// Thin client for Meta's WhatsApp Cloud API (Graph). Server-only — never import from client code.
// Used by the official send/template flows (and the App Review test panel). Every call returns a
// tagged result instead of throwing, so callers can surface Meta's error text to the user.

const GRAPH = "https://graph.facebook.com/v21.0";

export type CloudResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function graph<T>(path: string, token: string, init?: RequestInit): Promise<CloudResult<T>> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const json = await res.json();
    if (!res.ok) {
      // Meta puts the actionable text in error_user_msg; error.message is often just "Invalid parameter".
      const e = json?.error;
      const msg = e?.error_user_msg || e?.message || `HTTP ${res.status}`;
      return { ok: false, error: e?.error_user_title ? `${e.error_user_title}: ${msg}` : msg };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

// Send a freeform text message. Only valid inside the 24h customer-service window (the recipient
// must have messaged the number recently); otherwise Meta requires a template.
export function sendText(phoneNumberId: string, token: string, to: string, body: string) {
  return graph<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

// Send an approved template — always deliverable (no 24h window). Defaults to hello_world/en_US.
export function sendTemplate(phoneNumberId: string, token: string, to: string, name = "hello_world", lang = "en_US") {
  return graph<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: lang } },
    }),
  });
}

// Create a message template on the WABA (whatsapp_business_management). category: UTILITY | MARKETING | AUTHENTICATION.
export function createTemplate(
  wabaId: string,
  token: string,
  opts: { name: string; category: string; language: string; body: string },
) {
  return graph<{ id: string; status: string; category: string }>(`${wabaId}/message_templates`, token, {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      category: opts.category,
      language: opts.language,
      components: [{ type: "BODY", text: opts.body }],
    }),
  });
}

export interface TemplateRow {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components?: { type: string; format?: string; text?: string }[];
  rejected_reason?: string;
}

export function listTemplates(wabaId: string, token: string) {
  return graph<{ data: TemplateRow[] }>(
    `${wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100`,
    token,
  );
}

// Create a template from a prebuilt components array (header/body/footer/…), for the full builder.
export function createTemplateFull(
  wabaId: string,
  token: string,
  opts: { name: string; category: string; language: string; components: Record<string, unknown>[] },
) {
  return graph<{ id: string; status: string; category: string }>(`${wabaId}/message_templates`, token, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

// Edit an existing template (only REJECTED/PAUSED in our UI). category is optional; components replaces content.
export function editTemplate(
  templateId: string,
  token: string,
  opts: { category?: string; components: Record<string, unknown>[] },
) {
  return graph<{ success: boolean }>(`${templateId}`, token, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

// Delete a template by name (removes all languages of that name on the WABA).
export function deleteTemplate(wabaId: string, token: string, name: string) {
  return graph<{ success: boolean }>(`${wabaId}/message_templates?name=${encodeURIComponent(name)}`, token, {
    method: "DELETE",
  });
}

// Subscribe our app to the WABA's webhooks — without this Meta never calls /api/whatsapp/webhook
// for the onboarded number. Idempotent; called right after the Embedded Signup code exchange.
export function subscribeAppToWaba(wabaId: string, token: string) {
  return graph<{ success: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}

// Register the number for Cloud API messaging. Coexistence numbers keep working on the phone's
// Business app; this enables the API side. The pin is the two-step verification PIN (created here
// if the number has none). May fail if the owner set a different PIN — surface, don't block.
export function registerPhone(phoneNumberId: string, token: string, pin = "000000") {
  return graph<{ success: boolean }>(`${phoneNumberId}/register`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
}

export function getPhoneNumberInfo(phoneNumberId: string, token: string) {
  return graph<{ display_phone_number?: string; verified_name?: string }>(
    `${phoneNumberId}?fields=display_phone_number,verified_name`,
    token,
  );
}

// Send any /messages payload (text/media/sticker/reaction…). The caller builds the typed part;
// we add the envelope. Returns the wamid Meta assigned (stored as messages.wa_id).
export function sendCloudPayload(
  phoneNumberId: string,
  token: string,
  to: string,
  payload: Record<string, unknown>,
) {
  return graph<{ messages: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
  });
}

// Inbound media: Meta sends only a media id; resolve it to a short-lived CDN URL…
export function getMediaInfo(mediaId: string, token: string) {
  return graph<{ url: string; mime_type?: string; file_size?: number }>(`${mediaId}`, token);
}

// …then download the bytes (the CDN URL also requires the bearer token).
export async function downloadMedia(url: string, token: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Reads the shared test credentials (used by the App Review demo panel). Empty until set in env.
export function cloudTestCreds() {
  return {
    token: process.env.WHATSAPP_CLOUD_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID ?? "",
    wabaId: process.env.WHATSAPP_TEST_WABA_ID ?? "",
  };
}
