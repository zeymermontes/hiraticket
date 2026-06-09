"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { bootstrapPlatformAdmin } from "@/app/platform/actions";

export function PlatformClaim({ canClaim }: { canClaim: boolean }) {
  const { lang } = useApp();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="view-placeholder">
      <span className="vp-ic"><Icon name="lock" size={26} /></span>
      <h2 style={{ fontSize: 22 }}>{lang === "es" ? "Consola de plataforma" : "Platform console"}</h2>
      {canClaim ? (
        <>
          <p className="muted" style={{ maxWidth: 420 }}>
            {lang === "es"
              ? "Nadie es super-admin todavía. Reclama el acceso para gestionar todos los negocios, planes y suscripciones."
              : "No super-admin yet. Claim access to manage all businesses, plans and subscriptions."}
          </p>
          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
          <button className="btn btn-primary btn-lg" disabled={pending}
            onClick={() => start(async () => { const r = await bootstrapPlatformAdmin(); if (!r.ok) setErr(r.error ?? "error"); else router.refresh(); })}>
            <Icon name="shield" size={16} />{lang === "es" ? "Reclamar super-admin" : "Claim super-admin"}
          </button>
        </>
      ) : (
        <p className="muted" style={{ maxWidth: 420 }}>
          {lang === "es" ? "No tienes acceso a la consola de plataforma." : "You don't have access to the platform console."}
        </p>
      )}
    </div>
  );
}
