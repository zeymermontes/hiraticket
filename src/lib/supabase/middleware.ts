import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// `/manifest.webmanifest` tiene que estar aquí aunque la app sea privada: el navegador pide el
// manifest SIN las cookies de sesión (el <link rel="manifest"> no las manda salvo que se pida
// `use-credentials`), así que con la puerta cerrada recibía el HTML de /login, no podía leerlo
// —- "Manifest: Syntax error" en la consola —- y sin manifest legible Chrome no ofrece instalar
// NADA. Ese era el "no me dio opción de instalar la app". No filtra nada: dentro solo hay el
// nombre, los colores y los iconos.
const PUBLIC_PATHS = ["/", "/login", "/auth", "/logout", "/favicon.ico", "/pay", "/api/plugins", "/api/whatsapp", "/privacy", "/terms", "/manifest.webmanifest",
  // El disparador de push del worker. Tiene que estar aquí por lo mismo que los otros webhooks:
  // quien llama es un SERVICIO, no una persona, y no trae cookie de sesión. Sin esto el guarda lo
  // redirigía a /login —- un 307 que el worker seguía con POST y acababa en 405 —- así que ningún
  // aviso llegaba nunca, y sin ruido: la ruta respondía "ok" a un sitio que no era ella. La puerta
  // de esta ruta es su propio secreto compartido, y sin secreto configurado queda CERRADA.
  "/api/push",
  // Solo devuelve qué versión está desplegada, que ya viaja en el HTML de la portada. Público
  // porque es lo que consulta una pestaña para saber si hay actualización: si la sesión caducó,
  // rebotar esa comprobación al login la deja muda justo cuando más falta hace.
  "/api/version"];

// Where authenticated users land — the native app home.
const APP_HOME = "/chat";

/** Refreshes the Supabase session and gates protected routes. */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = APP_HOME;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
