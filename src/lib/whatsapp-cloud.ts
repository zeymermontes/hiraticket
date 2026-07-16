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
      const msg = json?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
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

export function listTemplates(wabaId: string, token: string) {
  return graph<{ data: { name: string; status: string; category: string; language: string }[] }>(
    `${wabaId}/message_templates?fields=name,status,category,language&limit=50`,
    token,
  );
}

// Reads the shared test credentials (used by the App Review demo panel). Empty until set in env.
export function cloudTestCreds() {
  return {
    token: process.env.WHATSAPP_CLOUD_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID ?? "",
    wabaId: process.env.WHATSAPP_TEST_WABA_ID ?? "",
  };
}
