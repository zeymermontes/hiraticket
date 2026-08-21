"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { AppProvider, useApp } from "@/components/AppContext";

function Inner() {
  const { lang } = useApp();
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // The recovery link logs the user in (via /auth/callback); we just need that session to update the password.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pwd.length < 6) { setErr(lang === "es" ? "La contraseña debe tener al menos 6 caracteres." : "Password must be at least 6 characters."); return; }
    if (pwd !== confirm) { setErr(lang === "es" ? "Las contraseñas no coinciden." : "Passwords don't match."); return; }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
    setTimeout(() => router.push("/chat"), 1200);
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 32, background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--brand)", color: "var(--on-brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>H</span>
          <span style={{ fontWeight: 800, fontSize: 18 }}>Hiraticket</span>
        </div>

        <div>
          <h1 style={{ fontSize: 24 }}>{lang === "es" ? "Define tu contraseña" : "Set your password"}</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>{lang === "es" ? "Elige una contraseña para tu cuenta y entra al equipo." : "Choose a password for your account and join the team."}</p>
        </div>

        {hasSession === false ? (
          <div className="col gap-2">
            <div className="t-sm" style={{ color: "var(--red)" }}>{lang === "es" ? "El enlace expiró o no es válido. Solicita uno nuevo." : "The link expired or is invalid. Request a new one."}</div>
            <Link href="/login" className="btn btn-primary btn-lg btn-block">{lang === "es" ? "Ir a inicio de sesión" : "Go to sign in"}</Link>
          </div>
        ) : done ? (
          <div className="t-sm" style={{ color: "var(--green)" }}>{lang === "es" ? "Contraseña actualizada. Entrando…" : "Password updated. Signing in…"}</div>
        ) : (
          <form onSubmit={submit} className="col gap-3">
            <div>
              <label className="lbl">{lang === "es" ? "Nueva contraseña" : "New password"}</label>
              <div className="field field-lg" style={{ height: 44 }}>
                <Icon name="lock" />
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" required minLength={6} autoFocus />
              </div>
            </div>
            <div>
              <label className="lbl">{lang === "es" ? "Confirmar contraseña" : "Confirm password"}</label>
              <div className="field field-lg" style={{ height: 44 }}>
                <Icon name="lock" />
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={6} />
              </div>
            </div>
            {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || hasSession === null}>
              <Icon name="check" size={17} />{lang === "es" ? "Guardar contraseña" : "Save password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ResetPasswordForm() {
  return (
    <AppProvider>
      <Inner />
    </AppProvider>
  );
}
