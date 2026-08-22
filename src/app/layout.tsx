import type { Metadata, Viewport } from "next";
import { BUILD_ID } from "@/lib/buildId";
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

/**
 * Deja el hilo del chat pegado abajo ANTES del primer pintado.
 *
 * El problema original: el HTML del chat lo pinta el servidor con todos los mensajes, y el
 * navegador lo pinta desde arriba. El salto al final vivía en un useLayoutEffect —- o sea después
 * de hidratar React —- y ese hueco se veía como un parpadeo de la parte de arriba del hilo en cada
 * recarga.
 *
 * Vive AQUÍ y no dentro de ChatScreen porque un <script> dentro de un componente cliente se vuelve
 * a renderizar en cada interacción, y React avisa —- con razón —- de que en cliente nunca se
 * ejecuta. El layout raíz es un componente de servidor: se escribe una vez y no se toca más.
 *
 * Como desde <head> el hilo todavía no existe, se espera con un MutationObserver. Se repinta en
 * cada mutación porque durante el parseo los mensajes van llegando y la altura crece, pero pasando
 * por requestAnimationFrame: leer scrollHeight fuerza un cálculo de layout, y hacerlo en cada nodo
 * insertado de un hilo largo sería peor que el problema. Se suelta en DOMContentLoaded —- de ahí en
 * adelante manda el useLayoutEffect de ChatScreen.
 */
const threadPinBoot = `(function(){
  var queued=false;
  var pin=function(){var t=document.getElementById('chat-thread');if(t)t.scrollTop=t.scrollHeight;};
  var schedule=function(){if(queued)return;queued=true;requestAnimationFrame(function(){queued=false;pin();});};
  var mo=new MutationObserver(schedule);
  mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',function(){pin();mo.disconnect();},{once:true});
})();`;

/**
 * Guarda el evento de "se puede instalar" ANTES de que React hidrate.
 *
 * `beforeinstallprompt` lo dispara Chrome una sola vez y muy temprano —- normalmente durante la
 * carga, antes de que exista ningún componente que pueda escucharlo. Si nadie lo atrapa, se pierde
 * y ya no hay manera de abrir el diálogo de instalación por nuestra cuenta: el navegador solo deja
 * llamar a `prompt()` sobre ESE objeto. Ese era el "no me dio opción de instalar".
 *
 * Aquí se atrapa desde <head>, se llama a preventDefault() para que Chrome no ponga su propio
 * aviso a destiempo, y se avisa por un evento propio para que la interfaz aparezca cuando llegue.
 */
const installBoot = `(function(){
  window.__htInstall=null;
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();
    window.__htInstall=e;
    window.dispatchEvent(new Event('ht:installable'));
  });
  window.addEventListener('appinstalled',function(){
    window.__htInstall=null;
    window.dispatchEvent(new Event('ht:installed'));
  });
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
        {/* Next 16 emite el meta estándar `mobile-web-app-capable`, pero iOS anterior a 17 solo
            entiende el heredado con prefijo `apple-`. Sin él, la app agregada a la pantalla de
            inicio abre dentro de Safari con su barra —- y ahí NO hay Web Push. Una línea que
            decide si las notificaciones existen o no en la mitad de los iPhone. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* La versión con la que se cargó esta pestaña. La comprobación de "hay una versión nueva"
            la compara contra /api/version al volver a la app —- ver src/lib/buildSkew.ts. */}
        {BUILD_ID && <meta name="ht-build" content={BUILD_ID} />}
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script dangerouslySetInnerHTML={{ __html: threadPinBoot }} />
        <script dangerouslySetInnerHTML={{ __html: installBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
