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

  // Upsert por (organización, endpoint): el navegador reusa el mismo endpoint al volver a
  // suscribir, y sin upsert cada "activar" dejaría una fila más apuntando al mismo aparato. La
  // organización va en la llave porque un aparato puede recibir de VARIAS —- con `endpoint` a
  // secas, activar en la segunda pisaba en silencio la suscripción de la primera. Ver 0083.
  const row = {
    business_id: business.id,
    user_id: user.id,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    ua: (sub.ua ?? "").slice(0, 300) || null,
    last_seen_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "business_id,endpoint" });
  // Con 0083 sin aplicar todavía, esa llave no existe y Postgres rechaza el ON CONFLICT. Se cae a
  // la de 0082 para que un despliegue que llegue antes que la migración no deje a nadie sin poder
  // activar los avisos —- misma cascada que el resto del código ante una columna que aún no está.
  if (error) ({ error } = await supabase.from("push_subscriptions").upsert(row, { onConflict: "endpoint" }));

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Baja de ESTA organización en este navegador.
 *
 * Con varias organizaciones ya no vale borrar por endpoint a secas: el mismo aparato puede estar
 * recibiendo avisos de dos, y apagarlos en una no puede apagar la otra. Pero la suscripción del
 * NAVEGADOR es una sola y compartida, así que solo se puede soltar cuando no queda ninguna
 * organización usándola —- por eso se devuelve `remaining`, para que quien llama sepa si además
 * tiene que darse de baja en el navegador.
 */
export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean; remaining: number }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !endpoint || !business) return { ok: false, remaining: 0 };
  const { error } = await supabase.from("push_subscriptions").delete()
    .eq("endpoint", endpoint).eq("user_id", user.id).eq("business_id", business.id);
  return { ok: !error, remaining: await stillUsing(endpoint, user.id) };
}

/** Quita un aparato de la lista de Ajustes (la papelera). Mismo criterio que arriba. */
export async function removePushDevice(id: string): Promise<{ ok: boolean; remaining: number }> {
  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user || !id) return { ok: false, remaining: 0 };
  const { data: row } = await supabase.from("push_subscriptions").select("endpoint").eq("id", id).eq("user_id", user.id).maybeSingle();
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", id).eq("user_id", user.id);
  const endpoint = (row?.endpoint as string) ?? "";
  return { ok: !error, remaining: endpoint ? await stillUsing(endpoint, user.id) : 0 };
}

/** ¿Cuántas organizaciones siguen apuntando a este endpoint? */
async function stillUsing(endpoint: string, userId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("push_subscriptions")
    .select("id", { count: "exact", head: true }).eq("endpoint", endpoint).eq("user_id", userId);
  return count ?? 0;
}

/** Los dispositivos en los que esta persona activó las notificaciones, EN ESTA organización.
 *  Sin filtrar por negocio, quien está en dos vería el mismo teléfono repetido una vez por cada
 *  una, sin nada que las distinga. */
export async function listPushDevices(currentEndpoint?: string): Promise<PushDevice[]> {
  const supabase = await createClient();
  const user = await getSessionUser();
  const business = await getMyBusiness();
  if (!user || !business) return [];
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, ua, created_at, endpoint")
    .eq("user_id", user.id)
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });
  if (error) return []; // 0082 sin aplicar todavía
  return (data ?? []).map((d) => ({
    id: d.id as string,
    ua: (d.ua as string | null) ?? null,
    created_at: d.created_at as string,
    current: !!currentEndpoint && d.endpoint === currentEndpoint,
  }));
}
