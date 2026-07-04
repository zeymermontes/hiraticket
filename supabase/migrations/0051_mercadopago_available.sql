-- ============================================================
-- Hiraticket — MercadoPago plugin goes live (Phase 2).
--   The gateway integration is real now: activating the plugin + saving the Access Token enables
--   the "Tarjeta" method on the public checkout (/pay). Flip it from coming_soon to available.
-- ============================================================

update public.plugins
   set status = 'available',
       description = 'Cobra con tarjeta y meses sin intereses en tu link de pago. El pago se acredita automáticamente.'
 where id = 'mercadopago';

-- Per-plugin setup guide (shown in an info popup on the card): [{ title, body, url? }].
alter table public.plugins add column if not exists guide jsonb not null default '[]'::jsonb;

update public.plugins set guide = '[
  {"title":"Crea tu aplicación en MercadoPago","body":"Entra al panel de desarrolladores de MercadoPago con la cuenta donde recibirás el dinero y crea una aplicación (tipo: Pagos online → CheckoutPro).","url":"https://www.mercadopago.com.mx/developers/panel/app"},
  {"title":"Copia tus credenciales de producción","body":"Dentro de tu aplicación ve a Credenciales de producción y copia el Access Token (empieza con APP_USR-) y la Public Key."},
  {"title":"Pégalas en Configurar","body":"En esta tarjeta pulsa Configurar y pega el Access Token y la Public Key. Se guardan cifradas."},
  {"title":"Prueba el cobro","body":"Envía un link de pago a un pedido: el método Tarjeta aparecerá en la página de pago. Puedes probar antes con las Credenciales de prueba y tarjetas de test de MercadoPago."},
  {"title":"El pago se acredita solo","body":"Cuando el cliente paga, MercadoPago nos notifica y el pedido se marca pagado automáticamente con su registro en la actividad."}
]'::jsonb where id = 'mercadopago';

update public.plugins set guide = '[
  {"title":"Consigue una URL receptora","body":"Crea un webhook en Zapier, Make o tu propio backend que acepte peticiones POST con JSON."},
  {"title":"Pégala en Configurar","body":"Guarda la URL del webhook. Opcionalmente define un Secreto de firma para validar que los eventos vienen de Hiraticket."}
]'::jsonb where id = 'webhooks';

update public.plugins set guide = '[
  {"title":"Crea tu cuenta en Facturapi","body":"Regístrate y carga tus sellos CSD del SAT.","url":"https://facturapi.io"},
  {"title":"Copia tu API Key","body":"En Configuración → API Keys copia la llave Live y pégala en Configurar junto con tu RFC emisor."}
]'::jsonb where id = 'facturapi';

update public.plugins set guide = '[
  {"title":"Crea tu cuenta en Skydropx","body":"Regístrate y solicita acceso API.","url":"https://www.skydropx.com"},
  {"title":"Copia tu API Key","body":"Pégala en Configurar para generar guías desde cada pedido."}
]'::jsonb where id = 'skydropx';
