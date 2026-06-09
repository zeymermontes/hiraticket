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

export function deriveInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
