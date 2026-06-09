import type { Metadata } from "next";
import "@/styles/tokens.css";
import "@/styles/ui.css";
import "@/styles/views.css";
import "@/styles/app.css";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "Hiraticket — Chats & Pedidos",
  description: "WhatsApp + orders workspace for your team.",
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
