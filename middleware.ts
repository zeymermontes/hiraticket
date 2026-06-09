import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static, _next/image (Next internals)
     * - image/font assets
     */
    // Run on documents (incl. /app/*.html so the app is auth-gated) but skip
    // static assets — including the prototype's .js/.jsx/.css under /app.
    "/((?!_next/static|_next/image|.*\\.(?:js|jsx|css|map|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
