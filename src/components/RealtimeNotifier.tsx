"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { getToastPreview } from "@/app/(app)/chat/actions";

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
export function RealtimeNotifier({ businessId, userId, myName, onChange }: { businessId: string; userId: string; myName: string; onChange?: () => void }) {
  const { push } = useToast();
  const tRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    const notify = () => { clearTimeout(tRef.current); tRef.current = setTimeout(() => onChangeRef.current?.(), 600); };

    const ch = supabase
      .channel(`notify-${businessId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, async (payload) => {
        const m = payload.new as { id?: string; direction?: string; body?: string | null; conversation_id?: string; type?: string };
        notify();
        if (m.direction !== "in" || !m.conversation_id) return;
        // Look up who it's from so the toast leads with the contact's name. The embedded resource
        // can come back as an object OR a single-element array depending on relationship inference.
        let name = "";
        try {
          const { data } = await supabase.from("conversations").select("contact:contacts(name, phone)").eq("id", m.conversation_id).maybeSingle();
          const c = (data as { contact?: unknown } | null)?.contact;
          const cc = (Array.isArray(c) ? c[0] : c) as { name?: string; phone?: string } | undefined;
          name = (cc?.name || cc?.phone || "").trim();
        } catch {}
        if (!name) name = "Nuevo mensaje";
        const typeLabel: Record<string, string> = { image: "📷 Foto", sticker: "🩷 Sticker", audio: "🎤 Audio", video: "🎥 Video", document: "📄 Documento", location: "📍 Ubicación", contact: "👤 Contacto" };
        const body = await previewOf("wa", m.id, m.body);
        const preview = body || (m.type && m.type !== "text" ? typeLabel[m.type] ?? "📎 Adjunto" : "Mensaje");
        push({ kind: "info", title: name, message: preview.slice(0, 90), href: `/chat?c=${m.conversation_id}` });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, () => notify())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "internal_messages", filter: `business_id=eq.${businessId}` }, async (payload) => {
        // RLS only delivers internal messages in channels this user can read (team + their DMs).
        const m = payload.new as { id?: string; author_id?: string; body?: string; mentions?: string[] };
        if (m.author_id === userId) return; // not your own send
        const mentionedMe = Array.isArray(m.mentions) && m.mentions.includes(userId);
        const body = await previewOf("internal", m.id, m.body ?? "");
        push(mentionedMe
          ? { kind: "mention", title: "📣 Te mencionaron (equipo)", message: body.slice(0, 90), href: "/internal" }
          : { kind: "info", title: "💬 Mensaje interno", message: body.slice(0, 90), href: "/internal" });
        notify();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notes", filter: `business_id=eq.${businessId}` }, (payload) => {
        const n = payload.new as { author_id?: string; body?: string; parent_type?: string; parent_id?: string };
        if (!n.body || n.author_id === userId || !myName) return;
        if (n.body.includes("@" + myName)) {
          const href = n.parent_type === "order" ? `/orders?order=${n.parent_id}` : `/chat?c=${n.parent_id}`;
          push({ kind: "mention", title: "Te mencionaron", message: n.body.slice(0, 90), href });
          notify();
        }
      })
      .subscribe();

    return () => { clearTimeout(tRef.current); supabase.removeChannel(ch); };
  }, [businessId, userId, myName, push]);

  return null;
}
