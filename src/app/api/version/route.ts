import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/buildId";

export const dynamic = "force-dynamic";

/** La versión que sirve ESTE servidor. La pestaña compara con la suya al volver a la app; si no
 *  coinciden, hay despliegue nuevo y se ofrece recargar. Ver src/lib/buildSkew.ts. */
export async function GET() {
  return NextResponse.json({ build: BUILD_ID }, { headers: { "cache-control": "no-store" } });
}
