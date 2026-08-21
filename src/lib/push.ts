import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseNotifPrefs, notifOn, type NotifPrefs } from "@/lib/notifPrefs";

/**
 * Envío de notificaciones push desde el SERVIDOR.
 *
 * El cambio de fondo respecto a lo que había: `RealtimeNotifier` es el navegador REACCIONANDO a
 * Supabase, así que solo avisa con la pestaña abierta. Esto es el servidor EMPUJANDO, y por eso
 * llega con la app cerrada —- que es lo único que un agente necesita de verdad cuando no está
 * frente a la computadora.
 *
 * A quién le toca cada aviso se decide AQUÍ y en un solo lugar, reutilizando las preferencias que
 * ya existen por usuario en `profiles.notif_prefs` (0068). Si esa decisión se copiara al worker de
 * Go y al ingest oficial, a la primera semana dirían cosas distintas.
 *
 * Nada de esto puede tumbar un mensaje: todas las funciones tragan sus errores. Un push que falla
 * es un aviso que no llegó; un ingest que falla es un mensaje perdido. No se juegan lo mismo.
 */

let configured: boolean | null = null;

/** ¿Hay claves VAPID? Sin ellas el push simplemente no existe y la app sigue igual que antes. */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  // El "subject" es un contacto que los servidores de push (Google, Apple, Mozilla) usan para
  // avisarte si tu tráfico les está causando problemas. Tiene que ser mailto: o https:.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:soporte@hiraticket.com", pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** A dónde lleva el toque. Relativo, lo resuelve el service worker. */
  href?: string;
  /** Mismo tag = la nueva reemplaza a la anterior (20 mensajes de un chat = 1 notificación). */
  tag?: string;
  vibrate?: number[];
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * ¿Las claves de esta suscripción sirven?
 *
 * Se comprueba ANTES de intentar el envío, y no se deduce del error, por algo que salió probando en
 * local: una fila con la `p256dh` corrupta hace que `web-push` reviente al cifrar —- antes de tocar
 * la red —- y ese error NO trae `statusCode`. La limpieza de suscripciones muertas solo mira
 * 404/410, así que una fila así se quedaba para siempre y se reintentaba en CADA mensaje.
 *
 * Se valida contra el contrato real en vez de leer el mensaje del error: `p256dh` es un punto P-256
 * sin comprimir (65 bytes) y `auth` son 16 bytes. Adivinar por el texto del error se rompe en
 * cuanto la librería cambia de redacción.
 */
function validKeys(s: SubRow): boolean {
  try {
    return Buffer.from(s.p256dh, "base64url").length === 65
      && Buffer.from(s.auth, "base64url").length === 16
      && /^https:\/\//.test(s.endpoint);
  } catch { return false; }
}

/**
 * Empuja a todos los dispositivos de estos usuarios.
 *
 * `pref` es la preferencia que hay que respetar (`mine`, `unassigned`, `internal`, …). Se lee de
 * cada perfil: dos agentes pueden querer cosas distintas del mismo evento.
 */
export async function sendPushToUsers(
  businessId: string,
  userIds: string[],
  payload: PushPayload,
  pref: Exclude<keyof NotifPrefs, "all">,
): Promise<void> {
  if (!pushConfigured() || userIds.length === 0) return;
  const admin = createAdminClient();

  try {
    const uniq = [...new Set(userIds)].filter(Boolean);

    // Preferencias de cada quien. Un fallo aquí NO debe silenciar a todos: si no se pueden leer,
    // se aplica el valor por defecto, que es "avisar" —- perder un aviso es peor que mandar uno de
    // más a quien lo tenía apagado.
    const { data: profs } = await admin.from("profiles").select("id, notif_prefs").in("id", uniq);
    const wants = new Map<string, boolean>();
    for (const id of uniq) {
      const raw = (profs ?? []).find((p) => p.id === id)?.notif_prefs;
      wants.set(id, notifOn(parseNotifPrefs(raw), pref));
    }
    const targets = uniq.filter((id) => wants.get(id));
    if (targets.length === 0) return;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("business_id", businessId)
      .in("user_id", targets);
    if (!subs || subs.length === 0) return;

    const body = JSON.stringify({ ...payload, at: new Date().toISOString() });
    const dead: string[] = [];

    // Las que ni siquiera pueden cifrarse se descartan aquí: no hay a qué reintentar y así no
    // vuelven a costar en el siguiente mensaje.
    const usable = (subs as SubRow[]).filter((s) => {
      if (validKeys(s)) return true;
      dead.push(s.id);
      return false;
    });

    await Promise.all(usable.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 60 * 12 }, // 12 h: pasado eso, el aviso ya no le sirve a nadie
        );
      } catch (e) {
        // 404/410 = la suscripción murió (app desinstalada, permiso revocado, navegador la rotó).
        // Es la ÚNICA forma de enterarse, así que se aprovecha para limpiar; si no, la tabla se
        // llena de endpoints muertos y cada envío paga el intento.
        //
        // Cualquier otro código (429, 500, red caída) se DEJA: puede ser pasajero, y borrar por un
        // tropiezo del servicio de push desactivaría los avisos de alguien sin que se entere.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }));

    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  } catch {
    // Un aviso que no sale no puede tumbar lo que lo disparó.
  }
}

/**
 * A quién avisar de un mensaje entrante de WhatsApp, y con qué preferencia.
 *
 * Misma regla que ya usan las insignias en `getChatBadges`: si el chat tiene dueño, es asunto suyo
 * (`mine`); si no lo ha tomado nadie, es de todo el equipo (`unassigned`). Se replica el criterio,
 * no el código, porque aquí hace falta la LISTA de ids y allá solo el conteo.
 */
export async function pushInboundMessage(opts: {
  businessId: string;
  conversationId: string;
  title: string;
  body: string;
  vibrate?: number[];
}): Promise<void> {
  if (!pushConfigured()) return;
  const admin = createAdminClient();
  try {
    const { data: conv } = await admin
      .from("conversations")
      .select("assignee_id, muted")
      .eq("id", opts.conversationId)
      .maybeSingle();
    if (!conv) return;
    // "Dejar de escuchar" tiene que valer también para el push, o el silencio no sería silencio.
    if ((conv as { muted?: boolean }).muted) return;

    const assignee = (conv as { assignee_id?: string | null }).assignee_id ?? null;
    let userIds: string[];
    let pref: Exclude<keyof NotifPrefs, "all">;
    if (assignee) {
      userIds = [assignee];
      pref = "mine";
    } else {
      const { data: members } = await admin
        .from("business_members")
        .select("user_id")
        .eq("business_id", opts.businessId);
      userIds = (members ?? []).map((m) => m.user_id as string);
      pref = "unassigned";
    }

    await sendPushToUsers(opts.businessId, userIds, {
      title: opts.title,
      body: opts.body,
      href: `/chat?c=${opts.conversationId}`,
      // Por conversación: diez mensajes seguidos de la misma persona dejan UNA notificación, la
      // última, en vez de diez que hay que barrer una por una.
      tag: `wa-${opts.conversationId}`,
      vibrate: opts.vibrate,
    }, pref);
  } catch {
    // idem: nunca romper lo que lo llamó
  }
}
