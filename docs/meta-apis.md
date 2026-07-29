# Migrar Hiraticket a las APIs oficiales de Meta

**Objetivo:** que los números de tus clientes no corran riesgo de baneo, poder lanzar
campañas masivas legalmente, y conectar Instagram y Facebook Messenger como canales
dentro de Hiraticket.

**Dónde estamos hoy:** el worker (`services/whatsapp`, Go + `whatsmeow`) se conecta al
protocolo de WhatsApp **no oficial** (emula un dispositivo vinculado, como WhatsApp Web).
Eso funciona, pero va contra los Términos de Servicio de WhatsApp: Meta puede banear el
número en cualquier momento, sobre todo si envía mensajes masivos, muchos mensajes a
contactos que no han escrito primero, o si varios usuarios lo reportan como spam. No hay
apelación confiable. La única forma de eliminar ese riesgo es la **WhatsApp Business
Platform (Cloud API)** — la API oficial.

---

## 1. Conceptos clave (el vocabulario de Meta)

| Término | Qué es |
|---|---|
| **Business Portfolio** (antes Business Manager) | La cuenta "madre" de una empresa en Meta. Agrupa páginas, apps, WABAs, métodos de pago. |
| **Verificación de negocio** | Proceso donde Meta valida que la empresa existe (documentos, sitio web, teléfono). Toma ~2–5 días hábiles. Desbloquea los límites reales de envío. |
| **WABA** (WhatsApp Business Account) | La cuenta de WhatsApp API de un negocio. Contiene sus números, plantillas y calificación de calidad. |
| **Cloud API** | La API oficial hosteada por Meta (gratis la infraestructura; pagas por mensaje). Reemplazó a la API on-premise. |
| **BSP / Tech Provider** | Empresa (como Hiraticket) que conecta clientes a la Cloud API desde su plataforma. **Tech Provider** es el programa actual de Meta para esto — no necesitas ser un BSP "clásico" con facturación de Meta. |
| **Embedded Signup** | El popup oficial de onboarding: tu cliente conecta su WhatsApp/página/IG a tu plataforma en ~2 minutos sin salir de Hiraticket. |
| **Plantillas (templates)** | Mensajes pre-aprobados por Meta, obligatorios para iniciar conversación o para campañas. Categorías: `marketing`, `utility`, `authentication`. |
| **Ventana de 24 h** | Cuando un cliente te escribe, puedes responder libre (mensajes "service", gratis) durante 24 h. Fuera de la ventana, solo plantillas (de pago). |

---

## 2. La decisión de arquitectura: dos rutas

### Ruta A — Cada cliente crea su propia cuenta a mano
Cada negocio va a developers.facebook.com, crea su app, su WABA, genera un token y lo
pega en Hiraticket. **No la recomiendo**: es fricción enorme para pymes, tokens que
expiran, soporte imposible.

### Ruta B — Hiraticket como Tech Provider (recomendada)
Hiraticket tiene **una** app de Meta. Tus clientes se conectan con **Embedded Signup**
desde la sección Plugins/Settings: un popup de Meta donde inician sesión con Facebook,
crean o eligen su WABA, verifican su número por SMS y listo — tu app recibe acceso a su
WABA vía tokens que administra tu backend. Todo el tráfico entra por **tu** webhook.

El resto del documento asume la Ruta B.

---

## 3. Paso a paso — WhatsApp Cloud API (Tech Provider)

### Fase 0 · Prepara la empresa (1 día + espera de Meta)
1. Crea el **Business Portfolio** de Hiraticket/Moca en [business.facebook.com](https://business.facebook.com) con datos reales: razón social, dirección, sitio web con dominio propio, email corporativo.
2. En **Configuración del negocio → Centro de seguridad**, inicia la **verificación del negocio** (sube acta constitutiva / CFDI / comprobante con el mismo nombre legal). Tarda ~2–5 días hábiles.
3. Activa 2FA en todos los admins del portfolio.

### Fase 1 · Crea la app y el producto WhatsApp (1 día)
1. En [developers.facebook.com](https://developers.facebook.com) crea una **app tipo Business** ligada al portfolio.
2. Agrega el producto **WhatsApp**. Meta te da un número de prueba y una WABA de test — con eso puedes desarrollar todo antes de tener clientes reales.
3. Agrega el producto **Facebook Login for Business** (lo usa Embedded Signup).

### Fase 2 · Webhook en Hiraticket (2–4 días de dev)
1. Crea un endpoint HTTPS (p. ej. `https://app.hiraticket.com/api/meta/webhook`):
   - `GET` responde el `hub.challenge` (verificación).
   - `POST` recibe eventos: `messages` (entrantes), `statuses` (sent/delivered/read), plantillas aprobadas/rechazadas, cambios de calidad.
2. Valida la firma `X-Hub-Signature-256` con el App Secret.
3. Mapea los eventos al modelo actual: `conversations` / `messages` / `contacts` ya soportan esto — el worker de whatsmeow hace exactamente lo mismo hoy, solo cambia la fuente.

### Fase 3 · App Review + permisos avanzados (1–2 semanas)
Para operar cuentas de clientes necesitas **Advanced Access** en:
- `whatsapp_business_management` (administrar WABAs, plantillas, números)
- `whatsapp_business_messaging` (enviar/recibir mensajes)
- `business_management`

Meta pide **videos** demostrando: un mensaje creado en Hiraticket y recibido en un
teléfono real, y la creación de una plantilla desde tu UI. Grábalos con la WABA de
prueba. Sin verificación de negocio (Fase 0) no te dan Advanced Access.

### Fase 4 · Embedded Signup en la UI (3–5 días de dev)
1. Configura Embedded Signup en la app (Facebook Login for Business → Configurations).
2. En Hiraticket agrega el botón "Conectar WhatsApp oficial": abre el popup de Meta (SDK de JS), el cliente elige/crea su WABA y verifica su número.
3. El callback te devuelve un `code` → lo intercambias por un **token de sistema del cliente**; guárdalo cifrado (ya tienes `PLUGIN_SECRET_KEY` y el patrón de plugins para esto).
4. Suscribe tu app a la WABA del cliente (`/{waba-id}/subscribed_apps`) para que sus mensajes lleguen a tu webhook.
5. Registra el número (`/{phone-id}/register`).

> Límite inicial de onboarding: **10 clientes nuevos por ventana de 7 días** hasta que
> Meta te suba el cupo (se solicita desde el panel de Partner en WhatsApp Manager).

### Fase 5 · El número del cliente (por cliente, ~30 min)
Opciones por cliente:
- **Número nuevo** dedicado a la API (lo más limpio).
- **Migrar su número actual**: se puede, pero el número queda ligado a la API (deja de funcionar en la app WhatsApp Business normal)…
- **Coexistencia**: Meta ya permite en varios países (México incluido) usar la **app WhatsApp Business y la Cloud API a la vez** en el mismo número — el cliente conserva su app y Hiraticket ve/envía por API. Verifica disponibilidad actual en la doc de "Onboard WhatsApp Business app users" porque las regiones cambian.

Cada número necesita **display name** aprobado (debe coincidir con el negocio).

---

## 4. Cómo evitar baneos (la parte de "que no bloqueen a mis clientes")

Con la API oficial ya no hay "baneo por protocolo", pero sí **calificación de calidad**
y límites. Reglas de oro:

1. **Opt-in obligatorio.** Solo envía plantillas de marketing a gente que aceptó recibir mensajes (checkbox en checkout, mensaje inicial del cliente, formulario). Guarda evidencia del opt-in.
2. **Respeta la ventana de 24 h**: dentro de ella responde libre; fuera, solo plantillas.
3. **Cuida la calidad (verde/amarillo/rojo)**: la bajan los bloqueos y reportes de spam. En 2026 un rating rojo ya no degrada el tier automáticamente, pero sí congela tu crecimiento — y las violaciones de política sí bajan/banean.
4. **Límites de envío (tiers)**: sin verificar ≈ 250 conversaciones únicas/24 h → verificado Tier 1 = 1,000 → 10,000 → 100,000 → ilimitado. Meta re-evalúa cada 6 horas; se sube rápido si la calidad es buena.
5. **Calienta los números**: no lances una campaña de 5,000 mensajes el día 1. Sube volumen gradualmente.
6. **Plantillas honestas**: categoriza bien (si es marketing, márcala marketing — Meta recategoriza y penaliza), incluye nombre del negocio y opción de "responder BAJA / opt-out".
7. **Política de Comercio**: hay giros prohibidos (suplementos milagro, cripto, armas, etc.) — revisa que tus clientes no caigan ahí antes de conectarlos.
8. **Bots con IA**: desde 2026 Meta exige que los chatbots tengan tarea concreta y se identifiquen como bot — aplica a los agentes IA de Hiraticket.

---

## 5. Campañas (lo que hoy es la sección Campañas)

1. Cada campaña = una **plantilla de marketing** aprobada (se crean vía API `message_templates`, aprobación típica de minutos a 24 h).
2. Enviar = 1 llamada por destinatario a `/{phone-id}/messages` con `type: template`. El webhook te regresa `sent/delivered/read` → alimenta las métricas que ya tienes (`recipients`, `delivered`, `read`).
3. **Costo (México, por mensaje entregado, USD)**: marketing ≈ **$0.0436**, utility ≈ **$0.0080**, authentication ≈ **$0.0207**. Los mensajes de servicio (respuestas dentro de la ventana) son **gratis**. Utility/auth tienen descuentos por volumen; marketing no.
4. Meta factura al dueño de la WABA (tu cliente pone su tarjeta en su portfolio) — o Hiraticket puede absorber/re-facturar si se hace "onboarding con línea de crédito compartida" (modelo BSP completo; déjalo para después).
5. Respeta el tier del número: si el cliente está en Tier 1 (1,000/día), la campaña se pacea en Hiraticket (cola + throttle en el backend).

---

## 6. Conectar Instagram y Facebook Messenger

Ambos canales usan la **Messenger Platform / Instagram Platform** de la misma app de Meta.

### Facebook Messenger
1. Requisito del cliente: una **Página de Facebook**.
2. Permisos (App Review): `pages_messaging`, `pages_manage_metadata`, `pages_show_list`.
3. El cliente conecta con Facebook Login desde Hiraticket → eliges su página → suscribes la página a tu webhook (`messages`, `messaging_postbacks`).
4. Regla: ventana de **24 h** para responder; fuera de ella solo etiquetas/plantillas permitidas (las message tags viejas se están retirando en 2026 — usa Utility Templates / Marketing Messages API).

### Instagram
1. Requisito del cliente: cuenta **profesional** (Business o Creator).
2. Dos vías en 2026:
   - **Instagram API con Instagram Login** — el cliente inicia sesión con su Instagram directamente, **sin necesidad de página de Facebook**. Permiso clave: `instagram_business_manage_messages`.
   - **Vía Messenger Platform** — requiere la cuenta IG vinculada a una página de Facebook. Útil si de todos modos conectas Messenger.
3. Reglas duras 2026: solo puedes escribir a quien te escribió primero, ventana de 24 h, ~**200 DMs automatizados/hora por cuenta** y 1 DM por usuario/24 h en triggers de comentarios/stories.
4. En Hiraticket: agregar `channel: "wa" | "ig" | "fb"` a `conversations` y renderizar el badge del canal; el resto del pipeline (mensajes, asignación, pedidos) ya es agnóstico.

---

## 7. Plan técnico sugerido para Hiraticket

| Paso | Qué | Dónde |
|---|---|---|
| 1 | Endpoint webhook Meta (verify + firma + eventos) | `src/app/api/meta/webhook/route.ts` |
| 2 | Tabla `meta_accounts` (waba_id, phone_id, page_id, ig_id, tokens cifrados con `PLUGIN_SECRET_KEY`, canal) | migración nueva |
| 3 | Servicio de envío: `sendMessage()` decide worker whatsmeow **o** Graph API según la conexión del negocio | `src/lib/` |
| 4 | Embedded Signup UI ("Conectar WhatsApp oficial") | Plugins/Settings |
| 5 | Campañas → plantillas + cola con throttle por tier | `campaigns` existente |
| 6 | Canales IG/FB (badge + webhook unificado) | `conversations.channel` |
| 7 | Periodo híbrido: clientes actuales siguen en whatsmeow; los nuevos y los que quieran campañas migran a Cloud API | — |

**Importante:** mantén whatsmeow como opción "básica/gratis" (chats 1:1 de bajo volumen)
y ofrece la API oficial como plan superior — así la migración es gradual y el costo por
mensaje lo justifica el plan de pago.

---

## 8. Tiempos y costos resumidos

| Concepto | Estimado |
|---|---|
| Verificación de negocio Meta | 2–5 días hábiles |
| App Review (permisos avanzados WA + IG + FB) | 1–3 semanas |
| Dev: webhook + envío + Embedded Signup | 2–3 semanas |
| Dev: campañas con plantillas + IG/FB | 2–3 semanas |
| Infraestructura Cloud API | $0 (la hostea Meta) |
| Costo por mensaje MX (USD) | marketing $0.0436 · utility $0.0080 · auth $0.0207 · servicio gratis |
| Onboarding inicial | 10 clientes / 7 días (ampliable) |

---

## Fuentes

- [Pricing — WhatsApp Business Platform (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [WhatsApp Business API Pricing Mexico 2026](https://www.go4whatsup.com/mexico/whatsapp-business-api-pricing/)
- [WhatsApp Business API Pricing 2026 — per-message billing](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works)
- [Become a Tech Provider (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Embedded Signup — Overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Onboard WhatsApp Business app users / coexistencia (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Messaging Limits (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [WhatsApp Messaging Limits 2026 — tiers y calidad](https://chatarmin.com/en/blog/whats-app-messaging-limits)
- [Instagram API with Instagram Login — Messaging (Meta)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Instagram DM Automation Rules 2026](https://www.spurnow.com/en/blogs/instagram-dm-automation-rules)
- [Instagram DM Compliance 2026 — reglas de Meta](https://creatorflow.so/blog/instagram-dm-compliance-meta-rules/)
- [Tech Provider integration guide (Twilio, referencia del flujo)](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
