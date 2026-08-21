import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA.
 *
 * Es lo que convierte la pestaña en algo instalable, y en iOS además es requisito para que exista
 * Web Push: Safari solo entrega notificaciones a una app agregada a la pantalla de inicio, y solo
 * si el manifest declara `display: standalone`.
 *
 * `start_url` es /chat y no /: la raíz es la landing pública, y quien instala la app es un agente
 * que quiere ver sus conversaciones, no el sitio de marketing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hiraticket — Chats & Pedidos",
    short_name: "Hiraticket",
    description: "WhatsApp y pedidos para tu equipo.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F6F2",
    theme_color: "#F5C518",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android recorta el icono con la forma del launcher; el maskable trae el margen para eso.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Chats", url: "/chat" },
      { name: "Pedidos", url: "/orders" },
    ],
  };
}
