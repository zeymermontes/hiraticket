"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/ui";
import { AppProvider, useApp } from "@/components/AppContext";
import { acceptInvite, declineInvite, acceptToken } from "@/app/(app)/invites/actions";

const ROLE: Record<string, { es: string; en: string }> = {
  admin: { es: "Administrador", en: "Admin" }, agent: { es: "Agente", en: "Agent" }, viewer: { es: "Solo lectura", en: "Viewer" },
};

function Inner({ businessName, inviterName, role, inviteId, token }: { businessName: string; inviterName?: string | null; role: string; inviteId?: string; token?: string }) {
  const { lang } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const errMsg = (e?: string) =>
    e === "already-in-team" ? (lang === "es" ? "Ya perteneces a esta organización." : "You already belong to this organization.")
      : e === "expired" ? (lang === "es" ? "Esta invitación expiró." : "This invitation expired.")
        : e === "used" ? (lang === "es" ? "Este enlace ya se usó." : "This link was already used.")
          : (lang === "es" ? "No se pudo aceptar la invitación." : "Couldn't accept the invitation.");

  function accept() {
    setBusy(true); setErr(null);
    (token ? acceptToken(token) : acceptInvite(inviteId!)).then((r) => {
      if (r.ok) { router.replace("/chat"); router.refresh(); }
      else { setErr(errMsg(r.error)); setBusy(false); }
    });
  }
  function decline() {
    setBusy(true);
    if (inviteId) declineInvite(inviteId).finally(() => { router.replace("/chat"); router.refresh(); });
    else { router.replace("/chat"); router.refresh(); }
  }

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", padding: 32, background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 28, boxShadow: "var(--sh-lg)" }}>
        <div className="row gap-2" style={{ alignItems: "center", marginBottom: 14 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--brand)", color: "var(--on-brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>H</span>
          <span style={{ fontWeight: 800, fontSize: 18 }}>Hiraticket</span>
        </div>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{lang === "es" ? "Te invitaron a un equipo" : "You're invited to a team"}</h1>
        <p style={{ margin: "0 0 16px", fontSize: 15, lineHeight: 1.6, color: "var(--text-muted)" }}>
          {inviterName ? <><strong style={{ color: "var(--text)" }}>{inviterName}</strong> {lang === "es" ? "te invitó a unirte a " : "invited you to join "}</> : (lang === "es" ? "Te invitaron a unirte a " : "You've been invited to join ")}
          <strong style={{ color: "var(--text)" }}>{businessName}</strong>{lang === "es" ? " en Hiraticket." : " on Hiraticket."}
        </p>
        <div className="row gap-2" style={{ marginBottom: 18 }}>
          <span className="t-sm muted">{lang === "es" ? "Tu rol:" : "Your role:"}</span>
          <Pill color="brand">{ROLE[role]?.[lang] ?? role}</Pill>
        </div>
        {err && <div className="t-sm" style={{ color: "var(--red)", marginBottom: 12 }}>{err}</div>}
        <div className="row gap-2">
          <button className="btn btn-outline grow" disabled={busy} onClick={decline}>{lang === "es" ? "Ahora no" : "Not now"}</button>
          <button className="btn btn-primary grow" disabled={busy} onClick={accept}><Icon name="check" size={16} />{lang === "es" ? "Unirme al equipo" : "Join the team"}</button>
        </div>
      </div>
      <a href="/logout" className="t-sm muted" style={{ textDecoration: "none" }}>{lang === "es" ? "Cerrar sesión" : "Sign out"}</a>
    </div>
  );
}

export function InvitePopup(props: { businessName: string; inviterName?: string | null; role: string; inviteId?: string; token?: string }) {
  return <AppProvider><Inner {...props} /></AppProvider>;
}

function NoticeInner({ reason }: { reason?: string }) {
  const { lang } = useApp();
  const msg = reason === "expired" ? (lang === "es" ? "Este enlace de invitación expiró." : "This invite link has expired.")
    : reason === "used" ? (lang === "es" ? "Este enlace de invitación ya se usó." : "This invite link was already used.")
      : reason === "already-in-team" ? (lang === "es" ? "Ya perteneces a esta organización." : "You already belong to this organization.")
        : (lang === "es" ? "Este enlace de invitación no es válido." : "This invite link is not valid.");
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", justifyContent: "center", padding: 32, background: "var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 28, boxShadow: "var(--sh-lg)", textAlign: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", color: "var(--text-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}><Icon name="lock" /></div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{lang === "es" ? "Invitación" : "Invitation"}</h1>
        <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.6, color: "var(--text-muted)" }}>{msg}</p>
        <a className="btn btn-primary btn-block" href="/chat">{lang === "es" ? "Ir a Hiraticket" : "Go to Hiraticket"}</a>
      </div>
      <a href="/logout" className="t-sm muted" style={{ textDecoration: "none" }}>{lang === "es" ? "Cerrar sesión" : "Sign out"}</a>
    </div>
  );
}

export function JoinNotice({ reason }: { reason?: string }) {
  return <AppProvider><NoticeInner reason={reason} /></AppProvider>;
}
