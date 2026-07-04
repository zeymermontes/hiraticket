import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptBody } from "@/lib/msgcrypto";

export const dynamic = "force-dynamic";

// GET /chat/backfill?conv=<id>[&before=<iso>] — a lean, RLS-scoped page of decrypted message text
// for the device search cache. Deliberately a ROUTE HANDLER, not a server action: React serializes
// server actions per client, so a background backfill on actions would queue ahead of the UI's
// realtime refetches (new-message merge, read marks, list previews) and freeze them.
export async function GET(req: NextRequest) {
  const conv = req.nextUrl.searchParams.get("conv");
  const before = req.nextUrl.searchParams.get("before");
  if (!conv) return NextResponse.json({ messages: [] });
  const supabase = await createClient();

  const page = (cols: string) => {
    let q = supabase.from("messages").select(cols).eq("conversation_id", conv).order("created_at", { ascending: false }).limit(50);
    if (before) q = q.lt("created_at", before);
    return q;
  };
  let { data, error } = await page("id, business_id, body, direction, created_at, sender_name, deleted");
  if (error) ({ data, error } = await page("id, business_id, body, direction, created_at, deleted")); // sender_name (0032) not applied yet
  if (error) return NextResponse.json({ messages: [] });

  const messages = ((data ?? []) as unknown as Record<string, unknown>[])
    .filter((m) => !m.deleted && m.body)
    .map((m) => ({
      id: m.id as string,
      body: decryptBody(m.business_id as string, m.body as string),
      senderName: (m.sender_name as string | null) ?? null,
      dir: (m.direction as string) === "out" ? "out" : "in",
      ts: m.created_at as string,
    }))
    .filter((m) => m.body);
  // Cursor/paging math needs the raw page size (before the text filters above).
  return NextResponse.json({ messages, pageSize: (data ?? []).length, oldest: (data ?? []).length ? (data![data!.length - 1] as { created_at?: string }).created_at ?? null : null });
}
