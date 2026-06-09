import type { Metadata } from "next";
import "@/styles/tokens.css";
import "@/styles/ui.css";
import "@/styles/views.css";
import "@/styles/app.css";

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
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
