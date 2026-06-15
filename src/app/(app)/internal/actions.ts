"use server";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/queries";
import { getInternalThreads, getInternalMessages, type InternalThread, type InternalMsg } from "@/lib/internal";
import type { Agent } from "@/lib/chat";

async function ctx() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const biz = await getMyBusiness();
  return { supabase, userId: user?.id ?? null, businessId: biz?.id ?? null };
}

export async function loadInternalThreads(): Promise<{ threads: InternalThread[]; agents: Agent[]; meId: string } | null> {
  const { userId, businessId } = await ctx();
  if (!userId || !businessId) return null;
  const { threads, agents } = await getInternalThreads(businessId, userId);
  return { threads, agents, meId: userId };
}

export async function loadInternalMessages(channel: string, before?: string): Promise<InternalMsg[]> {
  const { businessId } = await ctx();
  if (!businessId) return [];
  return getInternalMessages(businessId, channel, { before });
}

export async function sendInternalMessage(channel: string, body: string, mentions?: string[]): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  await supabase.from("internal_messages").insert({
    business_id: businessId, channel, author_id: userId, body: text, mentions: mentions ?? [],
  });
  // Author has implicitly "read" their own send.
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}

export async function markInternalRead(channel: string): Promise<void> {
  const { supabase, userId, businessId } = await ctx();
  if (!userId || !businessId) return;
  await supabase.from("internal_reads").upsert({ business_id: businessId, user_id: userId, channel, last_read_at: new Date().toISOString() });
}
