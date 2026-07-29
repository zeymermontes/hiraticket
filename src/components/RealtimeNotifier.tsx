"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { getToastPreview, getMediaPreviewUrl } from "@/app/(app)/chat/actions";
import { alertIncoming, requestNotifyPermissionOnce, vibrate, CALL_VIBRATION } from "@/lib/notify";
import { keepSubscribed } from "@/lib/realtime";
import { DEFAULT_NOTIF_PREFS, notifOn, type NotifPrefs } from "@/lib/notifPrefs";
import { loadNotifPrefs } from "@/app/(app)/settings/notif-actions";
export const NOTIF_PREFS_EVENT = "ht:notifprefs";

// Realtime payloads carry the STORED body — encrypted at rest (encm:v1:) for new messages. Use the
// payload text only when it's legacy plaintext; otherwise fetch the decrypted preview server-side.
const looksEncrypted = (v: unknown): boolean => typeof v === "string" && v.startsWith("encm:");
async function previewOf(kind: "wa" | "internal", id: string | undefined, raw: string | null | undefined): Promise<string> {
  if (raw && !looksEncrypted(raw)) return raw;
  if (!raw || !id) return raw ?? "";
  try { return await getToastPreview(kind, id); } catch { return ""; }
}

/** Global realtime watcher: shows toasts for new inbound messages and @mentions, and tells the
 *  Shell to refresh nav badges / the bell (debounced) — without a full route refresh. */
export function RealtimeNotifier({ businessId, userId, myName, prefs = DEFAULT_NOTIF_PREFS, onChange }: { businessId: string; userId: string; myName: string; prefs?: NotifPrefs; onChange?: () => void }) {
  const { push } = useToast();
  const tRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // En un ref: cambiar una preferencia no debe recrear el canal de realtime.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // El prop viene del layout, y Next CONSERVA el layout entre navegaciones: no se re-ejecuta al
  // volver de Ajustes, así que ese prop se queda con las preferencias del primer render y los
  // cambios no surtían efecto hasta recargar. Por eso el notificador las relee él mismo al montar
  // y escucha el aviso que emite Ajustes al guardar.
  useEffect(() => {
    let alive = true;
    loadNotifPrefs().then((p) => { if (alive && p) prefsRef.current = p; }).catch(() => {});
    const onPrefs = (e: Event) => {
      const next = (e as CustomEvent<NotifPrefs>).detail;
      if (next) prefsRef.current = next;
    };
    window.addEventListener(NOTIF_PREFS_EVENT, onPrefs);
    return () => { alive = false; window.removeEventListener(NOTIF_PREFS_EVENT, onPrefs); };
  }, []);

  // El permiso se pide al primer clic/tecla, no al montar: los navegadores ignoran o penalizan
  // la petición sin gesto previo.
  useEffect(() => { requestNotifyPermissionOnce(); }, []);

  useEffect(() => {
    const supabase = createClient();
    const notify = () => { clearTimeout(tRef.current); tRef.current = setTimeout(() => onChangeRef.current?.(), 600); };

    // keepSubscribed en vez de .subscribe(): el canal se reconecta solo con backoff y re-autentica
    // el socket. Antes, si se caía, los avisos se apagaban en silencio hasta recargar la página.
    const stop = keepSubscribed(supabase, `notify-${businessId}`, (ch) => ch
      // Las llamadas entran por INSERT (suena) y por UPDATE (al colgar pasa a perdida), por eso
      // este handler escucha los dos eventos y no solo INSERT como antes.
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, async (payload) => {
        const m = payload.new as { id?: string; direction?: string; body?: string | null; conversation_id?: string; type?: string; state?: string; wa_id?: string };
        notify();
        if (m.direction !== "in" || !m.conversation_id) return;

        if (m.type === "call") {
          if (!notifOn(prefsRef.current, "calls")) return;
          const ringing = m.state === "ringing";
          let name = "";
          try {
            const { data } = await supabase.from("conversations").select("contact:contacts(name, phone)").eq("id", m.conversation_id).maybeSingle();
            const c = (data as { contact?: unknown } | null)?.contact;
            const cc = (Array.isArray(c) ? c[0] : c) as { name?: string; phone?: string } | undefined;
            name = (cc?.name || cc?.phone || "").trim();
          } catch {}
          if (!name) name = "Número desconocido";
          const title = ringing ? `📞 Llamada de ${name}` : `📞 Llamada perdida de ${name}`;
          const href = `/chat?c=${m.conversation_id}`;
          // key estable = misma llamada: el toast de "entrante" se convierte en "perdida" en su
          // sitio en vez de dejar los dos. sticky en ambos casos, como se pidió.
          push({ kind: ringing ? "warn" : "mention", title, message: ringing ? "Llamada entrante de WhatsApp" : "No se contestó", href, sticky: true, key: `call-${m.wa_id ?? m.id}` });
          vibrate(CALL_VIBRATION);
          alertIncoming({ title, body: ringing ? "Llamada entrante" : "Llamada perdida", href, tag: `call-${m.wa_id ?? m.id}` });
          return;
        }
        if (payload.eventType !== "INSERT") return; // el resto solo avisa al llegar, no al actualizarse
        // Look up who it's from so the toast leads with the contact's name. The embedded resource
        // can come back as an object OR a single-element array depending on relationship inference.
        let name = "";
        let assignee: string | null = null;
        try {
          const { data } = await supabase.from("conversations").select("assignee_id, contact:contacts(name, phone)").eq("id", m.conversation_id).maybeSingle();
          const row = data as { assignee_id?: string | null; contact?: unknown } | null;
          assignee = row?.assignee_id ?? null;
          const c = row?.contact;
          const cc = (Array.isArray(c) ? c[0] : c) as { name?: string; phone?: string } | undefined;
          name = (cc?.name || cc?.phone || "").trim();
        } catch {}
        // Las preferencias solo contemplan "míos" y "sin asignar": un chat que ya lleva otro agente
        // no entra en ninguna de las dos, así que no interrumpe.
        const bucket = assignee === userId ? "mine" : assignee === null ? "unassigned" : null;
        if (!bucket || !notifOn(prefsRef.current, bucket)) return;
        if (!name) name = "Nuevo mensaje";
        const typeLabel: Record<string, string> = { image: "📷 Foto", sticker: "🩷 Sticker", audio: "🎤 Audio", video: "🎥 Video", document: "📄 Documento", location: "📍 Ubicación", contact: "👤 Contacto" };
        const body = await previewOf("wa", m.id, m.body);
        const preview = body || (m.type && m.type !== "text" ? typeLabel[m.type] ?? "📎 Adjunto" : "Mensaje");
        const href = `/chat?c=${m.conversation_id}`;
        // Un "🩷 Sticker" no dice cuál te mandaron. Con miniatura se entiende de un vistazo.
        let thumb: string | undefined;
        if ((m.type === "sticker" || m.type === "image") && m.id) {
          thumb = (await getMediaPreviewUrl(m.id).catch(() => null)) ?? undefined;
        }
        push({ kind: "info", title: name, message: preview.slice(0, 90), href, imageUrl: thumb });
        // Suena y avisa fuera de la pestaña. Mismo tratamiento que el chat de equipo abajo.
        alertIncoming({ title: name, body: preview.slice(0, 120), href, tag: `wa-${m.conversation_id}`, image: thumb });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, () => notify())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, async (payload) => {
        // RLS only delivers internal messages in channels this user can read (team + their DMs).
        const m = payload.new as { id?: string; author_id?: string; body?: string; mentions?: string[]; channel?: string };
        if (m.author_id === userId) return; // not your own send
        const mentionedMe = Array.isArray(m.mentions) && m.mentions.includes(userId);
        if (!notifOn(prefsRef.current, mentionedMe ? "mentions" : "internal")) return;
        const channel = m.channel ?? "team";

        // Quién escribe. Sin esto el toast decía solo "Mensaje interno" y no se sabía de quién era
        // ni en qué hilo, que es justo lo que hace falta para decidir si vale interrumpirse.
        let who = "";
        if (m.author_id) {
          try {
            const { data } = await supabase.from("profiles").select("full_name").eq("id", m.author_id).maybeSingle();
            who = ((data as { full_name?: string } | null)?.full_name ?? "").trim();
          } catch {}
        }
        if (!who) who = "Alguien";
        // En un DM el autor ES la otra persona, así que basta con etiquetar el hilo.
        const isDm = channel !== "team";
        const where = isDm ? "Directo" : "Equipo";
        const title = mentionedMe ? `📣 ${who} te mencionó · ${where}` : `${who} · ${where}`;
        // Deep link al hilo exacto (?ch=), no al chat interno genérico.
        const href = `/internal?ch=${encodeURIComponent(channel)}`;

        const body = await previewOf("internal", m.id, m.body ?? "");
        // Fijos los DMs y las menciones: van dirigidos a ti en persona y nadie más los va a
        // atender. Lo del canal de equipo sí se autocierra — ahí el volumen es otro y fijarlo
        // todo llenaría la columna de cosas que no te tocan.
        push({ kind: mentionedMe ? "mention" : "info", title, message: body.slice(0, 90), href, sticky: mentionedMe || isDm });
        // Mismo trato que un mensaje de cliente: el equipo no puede notificar menos.
        // Tag por canal para que una ráfaga en el mismo hilo no apile notificaciones.
        alertIncoming({ title, body: body.slice(0, 120), href, tag: `int-${channel}` });
        notify();
      })
      // Transferencias hacia mí. Antes no avisaba nada: te enterabas al entrar al chat.
      // Se escucha `events` (0068 lo metió a realtime y le añadió target_id) porque una
      // actualización de `conversations` no dice QUIÉN te la pasó, y sin replica identity full
      // tampoco deja ver el asignado anterior para saber si de verdad cambió.
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter: `business_id=eq.${businessId}` }, async (payload) => {
        const e = payload.new as { kind?: string; target_id?: string | null; actor_id?: string | null; parent_type?: string; parent_id?: string };
        if (e.kind === "reaction") {
          // Reaccionaron a un mensaje mío. Llega por evento y no por el UPDATE de `messages`
          // porque sin replica identity full el cliente no ve qué cambió — y ponérsela a la tabla
          // más grande haría que cada acuse de entrega escribiera la fila entera al WAL.
          if (e.target_id !== userId) return;
          if (!notifOn(prefsRef.current, "mine")) return;
          let client = "";
          try {
            const { data: conv } = await supabase.from("conversations").select("contact:contacts(name, phone)").eq("id", e.parent_id ?? "").maybeSingle();
            const c = (conv as { contact?: unknown } | null)?.contact;
            const cc = (Array.isArray(c) ? c[0] : c) as { name?: string; phone?: string } | undefined;
            client = (cc?.name || cc?.phone || "").trim();
          } catch {}
          const emoji = (e as { text?: string }).text || "👍";
          const title = `${emoji} ${client || "Alguien"} reaccionó a tu mensaje`;
          push({ kind: "info", title, message: emoji, href: `/chat?c=${e.parent_id}`, key: `react-${e.parent_id}` });
          alertIncoming({ title, body: emoji, href: `/chat?c=${e.parent_id}`, tag: `react-${e.parent_id}` });
          notify();
          return;
        }
        if (e.kind !== "swap" || e.target_id !== userId || e.actor_id === userId) return;
        if (!notifOn(prefsRef.current, "transfers")) return;
        let who = "", client = "";
        try {
          const [{ data: prof }, { data: conv }] = await Promise.all([
            supabase.from("profiles").select("full_name").eq("id", e.actor_id ?? "").maybeSingle(),
            supabase.from("conversations").select("contact:contacts(name, phone)").eq("id", e.parent_id ?? "").maybeSingle(),
          ]);
          who = ((prof as { full_name?: string } | null)?.full_name ?? "").trim();
          const c = (conv as { contact?: unknown } | null)?.contact;
          const cc = (Array.isArray(c) ? c[0] : c) as { name?: string; phone?: string } | undefined;
          client = (cc?.name || cc?.phone || "").trim();
        } catch {}
        if (!who) who = "Alguien";
        if (!client) client = "un cliente";
        // Fijo: una transferencia es trabajo que pasa a ser tuyo; perderla por mirar a otro lado
        // seis segundos es justo lo que hay que evitar.
        push({
          kind: "mention",
          title: `${who} te transfirió un chat`,
          message: client,
          href: `/chat?c=${e.parent_id}`,
          sticky: true,
          key: `xfer-${e.parent_id}`,
        });
        alertIncoming({ title: `${who} te transfirió un chat`, body: client, href: `/chat?c=${e.parent_id}`, tag: `xfer-${e.parent_id}` });
        notify();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notes", filter: `business_id=eq.${businessId}` }, (payload) => {
        const n = payload.new as { author_id?: string; body?: string; parent_type?: string; parent_id?: string };
        if (!n.body || n.author_id === userId || !myName) return;
        if (!notifOn(prefsRef.current, "mentions")) return;
        if (n.body.includes("@" + myName)) {
          const href = n.parent_type === "order" ? `/orders?order=${n.parent_id}` : `/chat?c=${n.parent_id}`;
          push({ kind: "mention", title: "Te mencionaron", message: n.body.slice(0, 90), href });
          notify();
        }
      })
      , {
      // Al reconectar, los badges y la campanita pueden haberse quedado atrás.
      onHealthy: (reconnected) => { if (reconnected) notify(); },
    });

    return () => { clearTimeout(tRef.current); stop(); };
  }, [businessId, userId, myName, push]);

  return null;
}
