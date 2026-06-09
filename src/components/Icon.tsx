"use client";
import React from "react";

// Ported verbatim from the prototype's components.jsx icon set.
const P = (d: string, extra?: Record<string, unknown>) =>
  React.createElement(
    "path",
    Object.assign(
      {
        d,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      extra,
    ),
  );

type IconFn = () => React.ReactNode;

export const ICONS: Record<string, IconFn> = {
  chat: () => <>{P("M21 11.5a8.4 8.4 0 0 1-12.1 7.5L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5Z")}</>,
  orders: () => <>{P("M8 4h8a2 2 0 0 1 2 2v13a1 1 0 0 1-1.5.9L15 19l-1.5 1-1.5-1-1.5 1L9 19l-1.5.9A1 1 0 0 1 6 19V6a2 2 0 0 1 2-2Z")}{P("M9.5 9h5M9.5 12.5h5")}</>,
  kanban: () => <>{P("M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z")}</>,
  agents: () => <>{P("M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19")}<circle cx="10" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15 5.2a3.2 3.2 0 0 1 0 6")}</>,
  canned: () => <>{P("M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6A2.5 2.5 0 0 1 17.5 15H10l-4 3.5V15H6.5A2.5 2.5 0 0 1 4 12.5Z")}{P("M8.5 8h7M8.5 11h4")}</>,
  settings: () => <><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 6.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H11a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z")}</>,
  search: () => <><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("m20 20-3.2-3.2")}</>,
  bell: () => <>{P("M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5ZM10 19a2 2 0 0 0 4 0")}</>,
  at: () => <>{P("M16 12a4 4 0 1 0-1.2 2.85M16 8v4.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1")}</>,
  plus: () => <>{P("M12 5v14M5 12h14")}</>,
  qr: () => <>{P("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z")}{P("M14 14h2v2h-2zM18 14h2M20 14v6M14 18h2v2M18 18h2")}</>,
  whatsapp: () => <><path d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.2 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" />{P("M9 7.8c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3c-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.6.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a5.8 5.8 0 0 1-1.7-1.1 6.5 6.5 0 0 1-1.2-1.5c-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4Z")}</>,
  send: () => <>{P("M5 12 20 5l-4 15-4-6-7-2Z")}{P("m12 14 4-5")}</>,
  swap: () => <>{P("M7 8h12l-3-3M17 16H5l3 3")}</>,
  clock: () => <><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M12 8v4.3l2.8 1.7")}</>,
  check: () => <>{P("m5 12.5 4.5 4.5L19 7")}</>,
  chevd: () => <>{P("m6 9 6 6 6-6")}</>,
  filter: () => <>{P("M4 5h16l-6 7.5V19l-4 1.5v-8L4 5Z")}</>,
  x: () => <>{P("M6 6 18 18M18 6 6 18")}</>,
  sun: () => <><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4")}</>,
  moon: () => <>{P("M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z")}</>,
  calendar: () => <><rect x="4" y="5" width="16" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M4 9h16M8 3v3M16 3v3")}</>,
  layers: () => <>{P("m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5")}</>,
  store: () => <>{P("M5 9.5 6 5h12l1 4.5M5 9.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5M5 9.5a2.2 2.2 0 0 0 4.5 0 2.2 2.2 0 0 0 4.5 0 2.2 2.2 0 0 0 4.5 0")}</>,
  sliders: () => <>{P("M5 8h9M5 16h4M16 16h3")}<circle cx="17" cy="8" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="16" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.8" /></>,
  bolt: () => <>{P("M13 3 5 13h6l-1 8 8-10h-6l1-8Z")}</>,
  arrowr: () => <>{P("M5 12h13m0 0-5-5m5 5-5 5")}</>,
  lock: () => <><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M8 11V8a4 4 0 0 1 8 0v3")}</>,
  mail: () => <><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("m4 7 8 6 8-6")}</>,
  wifioff: () => <>{P("M2 5l20 14M5 11.5a10 10 0 0 1 4-2.6M19 11.5a10 10 0 0 0-4.5-2.8M7.8 14.5a6 6 0 0 1 3-1.5M12 18h.01")}</>,
  dot: () => <><circle cx="12" cy="12" r="4" fill="currentColor" /></>,
  shield: () => <>{P("M12 3 5 6v5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z")}{P("m9 12 2 2 4-4")}</>,
  eye: () => <>{P("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z")}<circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.8" /></>,
  user: () => <><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M5.5 20a6.5 6.5 0 0 1 13 0")}</>,
  trash: () => <>{P("M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12")}</>,
  edit: () => <>{P("M5 19h3l9-9-3-3-9 9v3ZM14.5 6.5l3 3")}</>,
  columns: () => <><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />{P("M10 5v14M15 5v14")}</>,
  refresh: () => <>{P("M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4")}</>,
  checks: () => <>{P("m2.5 12.5 4 4L14 8")}{P("m11 16.5.5.5L22 7")}</>,
  file: () => <>{P("M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z")}{P("M14 3v5h5")}</>,
  paperclip: () => <>{P("M20 11.5 12.5 19a4 4 0 0 1-5.7-5.7l7.6-7.6a2.7 2.7 0 0 1 3.8 3.8L10.6 17a1.3 1.3 0 0 1-1.9-1.9l6.7-6.7")}</>,
  flag: () => <>{P("M6 21V4h11l-2 4 2 4H6")}</>,
  dots: () => <><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></>,
  pin: () => <>{P("M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z")}<circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" /></>,
  forward: () => <>{P("M14 8V5l6 5-6 5v-3c-5 0-8 2-9 5 0-5 3-10 9-12Z")}</>,
  sparkles: () => <>{P("M12 4l1.4 3.6L17 9l-3.6 1.4L12 14l-1.4-3.6L7 9l3.6-1.4Z")}</>,
  tag: () => <>{P("M20.6 13.4 13 21l-9-9V4h8l8.6 8.6a1.4 1.4 0 0 1 0 2.8Z")}<circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" /></>,
};

export function Icon({ name, size }: { name: string; size?: number }) {
  const fn = ICONS[name] || ICONS.dot;
  return (
    <svg width={size || 20} height={size || 20} viewBox="0 0 24 24" style={{ display: "block" }}>
      {fn()}
    </svg>
  );
}
