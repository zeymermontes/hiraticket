import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /logout — clears the Supabase session and returns to the login screen.
// The prototype's "sign out" link (and Landing's "sign in") break out of the
// app to here so auth stays in sync with Supabase.
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
