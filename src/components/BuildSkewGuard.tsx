"use client";
import { useEffect } from "react";
import { BUILD_SKEW_EVENT, installBuildSkewGuard, reloadForNewBuild } from "@/lib/buildSkew";
import { useToast } from "@/components/Toast";

/**
 * Vigila que esta pestaña no se quede con un build viejo tras un despliegue. Va dentro del
 * ToastProvider porque cuando la pestaña está a la vista preguntamos antes de recargar; si está
 * oculta, `buildSkew` recarga solo y este aviso nunca aparece. Ver `@/lib/buildSkew`.
 */
export function BuildSkewGuard() {
  const { push } = useToast();

  useEffect(() => {
    installBuildSkewGuard();
    const onSkew = () =>
      push({
        kind: "warn",
        title: "Hay una versión nueva",
        message: "Recarga para seguir recibiendo mensajes. Lo que escribiste se guarda.",
        sticky: true,
        // Misma key: si se detecta otra vez, se reemplaza el aviso en su sitio en vez de apilarse.
        key: "build-skew",
        onClick: reloadForNewBuild,
      });
    window.addEventListener(BUILD_SKEW_EVENT, onSkew);
    return () => window.removeEventListener(BUILD_SKEW_EVENT, onSkew);
  }, [push]);

  return null;
}
