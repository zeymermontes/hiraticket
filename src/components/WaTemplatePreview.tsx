"use client";
import React from "react";
import { Icon } from "@/components/Icon";
import type { TemplateButton } from "@/lib/template-rules";

// La plantilla tal como la verá el cliente en WhatsApp: burbuja con encabezado, cuerpo, pie y los
// botones debajo. Un solo dibujo para el constructor de Ajustes, la lista de plantillas y el
// selector del chat —- si cada uno pintara la suya, la vista previa dejaría de ser una promesa.
//
// Los colores son los de WhatsApp a propósito (no los del tema): es una imitación de OTRA app, y
// tiene que verse igual en modo claro y oscuro.

const ICON: Record<TemplateButton["type"], string> = { QUICK_REPLY: "reply", URL: "external", PHONE_NUMBER: "phone" };

export function WaTemplatePreview({
  header,
  mediaHeader,
  body,
  footer,
  buttons = [],
  emptyLabel,
  compact = false,
}: {
  header?: string | null;
  /** Encabezado que no es texto (IMAGE, VIDEO, DOCUMENT…): se anuncia, no se dibuja. */
  mediaHeader?: string | null;
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[];
  emptyLabel?: string;
  /** Sin el fondo de chat alrededor: para listas donde van varias seguidas. */
  compact?: boolean;
}) {
  const bubble = (
    <div style={{ maxWidth: 280, minWidth: 0 }}>
      <div style={{ background: "#fff", borderRadius: buttons.length ? "8px 8px 0 0" : 8, padding: "8px 10px", boxShadow: "0 1px 1px rgba(0,0,0,.12)" }}>
        {mediaHeader && (
          <div style={{ background: "#f0f2f5", color: "#667781", borderRadius: 6, padding: "14px 8px", marginBottom: 6, fontSize: 12, textAlign: "center" }}>
            {mediaHeader}
          </div>
        )}
        {header && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#111", overflowWrap: "anywhere" }}>{header}</div>}
        <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: body ? "#111" : "#8696a0", overflowWrap: "anywhere" }}>{body || emptyLabel || ""}</div>
        {footer && <div style={{ fontSize: 12, color: "#667781", marginTop: 5, overflowWrap: "anywhere" }}>{footer}</div>}
      </div>
      {buttons.map((b, i) => (
        <div
          key={i}
          title={b.type === "URL" ? b.url : b.type === "PHONE_NUMBER" ? b.phone : undefined}
          style={{
            background: "#fff",
            borderTop: "1px solid #e9edef",
            borderRadius: i === buttons.length - 1 ? "0 0 8px 8px" : 0,
            padding: "9px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: "#00a5f4",
            fontSize: 14,
            boxShadow: i === buttons.length - 1 ? "0 1px 1px rgba(0,0,0,.12)" : undefined,
          }}
        >
          <Icon name={ICON[b.type]} size={14} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.text || "…"}</span>
        </div>
      ))}
    </div>
  );
  if (compact) return bubble;
  return <div style={{ background: "#e5ddd5", borderRadius: 12, padding: 14, minHeight: 120 }}>{bubble}</div>;
}
