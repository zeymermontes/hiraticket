"use client";
import React from "react";
import { Icon } from "@/components/Icon";
import { createDemoBusiness } from "@/app/(app)/actions";

const VERTICALS = [
  { id: "imprenta", label: "Imprenta / Stickers" },
  { id: "restaurante", label: "Restaurante" },
  { id: "estetica", label: "Estética" },
  { id: "veterinaria", label: "Veterinaria" },
  { id: "retail", label: "Retail" },
  { id: "taller", label: "Taller" },
];

export function Onboarding() {
  return (
    <div className="view-placeholder">
      <span className="vp-ic"><Icon name="store" size={26} /></span>
      <h2 style={{ fontSize: 22 }}>Crea tu negocio</h2>
      <p className="muted" style={{ maxWidth: 420 }}>
        Aún no tienes un negocio. Crea uno y lo poblamos con datos de ejemplo
        (pedidos, áreas y etapas) para que pruebes Hiraticket.
      </p>
      <form
        action={createDemoBusiness}
        style={{ display: "flex", flexDirection: "column", gap: 12, width: 320, marginTop: 8 }}
      >
        <div className="field field-lg" style={{ height: 44 }}>
          <Icon name="store" />
          <input name="name" placeholder="Nombre del negocio" defaultValue="Hirata" required />
        </div>
        <select name="vertical" className="select" defaultValue="imprenta">
          {VERTICALS.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary btn-lg btn-block">
          <Icon name="plus" size={16} /> Crear y poblar
        </button>
      </form>
    </div>
  );
}
