import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pushInboundMessage, pushConfigured } from "@/lib/push";

/**
 * Disparador de push para el worker de whatsmeow.
 *
 * El worker es Go y vive en otro proceso: no puede llamar a `pushInboundMessage` directo. Podría
 * firmar VAPID por su cuenta, pero entonces habría DOS implementaciones del envío —- y de la
 * decisión de a quién le toca cada aviso —- y a la primera semana no dirían lo mismo. Así que el
 * worker avisa por HTTP y la lógica sigue viviendo en un solo sitio (`src/lib/push.ts`).
 *
 * Autenticación por secreto compartido, no por sesión: aquí no hay usuario, hay un servicio. Se
 * compara en tiempo constante —- comparar secretos con `===` filtra su longitud y su prefijo por el
 * tiempo que tarda en fallar.
 */
export const runtime = "nodejs";

function secretOk(header: string | null): boolean {
  const expected = process.env.PUSH_HOOK_SECRET?.trim();
  // Sin secreto configurado la ruta queda CERRADA, no abierta: un despliegue al que se le olvidó
  // la variable no debe convertirse en un webhook público.
  if (!expected) return false;
  const got = (header ?? "").trim();
  if (!got || got.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(expected)); } catch { return false; }
}

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-push-secret"))) {
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
