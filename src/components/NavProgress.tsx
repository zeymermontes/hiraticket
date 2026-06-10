"use client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Thin top progress bar that shows the instant you click a cross-section link, so navigation
 *  feels acknowledged immediately (clears when the new route renders). Same-page query changes
 *  (e.g. switching chats via ?c) don't trigger it — those are already instant. */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);

  // Route finished changing → done.
  useEffect(() => { setActive(false); }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      const href = a?.getAttribute("href");
      if (!a || !href || a.target === "_blank") return;
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) return;
      try {
        const url = new URL(href, location.origin);
        if (url.pathname === location.pathname) return; // same section (e.g. chat ?c switch)
      } catch { return; }
      setActive(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!active) return null;
  return <div className="nav-progress" aria-hidden />;
}
