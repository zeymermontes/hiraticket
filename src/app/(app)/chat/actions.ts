"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

async function businessOf(convId: string): Promise<string | null> {
  const { supabase } = await ctx();
  const { data } = await supabase
    .from("conversations")
    .select("business_id")
    .eq("id", convId)
    .maybeSingle();
  return (data?.business_id as string) ?? null;
}

export async function sendMessage(convId: string, text: string): Promise<void> {
  const body = text.trim();
  if (!body) return;
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  await supabase.from("messages").insert({
    business_id: businessId,
    conversation_id: convId,
    direction: "out",
    type: "text",
    body,
    author_id: userId,
    // 'queued' → the WhatsApp worker picks it up and sends it, then flips to 'sent'.
    state: "queued",
  });
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", convId);

  revalidatePath("/chat");
}

export async function setConvStatus(
  convId: string,
  status: "open" | "pending" | "resolved",
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  await supabase
    .from("conversations")
    .update({ status, unread: status === "resolved" ? 0 : undefined })
    .eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: status === "resolved" ? "check" : "status",
    text: `Estado → ${status}`,
  });
  revalidatePath("/chat");
}

export async function acceptConv(convId: string): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("conversations").update({ assignee_id: userId }).eq("id", convId);
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: "user",
    text: "Aceptado",
  });
  revalidatePath("/chat");
}

export async function addConvNote(convId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;
  await supabase.from("notes").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    author_id: userId,
    body: text,
  });
  revalidatePath("/chat");
}

export async function transferConv(
  convId: string,
  mode: "agent" | "area",
  destId: string,
): Promise<void> {
  const { supabase, userId } = await ctx();
  const businessId = await businessOf(convId);
  if (!businessId) return;

  if (mode === "agent") {
    await supabase.from("conversations").update({ assignee_id: destId }).eq("id", convId);
  } else {
    // Route to the area's default agent, if set.
    const { data: area } = await supabase
      .from("areas").select("route_to").eq("id", destId).maybeSingle();
    await supabase
      .from("conversations")
      .update({ area_id: destId, assignee_id: (area?.route_to as string) ?? null })
      .eq("id", convId);
  }
  await supabase.from("events").insert({
    business_id: businessId,
    parent_type: "conversation",
    parent_id: convId,
    actor_id: userId,
    kind: "swap",
    text: "Transferido",
  });
  revalidatePath("/chat");
}
