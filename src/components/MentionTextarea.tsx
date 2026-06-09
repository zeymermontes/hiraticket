"use client";
import React, { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { Agent } from "@/lib/chat";

/** Textarea with @mention autocomplete of agents (shared by chat notes and order notes). */
export function MentionTextarea({
  value, onChange, agents, placeholder, rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  agents: Agent[];
  placeholder?: string;
  rows?: number;
}) {
  const { lang } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ q: string; at: number } | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [sel, setSel] = useState(0);

  function detect(v: string, caret: number) {
    const before = v.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\d]*)$/u);
    if (m) {
      setMenu({ q: m[1], at: caret - m[1].length - 1 });
      setSel(0);
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 270), left: r.left, width: Math.min(300, Math.max(220, r.width)) });
      }
    } else setMenu(null);
  }
  const filtered = menu ? agents.filter((a) => a.name.toLowerCase().includes(menu.q.toLowerCase())) : [];
  function insert(a: Agent) {
    const el = ref.current;
    if (!el || !menu) return;
    const caret = el.selectionStart;
    const text = "@" + a.name + " ";
    const next = value.slice(0, menu.at) + text + value.slice(caret);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => { el.focus(); const p = menu.at + text.length; el.setSelectionRange(p, p); });
  }

  return (
    <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
      <textarea ref={ref} className="bare" rows={rows} style={{ fontSize: 13, width: "100%" }} placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => {
          if (menu && filtered.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % filtered.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + filtered.length) % filtered.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(filtered[sel]); }
            else if (e.key === "Escape") setMenu(null);
          }
        }}
        onBlur={() => setTimeout(() => setMenu(null), 150)} />
      {menu && filtered.length > 0 && pos && (
        <div className="menu scroll" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: 240, zIndex: 1000 }}>
          <div className="menu-label">{lang === "es" ? "Mencionar" : "Mention"}</div>
          {filtered.map((a, i) => (
            <button type="button" key={a.id} className={"menu-item" + (i === sel ? " on" : "")} style={i === sel ? { background: "var(--surface-2)" } : undefined}
              onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); insert(a); }}>
              <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={22} />{a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
