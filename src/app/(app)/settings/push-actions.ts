"use server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getMyBusiness } from "@/lib/queries";

/**
 * Alta y baja de este dispositivo para recibir push.
 *
 * Va por acción de servidor y no por API para que la sesión (y por tanto RLS) mande: cada quien
 * solo puede registrar y borrar SUS propias suscripciones. Ver la política de 0082.
 */

export interface PushDevice {
  id: string;
  ua: string | null;
  created_at: string;
  /** true si es ESTE navegador —- para poder decir "este dispositivo" en la lista. */
  current?: boolean;
}

export async function savePushSubscription(sub: {
  endpoint: string; p256dh: string; auth: string; ua?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !business) return { ok: false, error: "no-session" };
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { ok: false, error: "bad-subscription" };

  // Upsert por endpoint: el navegador reusa el mismo al volver a suscribir, y sin esto cada
  // "activar" dejaría una fila más apuntando al mismo aparato.
  const { error } = await supabase.from("push_subscriptions").upsert({
    business_id: business.id,
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    ua: (sub.ua ?? "").slice(0, 300) || null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user || !endpoint) return { ok: false };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", user.id);
  return { ok: !error };
}

export async function removePushDevice(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user || !id) return { ok: false };
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", id).eq("user_id", user.id);
  return { ok: !error };
}

/** Los dispositivos en los que esta persona activó las notificaciones. */
export async function listPushDevices(currentEndpoint?: string): Promise<PushDevice[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, ua, created_at, endpoint")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return []; // 0082 sin aplicar todavía
  return (data ?? []).map((d) => ({
    id: d.id as string,
    ua: (d.ua as string | null) ?? null,
    created_at: d.created_at as string,
    current: !!currentEndpoint && d.endpoint === currentEndpoint,
  }));
}
