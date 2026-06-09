"use client";
import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { AppProvider, useApp } from "@/components/AppContext";

function Inner() {
  const { lang, setLang, theme, setTheme, t } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/chat";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  async function forgot() {
    if (!email) { setErr(lang === "es" ? "Escribe tu correo primero." : "Enter your email first."); return; }
    setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback` });
    if (error) setErr(error.message);
    else setInfo(lang === "es" ? "Te enviamos un link para restablecer tu contraseña." : "We sent you a password reset link.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const supabase = createClient();

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password: pwd,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${next}` },
      });
      if (error) setErr(error.message);
      else setInfo(lang === "es"
        ? "Revisa tu correo para confirmar la cuenta."
        : "Check your email to confirm your account.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "1.05fr 1fr" }} className="login-grid">
      {/* brand panel */}
      <div style={{ background: "var(--ink)", color: "#fff", padding: "48px 56px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,197,24,.16), transparent 70%)", right: -160, top: -120 }} />
        <div className="row gap-3" style={{ position: "relative" }}>
          <div className="rail-logo" style={{ margin: 0 }}>H</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.02em" }} className="display">Hiraticket</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }}>by Hirata · Impresión Digital</div>
          </div>
        </div>
        <div style={{ marginTop: "auto", position: "relative" }}>
          <div style={{ fontFamily: "'Archivo Expanded','Archivo',sans-serif", fontWeight: 900, fontSize: 40, lineHeight: 1.04, letterSpacing: "-.02em", textTransform: "uppercase" }}>
            {lang === "es" ? <>Chats y<br />pedidos,<br /><span style={{ color: "var(--brand)" }}>en un lugar.</span></> : <>Chats &amp;<br />orders,<br /><span style={{ color: "var(--brand)" }}>in one place.</span></>}
          </div>
          <p style={{ color: "rgba(255,255,255,.66)", maxWidth: 380, marginTop: 18, fontSize: 14.5 }}>
            {lang === "es"
              ? "Atiende WhatsApp, rutea pedidos entre áreas y mantén todo el historial del cliente."
              : "Handle WhatsApp, route orders across areas, and keep every customer's history."}
          </p>
          <div className="row gap-3" style={{ marginTop: 28 }}>
            {([["chat", lang === "es" ? "Bandeja unificada" : "Unified inbox"], ["orders", lang === "es" ? "Pedidos por área" : "Orders by area"], ["whatsapp", lang === "es" ? "WhatsApp en vivo" : "Live WhatsApp"]] as [string, string][]).map(([ic, lb]) => (
              <div key={lb} className="row gap-2" style={{ fontSize: 12.5, color: "rgba(255,255,255,.8)" }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand)" }}>
                  <Icon name={ic} size={15} />
                </span>
                {lb}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* form */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32, position: "relative" }}>
        <div style={{ position: "absolute", top: 20, right: 24 }} className="row gap-2">
          <div className="seg" style={{ height: 32 }}>
            <button type="button" className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
            <button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
          </div>
          <button type="button" className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </div>

        <form onSubmit={submit} style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26 }}>{mode === "signin" ? t("login_welcome") : t("sign_up")}</h1>
            <p className="muted" style={{ marginTop: 4 }}>{t("login_sub")}</p>
          </div>

          <div>
            <label className="lbl">{t("email")}</label>
            <div className="field field-lg" style={{ height: 44 }}>
              <Icon name="mail" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
            </div>
          </div>

          <div>
            <label className="lbl">{t("password")}</label>
            <div className="field field-lg" style={{ height: 44 }}>
              <Icon name="lock" />
              <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={6} />
            </div>
          </div>

          {mode === "signin" && (
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <button type="button" className={"switch" + (remember ? " on" : "")} onClick={() => setRemember((r) => !r)} aria-label="remember" />
              <span className="t-sm">{lang === "es" ? "Recordarme" : "Remember me"}</span>
              <span className="grow" />
              <button type="button" onClick={forgot} style={{ background: "none", border: "none", color: "var(--brand-700)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{lang === "es" ? "¿Olvidaste tu contraseña?" : "Forgot password?"}</button>
            </div>
          )}

          {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}
          {info && <div className="t-sm" style={{ color: "var(--green)" }}>{info}</div>}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            <Icon name="arrowr" size={17} />
            {mode === "signin" ? t("sign_in") : t("sign_up")}
          </button>

          <div className="t-sm muted center" style={{ marginTop: 2 }}>
            {mode === "signin" ? t("need_account") : t("have_account")}{" "}
            <button
              type="button"
              style={{ background: "none", border: "none", color: "var(--brand-700)", fontWeight: 600, cursor: "pointer" }}
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(null); setInfo(null); }}
            >
              {mode === "signin" ? t("sign_up") : t("sign_in")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LoginForm() {
  return (
    <AppProvider>
      <Inner />
    </AppProvider>
  );
}
