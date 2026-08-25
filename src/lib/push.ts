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
 * ya existen por persona y organización en `business_members.notif_prefs` (0084). Si esa decisión
 * se copiara al worker de Go y al ingest oficial, a la primera semana dirían cosas distintas.
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
  user_id: string;
}

/** El icono coloreado de esta organización para esta persona, o el de siempre si no hay color.
 *  Los archivos se generan en el build a partir de la paleta; un color fuera de ella cae al normal. */
function orgIcon(color: string | null): string | undefined {
  if (!color) return undefined;
  const hex = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) return undefined;
  return `/icons/org/${hex.slice(1)}.png`;
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

    // Preferencias de cada quien EN ESTA organización (0084): están en la membresía, porque la
    // misma persona puede querer que le avisen de todo en un negocio y solo de menciones en otro.
    //
    // Un fallo aquí NO debe silenciar a todos: si no se pueden leer, se aplica el valor por
    // defecto, que es "avisar" —- perder un aviso es peor que mandar uno de más a quien lo tenía
    // apagado. Por eso también la caída a profiles: sin la migración, ahí es donde vivían.
    let prefsBy = new Map<string, unknown>();
    const colorBy = new Map<string, string | null>();
    const { data: mems, error: memErr } = await admin
      .from("business_members").select("user_id, notif_prefs, avatar_color")
      .eq("business_id", businessId).in("user_id", uniq);
    if (memErr) {
      const { data: profs } = await admin.from("profiles").select("id, notif_prefs").in("id", uniq);
      prefsBy = new Map((profs ?? []).map((p) => [p.id as string, p.notif_prefs]));
    } else {
      prefsBy = new Map((mems ?? []).map((m) => [m.user_id as string, m.notif_prefs]));
      for (const m of mems ?? []) colorBy.set(m.user_id as string, (m.avatar_color as string | null) ?? null);
    }
    const wants = new Map<string, boolean>();
    for (const id of uniq) {
      wants.set(id, notifOn(parseNotifPrefs(prefsBy.get(id)), pref));
    }
    const targets = uniq.filter((id) => wants.get(id));
    if (targets.length === 0) return;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .eq("business_id", businessId)
      .in("user_id", targets);
    if (!subs || subs.length === 0) return;

    /**
     * De qué organización es el aviso, y de qué color.
     *
     * El nombre solo se añade a quien está en MÁS DE UNA: para quien tiene una sola sería repetir
     * lo mismo en cada notificación. Y el color es el que esa persona eligió para esa organización
     * (0085), que es justo para lo que existe: distinguir de un vistazo en cuál está pasando algo.
     * Como la web no deja pintar una notificación, el color viaja en el ICONO —- uno por color de
     * la paleta, generados en el build (scripts/make-icons.mjs).
     */
    const [{ data: biz }, { data: allMems }] = await Promise.all([
      admin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      admin.from("business_members").select("user_id, business_id").in("user_id", targets),
    ]);
    const orgName = (biz?.name as string) ?? "";
    const orgCount = new Map<string, number>();
    for (const m of allMems ?? []) orgCount.set(m.user_id as string, (orgCount.get(m.user_id as string) ?? 0) + 1);

    // Sin color propio en esta organización se cae al del perfil, y si tampoco, al icono de siempre.
    const { data: profColors } = await admin.from("profiles").select("id, avatar_color").in("id", targets);
    const profColorBy = new Map((profColors ?? []).map((p) => [p.id as string, (p.avatar_color as string | null) ?? null]));

    const payloadFor = (userId: string) => {
      const varias = (orgCount.get(userId) ?? 1) > 1;
      const color = colorBy.get(userId) || profColorBy.get(userId) || null;
      return JSON.stringify({
        ...payload,
        title: varias && orgName ? `${payload.title} · ${orgName}` : payload.title,
        icon: orgIcon(color),
        at: new Date().toISOString(),
      });
    };
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
          payloadFor(s.user_id),
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
      // Pasa por /chat/open para CAMBIAR de organización antes de abrir el chat: si el aviso es de
      // una y estás parado en la otra, la conversación no existe para ti y no se abriría nada.
      href: `/chat/open?c=${opts.conversationId}&org=${opts.businessId}`,
      // Por conversación: diez mensajes seguidos de la misma persona dejan UNA notificación, la
      // última, en vez de diez que hay que barrer una por una.
      tag: `wa-${opts.conversationId}`,
      vibrate: opts.vibrate,
    }, pref);
  } catch {
    // idem: nunca romper lo que lo llamó
  }
}

/**
 * Aviso de que un chat pasó a ser TUYO.
 *
 * Hasta ahora la transferencia solo existía como toast: `RealtimeNotifier` escucha el evento `swap`
 * y pinta un aviso. Eso es el navegador reaccionando, así que con la app cerrada —- que es cuando
 * de verdad hace falta —- no llegaba nada, y con varias organizaciones tampoco llegaba con la app
 * ABIERTA: el notificador está suscrito al `business_id` de la organización que tienes puesta, así
 * que de la otra no oye nada. Este es el servidor empujando, y no le importa dónde estés parado.
 *
 * Se acepta una LISTA de conversaciones porque la transferencia masiva existe: veinte chats a la
 * misma persona tienen que ser un aviso, no veinte.
 *
 * `targetId` puede ser null (quitar la asignación, o un área sin agente de ruteo): ahí no hay a
 * quién avisar y no es un error. Tampoco se avisa a quien hizo la transferencia —- ya lo sabe.
 */
export async function pushTransfer(opts: {
  businessId: string;
  actorId: string | null;
  targetId: string | null;
  conversationIds: string[];
  /** Nombre del área, cuando la transferencia fue a un área y esta enruta a esta persona. */
  areaName?: string | null;
}): Promise<void> {
  const { businessId, actorId, targetId, conversationIds } = opts;
  if (!pushConfigured() || !targetId || !conversationIds.length) return;
  if (targetId === actorId) return;
  const admin = createAdminClient();
  try {
    const n = conversationIds.length;
    const [{ data: prof }, { data: convs }] = await Promise.all([
      actorId
        ? admin.from("profiles").select("full_name").eq("id", actorId).maybeSingle()
        : Promise.resolve({ data: null }),
      // Solo hacen falta los nombres para el cuerpo; con tres basta para que se entienda de qué va.
      admin.from("conversations").select("contact:contacts(name, phone)").in("id", conversationIds.slice(0, 3)),
    ]);
    const who = ((prof as { full_name?: string } | null)?.full_name ?? "").trim() || "Alguien";
    const names = (convs ?? []).map((c) => {
      const raw = (c as { contact?: unknown }).contact;
      const cc = (Array.isArray(raw) ? raw[0] : raw) as { name?: string; phone?: string } | undefined;
      return (cc?.name || cc?.phone || "").trim();
    }).filter(Boolean);

    const area = (opts.areaName ?? "").trim();
    const title = n === 1
      ? (area ? `${who} te pasó un chat de ${area}` : `${who} te transfirió un chat`)
      : `${who} te transfirió ${n} chats`;
    // Con más de tres, los que faltan se cuentan en vez de listarse: el cuerpo de una notificación
    // se corta a las dos líneas y una lista larga solo tapa el nombre de quien la mandó.
    const body = names.length
      ? (n > names.length ? `${names.join(", ")} y ${n - names.length} más` : names.join(", "))
      : (n === 1 ? "un cliente" : `${n} chats`);

    await sendPushToUsers(businessId, [targetId], {
      title,
      body,
      // Una sola lleva al chat; varias, a la lista —- abrir una de veinte al azar no ayuda. En los
      // dos casos por /chat/open, que cambia de organización antes de entrar: el aviso puede ser de
      // una organización distinta a la que tienes abierta, que es justo el caso que esto arregla.
      href: n === 1 ? `/chat/open?c=${conversationIds[0]}&org=${businessId}` : `/chat/open?org=${businessId}`,
      // Mismo tag que el aviso en vivo del navegador (`xfer-…` en RealtimeNotifier): si la app está
      // abierta, el push reemplaza al toast en la bandeja del sistema en vez de duplicarlo.
      tag: n === 1 ? `xfer-${conversationIds[0]}` : `xfer-bulk-${businessId}`,
    }, "transfers");
  } catch {
    // Un aviso que no sale no puede tumbar la transferencia que lo disparó.
  }
}
