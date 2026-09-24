/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The /prototype folder is the design reference, not part of the build.
  eslint: { ignoreDuringBuilds: true },
  // sharp es un módulo nativo: empaquetarlo rompe sus binarios. Se usa en el servidor para encoger
  // los stickers que exceden el límite de la API oficial (ver src/lib/cloud-outbox.ts).
  serverExternalPackages: ["sharp"],
  // Cabeceras de seguridad. Sin CSP completa todavía (hay scripts inline en el layout raíz y
  // recursos de Supabase, Meta y Google Fonts); frame-ancestors sí, que es lo que frena el
  // clickjacking en /pay y en la app.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), interest-cohort=()" },
      ],
    }];
  },
};

export default nextConfig;
