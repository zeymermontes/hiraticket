"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useApp } from "@/components/AppContext";

// Meta Embedded Signup (coexistence) launcher. Loads the Facebook SDK, opens Meta's onboarding
// popup, captures the returned auth `code` + the WABA/phone ids, and hands them to our backend to
// finish onboarding. This is the OFFICIAL Cloud API path — the number keeps working on the
// business's phone (coexistence) while we gain templates / campaigns / agents via the API.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

export function EmbeddedSignup({ appId, configId }: { appId: string; configId: string }) {
  const { lang } = useApp();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Coexistence sends the WABA + phone ids over postMessage; the FB.login callback only returns the code.
  const sessionInfo = useRef<{ phone_number_id?: string; waba_id?: string }>({});

  const configured = Boolean(appId && configId);

  // Load the Facebook SDK once (only when configured).
  useEffect(() => {
    if (!configured) return;
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = function () {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v21.0" });
      setReady(true);
    };
    const id = "facebook-jssdk";
    if (!document.getElementById(id)) {
      const js = document.createElement("script");
      js.id = id;
      js.async = true;
      js.defer = true;
      js.crossOrigin = "anonymous";
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(js);
    }
  }, [appId, configured]);

  // Capture the coexistence onboarding payload (waba_id / phone_number_id) from the ES iframe.
  useEffect(() => {
    if (!configured) return;
    function onMessage(e: MessageEvent) {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin || "https://x.invalid").hostname)) return;
      try {
        const data = JSON.parse(e.data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          sessionInfo.current = {
            phone_number_id: data.data?.phone_number_id,
            waba_id: data.data?.waba_id,
          };
        }
      } catch {
        /* non-JSON postMessage noise */
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [configured]);

  /**
   * Dos altas distintas, no una.
   *
   * `whatsapp_business_app_onboarding` es el flujo de COEXISTENCIA: el número ya está funcionando
   * en la app de WhatsApp Business y se le añade la API sin perder el historial ni el teléfono.
   * Es el caso que teníamos en mente al construir esto, y estaba puesto a fuego para todo el mundo.
   *
   * Pero no es el caso general. Un cliente con un número NUEVO —- o con uno que no está en la app
   * de WhatsApp Business —- necesita el alta normal, y forzarle la coexistencia lo manda por un
   * camino cuyos requisitos no cumple. La coexistencia además tiene su propia elegibilidad del
   * lado de Meta, así que un rechazo ahí no distingue "no puedes" de "no aplica".
   *
   * Se deja elegir, y la coexistencia sigue siendo el primer botón: es lo que ya funcionaba.
   */
  function launch(coexistencia: boolean) {
    if (!window.FB) return;
    setBusy(true);
    setMsg(null);
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setBusy(false);
          // Decir solo "cancelada" es engañoso: el mismo camino se recorre cuando Meta rechaza el
          // login sin que nadie cancele nada —- típicamente porque la app de Meta está sin publicar,
          // y entonces solo entran las cuentas con rol en la app (admin, desarrollador, tester).
          // El SDK no distingue los dos casos: cerrar el diálogo devuelve lo mismo que un error
          // dentro de él. Así que se nombran ambos, con la pista textual que el usuario acaba de
          // ver en el popup —- que es lo único que permite saber cuál de los dos fue.
          setMsg({
            kind: "err",
            text: lang === "es"
              ? "No se completó la conexión. Si viste “Función no disponible”, la app de Meta aún no está publicada: pide que te agreguen como tester o espera a que se publique."
              : "The connection wasn't completed. If you saw “Feature unavailable”, the Meta app isn't published yet: ask to be added as a tester, or wait until it's published.",
          });
          return;
        }
        fetch("/api/whatsapp/embedded-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, ...sessionInfo.current }),
        })
          .then((r) => r.json())
          .then((d) => {
            setBusy(false);
            if (d?.ok) {
              setMsg({ kind: "ok", text: lang === "es" ? "¡Número conectado por la API oficial!" : "Number connected via the official API!" });
              router.refresh();
            } else {
              // "No se pudo" a secas deja a la persona sin nada que hacer. Los casos que sí tienen
              // una salida concreta se dicen con nombre y apellido.
              const es = lang === "es";
              const texto = d?.error === "release_failed"
                ? (es ? "El número estaba vinculado en otro lugar y no se pudo liberar. Inténtalo de nuevo." : "The number was linked elsewhere and couldn't be released. Try again.")
                : d?.error === "no_business"
                  ? (es ? "No encontramos tu organización. Recarga y vuelve a intentar." : "We couldn't find your organization. Reload and try again.")
                  : (es ? "No se pudo completar la conexión." : "Could not complete the connection.");
              setMsg({ kind: "err", text: texto });
            }
          })
          .catch(() => {
            setBusy(false);
            setMsg({ kind: "err", text: lang === "es" ? "Error de red." : "Network error." });
          });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        // Sin featureType, Meta abre el alta normal (número nuevo o no vinculado a la app).
        extras: coexistencia
          ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }
          : { setup: {}, sessionInfoVersion: "3" },
      },
    );
  }

  if (!configured) {
    return (
      <div className="t-xs muted">
        {lang === "es"
          ? "Configuración de Meta pendiente (falta el App ID y el config de Embedded Signup)."
          : "Meta setup pending (missing App ID and Embedded Signup config)."}
      </div>
    );
  }

  const es = lang === "es";
  return (
    <div className="col gap-2">
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-sm btn-primary" disabled={!ready || busy} onClick={() => launch(true)}>
          <Icon name="whatsapp" size={15} />
          {busy ? (es ? "Conectando…" : "Connecting…") : (es ? "Mi número ya está en WhatsApp" : "My number is already on WhatsApp")}
        </button>
        <button className="btn btn-sm btn-outline" disabled={!ready || busy} onClick={() => launch(false)}>
          <Icon name="plus" size={15} />
          {es ? "Es un número nuevo" : "It's a new number"}
        </button>
      </div>
      {/* La diferencia importa y no es evidente: elegir mal manda al cliente por un camino cuyos
          requisitos no cumple, y Meta rechaza sin explicar cuál de los dos era. */}
      <div className="t-xs muted">
        {es
          ? "El primero conserva tu historial y deja WhatsApp funcionando en el teléfono (coexistencia). El segundo es para un número que aún no usa WhatsApp."
          : "The first keeps your history and leaves WhatsApp working on the phone (coexistence). The second is for a number not yet on WhatsApp."}
      </div>
      {msg && (
        <div className="t-xs" style={{ color: msg.kind === "ok" ? "var(--green, #16a34a)" : "var(--red, #dc2626)" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
