import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Exchanges the auth code (magic link / OAuth / email confirm / recovery) for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/chat";

  // Behind a proxy (Render/Vercel) `request.url`'s origin is the internal host
  // (e.g. http://localhost:10000), so prefer the forwarded host/proto when present —
  // otherwise the redirect lands on localhost instead of the public domain.
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base = fwdHost ? `${fwdProto}://${fwdHost}` : origin;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?error=auth`);
}
