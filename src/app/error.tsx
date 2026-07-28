"use client";
// Error boundary de la raíz. Va AQUÍ y no dentro de (app) a propósito: un error.tsx no atrapa lo
// que lanza el layout de su propio segmento, y quien puede fallar es (app)/layout.tsx al resolver
// el negocio del usuario.
//
// Su razón de ser: getMyBusiness() ahora lanza en vez de devolver null cuando la lectura falla.
// Antes ese fallo se veía como "este usuario no tiene espacio" y lo mandaba a crear uno —
// duplicando el negocio. Es preferible una pantalla de reintento que corromper datos.
import { useEffect } from "react";
import { Icon } from "@/components/Icon";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const es = typeof navigator === "undefined" || navigator.language.startsWith("es");

  return (
    <div className="empty" style={{ padding: "80px 24px", textAlign: "center" }}>
      <div className="empty-art"><Icon name="wifioff" /></div>
      <h3>{es ? "No pudimos cargar tu espacio" : "We couldn't load your workspace"}</h3>
      <p className="muted t-sm" style={{ maxWidth: 460, margin: "8px auto 0" }}>
        {es
          ? "Fue un problema al leer los datos, no que falte tu cuenta. Tus pedidos y conversaciones siguen ahí."
          : "This was a problem reading your data, not a missing account. Your orders and conversations are still there."}
      </p>
      {error.digest && <p className="muted t-xs" style={{ marginTop: 12 }}>ref: {error.digest}</p>}
      <div className="row gap-2" style={{ justifyContent: "center", marginTop: 20 }}>
        <button className="btn btn-primary" onClick={reset}>
          <Icon name="refresh" size={14} />{es ? "Reintentar" : "Retry"}
        </button>
        <a className="btn btn-outline" href="/logout">{es ? "Cerrar sesión" : "Sign out"}</a>
      </div>
    </div>
  );
}
