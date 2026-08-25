import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/buildId";
import { embeddedSignupConfig } from "@/lib/whatsapp-official";

export const dynamic = "force-dynamic";

/**
 * La versión que sirve ESTE servidor. La pestaña compara con la suya al volver a la app; si no
 * coinciden, hay despliegue nuevo y se ofrece recargar. Ver src/lib/buildSkew.ts.
 *
 * Va también el id de la configuración de Embedded Signup, y no es un descuido: es un valor que ya
 * viaja al navegador en cada intento de conexión (Meta lo recibe del propio popup), así que
 * publicarlo no revela nada. A cambio permite responder desde fuera la pregunta que nos costó una
 * tarde: ¿qué configuración está usando producción AHORA MISMO? `NEXT_PUBLIC_*` se incrusta al
 * compilar, así que cambiar la variable sin reconstruir deja el valor viejo en el navegador sin
 * que nada lo delate.
 */
export async function GET() {
  return NextResponse.json(
    { build: BUILD_ID, esConfig: embeddedSignupConfig().configId || null },
    { headers: { "cache-control": "no-store" } },
  );
}
