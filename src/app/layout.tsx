import type { Metadata, Viewport } from "next";
import "@/styles/tokens.css";
import "@/styles/ui.css";
import "@/styles/views.css";
import "@/styles/app.css";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Hiraticket — Chats & Pedidos",
  description: "WhatsApp + orders workspace for your team.",
  // Sin esto iOS abre la app instalada en una pestaña de Safari con su barra encima, y deja de
  // parecer una app. También es lo que habilita Web Push en iOS (solo funciona instalada).
  appleWebApp: { capable: true, title: "Hiraticket", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

/**
 * Next ya inyecta un viewport por defecto, pero NO `viewport-fit=cover`, y sin eso el contenido
 * no puede meterse bajo la muesca ni bajo la barra de gestos: `env(safe-area-inset-*)` devuelve 0
 * y la barra de navegación inferior queda pegada al borde donde iOS pone su propia barra.
 *
 * `maximumScale` se deja libre a propósito: bloquear el zoom es una barrera de accesibilidad, y
 * en iOS 10+ Safari lo ignora de todos modos. El zoom accidental al tocar un input se evita
 * poniendo los inputs a 16px en móvil (ver ui.css), que es la causa real.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#100F0C" },
  ],
};

// Set theme/lang before paint to avoid a flash (mirrors the prototype).
const themeBoot = `(function(){try{
  var t=JSON.parse(localStorage.getItem('ht_theme')||'"light"');
  document.documentElement.dataset.theme=t;
  var l=JSON.parse(localStorage.getItem('ht_lang')||'"es"');
  document.documentElement.lang=l;
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
