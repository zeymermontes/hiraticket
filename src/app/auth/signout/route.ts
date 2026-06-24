import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/url";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Use the public host (not the internal localhost:PORT behind the proxy).
  return NextResponse.redirect(`${publicOrigin(request)}/login`, { status: 303 });
}
