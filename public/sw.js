/* eslint-disable */
/**
 * Service worker de Hiraticket.
 *
 * IMPORTANTE: este service worker NO CACHEA NADA. Ni HTML, ni payloads RSC, ni assets.
 *
 * No es un descuido, es la decisión: la app ya tiene `src/lib/buildSkew.ts` + `BuildSkewGuard`
 * vigilando que una pestaña no se quede con un build viejo tras un despliegue —- porque eso ya
 * pasó y rompía la recepción de mensajes. Un service worker que sirva navegaciones desde caché
 * pelearía justo contra eso: serviría el HTML rancio que el guarda acaba de decidir tirar, y
 * quedarían dos piezas discutiendo cuál es la versión buena. Una app de chat en vivo no gana nada
 * con un caché offline y pierde muchísimo con uno inconsistente.
 *
 * Lo único que hace, y es lo único para lo que hace falta un SW, es RECIBIR NOTIFICACIONES:
 * `push` con la app cerrada, y `notificationclick` para llevar al chat correcto. De paso arregla
 * las notificaciones en primer plano en Android, donde `new Notification()` lanza excepción y
 * exige pasar por `registration.showNotification()`.
 */

// Toma el control sin esperar a que se cierren las pestañas viejas: si alguien acaba de dar
// "activar notificaciones", tiene que funcionar ya, no en la siguiente visita.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }

  const title = d.title || "Hiraticket";
  const options = {
    body: d.body || "",
    icon: d.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Mismo tag = la nueva REEMPLAZA a la anterior. Sin esto, veinte mensajes de un chat dejan
    // veinte notificaciones apiladas y hay que barrerlas una por una.
    tag: d.tag || "ht",
    renotify: true,
    data: { href: d.href || "/chat" },
    // Un patrón corto para mensajes; las llamadas mandan el suyo desde el servidor.
    vibrate: d.vibrate || [90, 40, 90],
    timestamp: d.at ? Date.parse(d.at) || Date.now() : Date.now(),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/chat";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Si la app ya está abierta se REUSA esa ventana: abrir una segunda pestaña de una app de chat
    // deja dos sesiones compitiendo por el mismo realtime y confunde a cualquiera.
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate(href); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(href);
  })());
});
