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
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, (payload) => {
        const m = payload.new as { direction?: string; body?: string | null; conversation_id?: string; type?: string };
        notify();
        if (m.direction !== "in") return;
        push({ kind: "info", title: "Nuevo mensaje", message: (m.body || (m.type && m.type !== "text" ? "📎 " + m.type : "Mensaje")).slice(0, 90), href: `/chat?c=${m.conversation_id}` });
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
