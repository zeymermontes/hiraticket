import { NextResponse } from "next/server";
import { pushInboundMessage, pushConfigured } from "@/lib/push";
import { hookSecretOk } from "@/lib/hookSecret";

/**
 * Disparador de push para el worker de whatsmeow.
 *
 * El worker es Go y vive en otro proceso: no puede llamar a `pushInboundMessage` directo. Podría
 * firmar VAPID por su cuenta, pero entonces habría DOS implementaciones del envío —- y de la
 * decisión de a quién le toca cada aviso —- y a la primera semana no dirían lo mismo. Así que el
 * worker avisa por HTTP y la lógica sigue viviendo en un solo sitio (`src/lib/push.ts`).
 *
 * Autenticación por secreto compartido, no por sesión (ver `hookSecretOk`).
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hookSecretOk(req.headers.get("x-push-secret"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    // 200 y no error: el worker no tiene nada que reintentar y no queremos que lo trate como fallo.
    return NextResponse.json({ ok: true, skipped: "push-not-configured" });
  }

  let body: { businessId?: string; conversationId?: string; title?: string; body?: string; vibrate?: number[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 }); }

  const { businessId, conversationId, title, body: text } = body;
  if (!businessId || !conversationId) return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });

  await pushInboundMessage({
    businessId,
    conversationId,
    title: (title || "Mensaje nuevo").slice(0, 80),
    body: (text || "").slice(0, 160),
    vibrate: Array.isArray(body.vibrate) ? body.vibrate.slice(0, 8) : undefined,
  });
  return NextResponse.json({ ok: true });
}
