"use client";
import React, { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { Pill, Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { Area } from "@/lib/business";
import type { Agent } from "@/lib/chat";

export interface TransferDest { type: "agent" | "area"; id: string }

/** Shared transfer dialog: agent/area toggle, radio-card list, optional note. */
export function TransferModal({
  title, agents, areas, onConfirm, onClose,
}: {
  title?: string;
  agents: Agent[];
  areas: Area[];
  onConfirm: (dest: TransferDest, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const [tab, setTab] = useState<"agent" | "area">("agent");
  const [sel, setSel] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function confirm() {
    if (!sel) return;
    start(async () => { await onConfirm({ type: tab, id: sel }, note.trim()); onClose(); });
  }

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal-head">
          <span className="t-ic" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--brand-50)", color: "var(--brand-700)", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="swap" size={18} /></span>
          <h3 className="grow">{title ?? (lang === "es" ? "Transferir" : "Transfer")}</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-body col gap-3">
          <div className="seg" style={{ width: "100%" }}>
            <button className={tab === "agent" ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => { setTab("agent"); setSel(""); }}>{lang === "es" ? "A un agente" : "To an agent"}</button>
            <button className={tab === "area" ? "on" : ""} style={{ flex: 1, justifyContent: "center" }} onClick={() => { setTab("area"); setSel(""); }}>{lang === "es" ? "A un área" : "To an area"}</button>
          </div>
          <div className="col gap-2 scroll" style={{ maxHeight: 260 }}>
            {tab === "agent" ? agents.filter((a) => a.role !== "viewer").map((a) => (
              <button key={a.id} onClick={() => setSel(a.id)} style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderRadius: 10, textAlign: "left", cursor: "pointer", background: sel === a.id ? "var(--brand-50)" : "var(--surface)", border: "1px solid " + (sel === a.id ? "var(--brand)" : "var(--border)") }}>
                <Avatar name={a.name} initials={deriveInitials(a.name)} color={a.color} size={28} />
                <span style={{ fontWeight: 600 }}>{a.name}</span>
              </button>
            )) : areas.map((ar) => (
              <button key={ar.id} onClick={() => setSel(ar.id)} style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderRadius: 10, textAlign: "left", cursor: "pointer", background: sel === ar.id ? "var(--brand-50)" : "var(--surface)", border: "1px solid " + (sel === ar.id ? "var(--brand)" : "var(--border)") }}>
                <Pill color={ar.color as PillColor}>{ar.name}</Pill>
              </button>
            ))}
          </div>
          <div>
            <label className="lbl">{lang === "es" ? "Nota (opcional)" : "Note (optional)"}</label>
            <div className="field field-filled" style={{ height: "auto", alignItems: "flex-start", padding: "8px 10px" }}>
              <textarea className="bare" rows={2} style={{ width: "100%", fontSize: 13 }} placeholder={lang === "es" ? "Motivo de la transferencia…" : "Reason for the transfer…"} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose}>{lang === "es" ? "Cancelar" : "Cancel"}</button>
          <button className="btn btn-primary" disabled={pending || !sel} onClick={confirm}><Icon name="swap" size={15} />{lang === "es" ? "Transferir" : "Transfer"}</button>
        </div>
      </div>
    </div>
  );
}
