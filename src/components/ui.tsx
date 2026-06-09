"use client";
import React from "react";

type PillColor =
  | "brand" | "blue" | "violet" | "teal" | "green" | "amber" | "red" | "slate";

export function Pill({
  color = "slate",
  children,
  dot,
  large,
}: {
  color?: PillColor;
  children: React.ReactNode;
  dot?: boolean;
  large?: boolean;
}) {
  return (
    <span className={"pill pill-" + color + (large ? " pill-lg" : "")}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function Avatar({
  name,
  initials,
  color = "#5A6373",
  size = 32,
  presence,
  src,
}: {
  name?: string;
  initials?: string;
  color?: string;
  size?: number;
  presence?: "online" | "away" | "offline" | null;
  src?: string;
}) {
  const fs = Math.round(size * 0.4);
  return (
    <span className="av" style={{ width: size, height: size, background: color, fontSize: fs }} title={name}>
      {src ? <img src={src} alt={name} /> : initials}
      {presence && <span className={"av-presence " + presence} />}
    </span>
  );
}

/** "Ana Perez" → "AP"; single word → first 2 letters; phone-only → last 2 digits. */
export function deriveInitials(name: string): string {
  const words = (name || "").replace(/[^\p{L} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const digits = (name || "").replace(/\D/g, "");
  return digits.slice(-2) || "#";
}

const AVATAR_COLORS = [
  "#2563EB", "#6D45D6", "#0E8C82", "#1A8F4C", "#A9740B", "#CF3D3D",
  "#0D9488", "#C2410C", "#DB2777", "#7C3AED", "#0891B2", "#5A6373",
];

/** Deterministic avatar color from a stable seed (e.g. the phone number). */
export function avatarColor(seed?: string | null): string {
  const s = seed ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
