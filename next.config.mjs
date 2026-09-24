/**
 * Content-Security-Policy.
 *
 * Qué permite y por qué:
 *  - script-src 'unsafe-inline': Next mete scripts inline de hidratación y el layout raíz tiene
 *    tres de arranque (tema, hilo pegado abajo, instalación PWA). Sin nonce por middleware no hay
 *    forma de evitarlo; aun así, ningún script EXTERNO carga salvo el SDK de Facebook (Embedded
 *    Signup). En desarrollo Next necesita 'unsafe-eval'.
 *  - style-src 'unsafe-inline': estilos de React y el <style> de los documentos legales; Google
 *    Fonts para la hoja de la tipografía.
 *  - img-src https:: las vistas previas de enlaces pintan el og:image del sitio ajeno, y el mapa
 *    de ubicación viene de openstreetmap. data:/blob: para miniaturas y archivos locales.
 *  - connect-src: Supabase (REST, Storage, Realtime por WebSocket) y Facebook (el SDK).
 *  - frame-src: solo los popups/iframes de Facebook del Embedded Signup.
 *  - object-src 'none', base-uri 'self', form-action 'self', frame-ancestors 'self'.
 */
const supabaseOrigin = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin; } catch { return ""; } })();
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://connect.facebook.net`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: https:${dev ? " http://127.0.0.1:* http://localhost:*" : ""}`,
  `media-src 'self' blob: https:${dev ? " http://127.0.0.1:* http://localhost:*" : ""}`,
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} https://*.supabase.co wss://*.supabase.co https://*.facebook.com https://graph.facebook.com${dev ? " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*" : ""}`,
  "frame-src https://www.facebook.com https://*.facebook.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "manifest-src 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ").replace(/\s{2,}/g, " ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The /prototype folder is the design reference, not part of the build.
  eslint: { ignoreDuringBuilds: true },
  // sharp es un módulo nativo: empaquetarlo rompe sus binarios. Se usa en el servidor para encoger
  // los stickers que exceden el límite de la API oficial (ver src/lib/cloud-outbox.ts).
  serverExternalPackages: ["sharp"],
  // Cabeceras de seguridad. La CSP está arriba, en `csp`.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), interest-cohort=()" },
      ],
    }];
  },
};

export default nextConfig;
