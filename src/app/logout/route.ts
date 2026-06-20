import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /logout — clears the Supabase session and returns to the login screen.
// The prototype's "sign out" link (and Landing's "sign in") break out of the
// app to here so auth stays in sync with Supabase.
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Behind a proxy (Render/Vercel) request.url's origin is the internal localhost:PORT, so use the
  // forwarded host/proto when present — otherwise the redirect lands on localhost.
  const { origin } = new URL(request.url);
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base = fwdHost ? `${fwdProto}://${fwdHost}` : origin;
  return NextResponse.redirect(`${base}/login`);
}
