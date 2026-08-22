import { NextRequest, NextResponse } from "next/server";
import { ORG_COOKIE } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /chat/open?c=<conversación>&org=<negocio> — a donde llevan las notificaciones.
 *
 * Antes apuntaban directo a `/chat?c=…`, y con varias organizaciones eso se rompía de la peor
 * manera: si el aviso era de una organización y estabas parado en la otra, la conversación no
 * existía para ti —- RLS la devuelve vacía —- así que tocar la notificación no abría nada, y nada
 * explicaba por qué. Aquí se cambia primero de organización y luego se entra.
 *
 * Va en una RUTA y no en la página porque una cookie solo se puede escribir desde una acción o una
 * ruta, no al renderizar.
 *
 * No se comprueba la membresía y no es un descuido: **la cookie no puede abrir nada**. Solo ELIGE
 * entre las organizaciones de quien la manda —- getMyBusiness lee la lista de membresías y descarta
 * lo que no esté en ella —- así que un `org` inventado acaba en la primera organización real, no en
 * la ajena. Comprobarlo aquí obligaría a crear un cliente de Supabase, y ese refresca la sesión
 * escribiendo cookies que esta redirección construida a mano se lleva por delante: probándolo, la
 * sesión se perdía y la notificación acababa en el login. Lo único que se filtra es la forma, para
 * no guardar basura.
 *
 * Y quien de verdad protege el destino sigue en su sitio: el guarda de sesión del middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const conv = req.nextUrl.searchParams.get("c") ?? "";
  const org = req.nextUrl.searchParams.get("org") ?? "";
  /**
   * La redirección va RELATIVA, y eso no es un detalle de estilo.
   *
   * Construirla absoluta (`new URL(..., req.nextUrl.origin)`) parece lo natural y muerde: el origen
   * que ve el servidor no tiene por qué ser el que el navegador está usando. Medido aquí mismo —-
   * el navegador estaba en `127.0.0.1:3100` y Next resolvió el origen como `localhost:3100`, así
   * que la redirección lo mandó a OTRO origen, las cookies se quedaron atrás y la notificación
   * aterrizaba en el login. Detrás de un proxy —- que es como corre en producción —- hay más formas
   * de que ese origen no coincida: http contra https, dominio con y sin www.
   *
   * Una ruta relativa la resuelve el navegador contra donde ya está, así que no hay nada que
   * adivinar. `NextResponse.redirect` exige una URL absoluta, de ahí la respuesta a mano.
   */
  const dest = UUID.test(conv) ? `/chat?c=${conv}` : "/chat";
  const res = new NextResponse(null, { status: 307, headers: { location: dest } });
  if (UUID.test(org)) {
    res.cookies.set(ORG_COOKIE, org, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return res;
}
