import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// `/manifest.webmanifest` tiene que estar aquí aunque la app sea privada: el navegador pide el
// manifest SIN las cookies de sesión (el <link rel="manifest"> no las manda salvo que se pida
// `use-credentials`), así que con la puerta cerrada recibía el HTML de /login, no podía leerlo
// —- "Manifest: Syntax error" en la consola —- y sin manifest legible Chrome no ofrece instalar
// NADA. Ese era el "no me dio opción de instalar la app". No filtra nada: dentro solo hay el
// nombre, los colores y los iconos.
const PUBLIC_PATHS = ["/", "/login", "/auth", "/logout", "/favicon.ico", "/pay", "/api/plugins", "/api/whatsapp", "/privacy", "/terms", "/manifest.webmanifest"];

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
