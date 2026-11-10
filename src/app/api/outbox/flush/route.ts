import { NextResponse } from "next/server";
import { hookSecretOk } from "@/lib/hookSecret";
import { flushCloudOutbox } from "@/lib/cloud-outbox";

/**
 * El worker avisa que dejó mensajes `queued` en un negocio (p. ej. al liberar un mensaje programado,
 * ver 0098) para que, si ese negocio está en la API oficial, salgan por cloud-outbox. Los negocios
 * por QR los manda el propio worker y aquí no hay nada que hacer: `flushCloudOutbox` no hace nada
 * sin sesión oficial.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!hookSecretOk(req.headers.get("x-push-secret"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { businessId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad-json" }, { status: 400 }); }
  if (!body.businessId) return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  await flushCloudOutbox(body.businessId);
  return NextResponse.json({ ok: true });
}
