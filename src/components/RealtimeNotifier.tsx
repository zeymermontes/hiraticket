"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";

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
        const m = payload.new as { direction?: string; body?: string | null; conversation_id?: string; type?: string };
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
        const preview = m.body || (m.type && m.type !== "text" ? typeLabel[m.type] ?? "📎 Adjunto" : "Mensaje");
        push({ kind: "info", title: name, message: preview.slice(0, 90), href: `/chat?c=${m.conversation_id}` });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, () => notify())
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
