"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";

/** Global realtime watcher: shows toasts for new inbound messages and @mentions, and keeps the
 *  nav badges / notification bell fresh by refreshing server data (debounced). */
export function RealtimeNotifier({ businessId, userId, myName }: { businessId: string; userId: string; myName: string }) {
  const { push } = useToast();
  const router = useRouter();
  const tRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => { clearTimeout(tRef.current); tRef.current = setTimeout(() => router.refresh(), 300); };

    const ch = supabase
      .channel(`notify-${businessId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `business_id=eq.${businessId}` }, (payload) => {
        const m = payload.new as { direction?: string; body?: string | null; conversation_id?: string; type?: string };
        refresh();
        if (m.direction !== "in") return;
        push({ kind: "info", title: "Nuevo mensaje", message: (m.body || (m.type && m.type !== "text" ? "📎 " + m.type : "Mensaje")).slice(0, 90), href: `/chat?c=${m.conversation_id}` });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notes", filter: `business_id=eq.${businessId}` }, (payload) => {
        const n = payload.new as { author_id?: string; body?: string; parent_type?: string; parent_id?: string };
        if (!n.body || n.author_id === userId || !myName) return;
        if (n.body.includes("@" + myName)) {
          const href = n.parent_type === "order" ? `/orders?order=${n.parent_id}` : `/chat?c=${n.parent_id}`;
          push({ kind: "mention", title: "Te mencionaron", message: n.body.slice(0, 90), href });
          refresh();
        }
      })
      .subscribe();

    return () => { clearTimeout(tRef.current); supabase.removeChannel(ch); };
  }, [businessId, userId, myName, push, router]);

  return null;
}
