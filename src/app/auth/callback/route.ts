import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin, safeNext } from "@/lib/url";

// Exchanges the auth code (magic link / OAuth / email confirm / recovery) for a session.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const base = publicOrigin(request); // public host (not the internal localhost:PORT behind the proxy)

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?error=auth`);
}
