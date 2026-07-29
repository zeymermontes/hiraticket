"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Avatar, deriveInitials } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import { updateMyProfile } from "@/app/(app)/profile/actions";
import { PALETTE_GROUPS } from "@/lib/palette";


export function ProfileScreen({ initial }: { initial: { userId: string; email: string; name: string; color: string; avatarUrl: string | null } }) {
  const { lang } = useApp();
  const router = useRouter();
  const [, start] = useTransition();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color || PALETTE_GROUPS[0][1]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1800); };
  const save = (patch: Parameters<typeof updateMyProfile>[0], optimistic?: () => void) => {
    setErr(null); optimistic?.();
    start(async () => {
      const r = await updateMyProfile(patch);
      if (!r.ok) { setErr(r.error === "no-permission" ? (lang === "es" ? "No se pudo guardar (aplica la migración 0045)." : "Couldn't save (apply migration 0045).") : (lang === "es" ? "No se pudo guardar." : "Couldn't save.")); return; }
      flash(); router.refresh();
    });
  };

  const saveName = () => { const v = name.trim(); if (v && v !== initial.name) save({ full_name: v }); };
  const pickColor = (c: string) => save({ avatar_color: c }, () => setColor(c));

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith("image/")) return;
    setErr(null); setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `avatars/${initial.userId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (error) { setErr(lang === "es" ? "No se pudo subir la imagen." : "Couldn't upload the image."); return; }
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      setAvatarUrl(url);
      save({ avatar_url: url });
    } finally { setUploading(false); }
  }

  return (
    <div className="page">
      <div className="phead"><h1>{lang === "es" ? "Perfil" : "Profile"}</h1>{saved && <span className="t-sm" style={{ color: "var(--green)" }}><Icon name="check" size={14} /> {lang === "es" ? "Guardado" : "Saved"}</span>}</div>
      <div className="scroll" style={{ padding: "0 24px 24px", maxWidth: 560 }}>
        <section className="ws-block">
          <div className="ws-block-head"><Icon name="user" size={16} /><h4>{lang === "es" ? "Tu perfil" : "Your profile"}</h4></div>
          <div className="ws-block-body col gap-3">
            {/* Avatar preview + picture controls */}
            <div className="row gap-3" style={{ alignItems: "center" }}>
              <Avatar name={name} initials={deriveInitials(name || initial.email)} color={color} size={64} src={avatarUrl ?? undefined} />
              <div className="col gap-2">
                <label className="btn btn-sm btn-outline" style={{ cursor: "pointer" }}>
                  <Icon name="paperclip" size={14} />{uploading ? (lang === "es" ? "Subiendo…" : "Uploading…") : (lang === "es" ? "Subir foto" : "Upload photo")}
                  <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
                </label>
                {avatarUrl && <button className="btn btn-sm btn-ghost" style={{ color: "var(--red)" }} onClick={() => { setAvatarUrl(null); save({ avatar_url: null }); }}><Icon name="trash" size={14} />{lang === "es" ? "Quitar foto" : "Remove photo"}</button>}
              </div>
            </div>

            {/* Display name */}
            <div className="col gap-1">
              <label className="lbl">{lang === "es" ? "Nombre para mostrar" : "Display name"}</label>
              <input className="inp-inline" value={name} placeholder={initial.email.split("@")[0]} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              <span className="t-xs muted">{lang === "es" ? "Así te verán tus compañeros y en los chats — no tu correo." : "How teammates and chats see you — not your email."}</span>
            </div>

            {/* Color (used when there's no picture) */}
            <div className="col gap-1">
              <label className="lbl">{lang === "es" ? "Color" : "Color"}</label>
              {/* Los tres tonos de un matiz van pegados; el espacio grande separa un matiz del otro. */}
              <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
                {PALETTE_GROUPS.map((group) => (
                  <div key={group[1]} className="row" style={{ gap: 2 }}>
                    {group.map((c) => (
                      <button key={c} onClick={() => pickColor(c)} title={c} aria-label={c} aria-pressed={c === color}
                        style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: "pointer", border: c === color ? "2px solid var(--text)" : "2px solid transparent", boxShadow: c === color ? "0 0 0 2px var(--surface) inset" : undefined }} />
                    ))}
                  </div>
                ))}
              </div>
              <span className="t-xs muted">{lang === "es" ? "Se usa cuando no tienes foto." : "Used when you don't have a photo."}</span>
            </div>

            {err && <div className="t-sm" style={{ color: "var(--red)" }}>{err}</div>}

            <div className="row gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <span className="t-sm muted grow">{lang === "es" ? "Correo" : "Email"}: <span className="mono">{initial.email}</span></span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
