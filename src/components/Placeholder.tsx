"use client";
import React from "react";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import type { StringKey } from "@/lib/i18n";

export function Placeholder({ icon, labelKey }: { icon: string; labelKey: StringKey }) {
  const { t } = useApp();
  return (
    <div className="view-placeholder">
      <span className="vp-ic"><Icon name={icon} size={26} /></span>
      <h2 style={{ fontSize: 22 }}>{t(labelKey)}</h2>
      <p className="muted">{t("coming_soon")}</p>
    </div>
  );
}
