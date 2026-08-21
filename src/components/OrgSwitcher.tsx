"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";
import { setActiveOrg } from "@/app/(app)/actions";

export interface OrgOption { id: string; name: string; role: string; mode: string }

const ROLE: Record<string, { es: string; en: string }> = {
  admin: { es: "Admin", en: "Admin" },
  agent: { es: "Agente", en: "Agent" },
  viewer: { es: "Solo lectura", en: "View only" },
};

/**
 * Cambiar de organización, y crear una nueva.
 *
 * Va en el menú del perfil (y en "Más" en el teléfono) y no en una barra permanente: cambiar de
 * organización es algo que se hace de vez en cuando, no cada rato, y una barra fija le robaría
 * sitio arriba a lo que sí se usa a diario.
 *
 * La lista solo aparece con más de una. Quien tiene una sola —- casi todo el mundo —- no debería
 * enterarse de que esto existe; lo único que ve es "Crear organización".
 *
 * Al cambiar se quita la parte de la URL que lleva identificadores (`?c=`, `?order=`): son de la
 * organización que acabas de dejar, y aunque no filtran nada (RLS los devuelve vacíos) dejarían la
 * pantalla apuntando a algo que ya no existe para ti.
 */
export function OrgSwitcher({ orgs, activeId, variant = "menu", onDone }: {
  orgs: OrgOption[];
  activeId: string;
  variant?: "menu" | "block";
  onDone?: () => void;
}) {
  const { lang } = useApp();
  const es = lang === "es";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const pick = (id: string) => {
    if (id === activeId || pending) return;
    setBusy(id);
    start(async () => {
      const r = await setActiveOrg(id);
      onDone?.();
      if (r.ok) router.replace(window.location.pathname);
      router.refresh();
      setBusy(null);
    });
  };

  const label = (o: OrgOption) => ROLE[o.role]?.[es ? "es" : "en"] ?? o.role;
  const createHref = "/orgs/new";

  if (variant === "block") {
    return (
      <div className="col gap-1">
        {orgs.length > 1 && <span className="t-xs muted" style={{ fontWeight: 700, padding: "2px 2px 0" }}>{es ? "Organización" : "Organization"}</span>}
        {orgs.length > 1 && orgs.map((o) => (
          <button key={o.id} className={"btn btn-block " + (o.id === activeId ? "btn-outline" : "btn-ghost")}
            style={{ justifyContent: "flex-start", height: 44 }} disabled={pending} onClick={() => pick(o.id)}>
            <Icon name={o.id === activeId ? "check" : "store"} size={16} />
            <span className="grow truncate" style={{ textAlign: "left" }}>{o.name}</span>
            <span className="t-xs muted">{busy === o.id ? (es ? "Cambiando…" : "Switching…") : label(o)}</span>
          </button>
        ))}
        <Link href={createHref} className="btn btn-ghost btn-block" style={{ justifyContent: "flex-start", height: 44 }} onClick={() => onDone?.()}>
          <Icon name="plus" size={16} />{es ? "Crear organización" : "Create organization"}
        </Link>
      </div>
    );
  }

  return (
    <>
      {orgs.length > 1 && <div className="menu-label">{es ? "Organización" : "Organization"}</div>}
      {orgs.length > 1 && orgs.map((o) => (
        <button key={o.id} className="menu-item" disabled={pending} onClick={() => pick(o.id)}>
          <Icon name={o.id === activeId ? "check" : "store"} size={15} />
          <span className="grow truncate" style={{ textAlign: "left" }}>{o.name}</span>
          <span className="t-xs muted">{busy === o.id ? "…" : label(o)}</span>
        </button>
      ))}
      <Link className="menu-item" href={createHref} onClick={() => onDone?.()}>
        <Icon name="plus" size={15} />{es ? "Crear organización" : "Create organization"}
      </Link>
    </>
  );
}
