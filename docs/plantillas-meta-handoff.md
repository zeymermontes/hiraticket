# Plantillas oficiales de WhatsApp (Meta Cloud API): cómo está hecho en Hiraticket y cómo recrearlo

Este documento está escrito para un agente (Claude) que va a implementar lo mismo en otro proyecto.
Describe el gestor de plantillas de Meta, la creación, la edición, el borrado y el envío, con las
formas exactas de las llamadas a la Graph API, las reglas de validación y el modelo de datos.
El stack de referencia es Next.js (App Router, server actions) + Supabase (Postgres, RLS) +
TypeScript, pero todo se traduce a cualquier backend.

---

## 0. Conceptos y prerrequisitos en Meta

- **WABA** (WhatsApp Business Account): la cuenta dueña de los números y de las plantillas.
  Las plantillas viven en la WABA, no en el número. `waba_id` es el identificador.
- **Phone number id**: identificador del número dentro de la WABA. Los mensajes se mandan a
  `POST /{phone_number_id}/messages`.
- **Token**: token de sistema permanente (system user) o el token que devuelve el Embedded
  Signup al intercambiar el `code`. Se guarda cifrado en la base, nunca llega al navegador.
- **Permisos de la app**: `whatsapp_business_messaging` (mandar/recibir) y
  `whatsapp_business_management` (crear/listar/editar plantillas). En App Review, Meta pide un
  screencast de la creación de una plantilla desde tu UI.
- **Ventana de 24 h**: tras el último mensaje del cliente hay 24 h de "chat libre" (texto,
  fotos, etc.). Fuera de esa ventana **solo** se puede iniciar con una plantilla aprobada.
- **Categorías**: `UTILITY` (transaccional), `MARKETING`, `AUTHENTICATION` (OTP; no lo
  ofrecemos en la UI). Meta puede recategorizar una plantilla al revisarla.
- **Estados de una plantilla**: `PENDING` → `APPROVED` | `REJECTED`; además `PAUSED`,
  `FLAGGED`, `IN_APPEAL`, `DISABLED`. Solo `APPROVED` se puede mandar.
- **Método de pago obligatorio**: las plantillas fuera de ventana se cobran. Sin tarjeta en la
  WABA, Meta acepta la llamada (devuelve wamid) y luego manda un status `failed` con
  `131042 Business eligibility payment issue`. Como Tech Provider no puedes prestar tu línea de
  crédito: cada cliente agrega su método de pago en WhatsApp Manager → Configuración → Pagos.
- **Versión de Graph**: `https://graph.facebook.com/v21.0`.

---

## 1. Modelo de datos

No hay tabla de plantillas de Meta: **siempre se leen en vivo de Graph**. Lo único persistido es
la sesión oficial y, en cada mensaje enviado, la especificación de la plantilla que salió.

### 1.1 Sesión oficial (`whatsapp_sessions`)

```sql
-- una fila por negocio con connect_method='official'
alter table whatsapp_sessions
  add column if not exists waba_id text,
  add column if not exists phone_number_id text,
  add column if not exists cloud_token text;          -- cifrado (AES-GCM, "enc:v1:…")
create unique index if not exists idx_wa_sessions_phone_number_id
  on whatsapp_sessions (phone_number_id) where phone_number_id is not null;
-- connect_method check: ('qr','pairing','official'); status: 'connected' | 'disconnected'
```

Lookup en servidor (cliente admin, sin RLS):

```ts
export interface CloudSession { id: string; businessId: string; phone: string | null; wabaId: string; phoneNumberId: string; token: string }

export async function officialSessionOf(businessId: string): Promise<CloudSession | null> {
  const { data } = await admin.from("whatsapp_sessions")
    .select("id, business_id, phone, waba_id, phone_number_id, cloud_token")
    .eq("business_id", businessId).eq("connect_method", "official").eq("status", "connected")
    .limit(1).maybeSingle();
  if (!data?.waba_id || !data.phone_number_id || !data.cloud_token) return null;
  return { …, token: decryptSecret(data.cloud_token) };   // null si no descifra
}
// Para enrutar el webhook: la misma consulta por phone_number_id.
```

### 1.2 Mensajes (`messages`)

Columnas relevantes: `direction ('in'|'out')`, `type`, `body` (cifrado en reposo), `state`
(`queued` → `sending` → `sent` → `delivered` → `read`, o `failed`), `wa_id` (wamid de Meta),
`meta jsonb`, `fail_reason text`, `send_attempts int`, `next_retry_at timestamptz`, `deleted bool`.

Un envío de plantilla es una fila `type:"text"` con el **texto ya renderizado** en `body` (para
mostrarlo) y la especificación real en `meta.template`:

```ts
type WaTemplateMeta = {
  name: string;            // nombre de la plantilla en Meta
  lang: string;            // "es_MX", "en_US"…
  params: string[];        // valores de {{1}}, {{2}}… del cuerpo, en orden
  headerParam?: string;    // valor de {{1}} del encabezado, si lo tiene
  header?: string | null;  // encabezado ya renderizado (solo para pintar la burbuja)
  footer?: string | null;  // pie (solo para pintar)
  buttons?: TemplateButton[]; // botones fijos (solo para pintar)
};
```

---

## 2. Cliente de la Graph API (server-only)

```ts
const GRAPH = "https://graph.facebook.com/v21.0";
type CloudResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

async function graph<T>(path: string, token: string, init?: RequestInit): Promise<CloudResult<T>> {
  try {
    const res = await fetch(`${GRAPH}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const json = await res.json();
    if (!res.ok) {
      // Meta pone el texto útil en error_user_msg; error.message suele ser "Invalid parameter".
      const e = json?.error;
      const msg = e?.error_user_msg || e?.message || `HTTP ${res.status}`;
      return { ok: false, error: e?.error_user_title ? `${e.error_user_title}: ${msg}` : msg };
    }
    return { ok: true, data: json as T };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "network error" }; }
}
```

Mejora recomendada al recrearlo: conservar también `error.code` y `error_subcode` en el
resultado; nosotros solo guardamos el texto y luego adivinamos el código por substring.

### 2.1 Endpoints de plantillas

| Operación | Llamada | Cuerpo / notas |
|---|---|---|
| Listar | `GET {waba_id}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100` | Sin paginación (agregar `paging.next` si esperas >100). |
| Crear | `POST {waba_id}/message_templates` | `{ name, category, language, components }` |
| Editar | `POST {template_id}` | `{ category?, components }` (reemplaza el contenido). Solo tiene sentido para `REJECTED`/`PAUSED`/`FLAGGED`; una aprobada se edita en Meta Business Manager (y vuelve a revisión). |
| Borrar | `DELETE {waba_id}/message_templates?name={name}` | Borra **todos los idiomas** con ese nombre. Con `&hsm_id={id}` borra solo uno. |

Respuesta de crear: `{ id, status: "PENDING", category }`. Cada fila de listar:

```ts
interface TemplateRow {
  id: string; name: string; status: string; category: string; language: string;
  components?: { type: string; format?: string; text?: string;
                 buttons?: { type: string; text?: string; url?: string; phone_number?: string }[] }[];
  rejected_reason?: string;
}
```

### 2.2 Endpoints de envío / onboarding

| Operación | Llamada | Cuerpo |
|---|---|---|
| Enviar cualquier cosa | `POST {phone_number_id}/messages` | `{ messaging_product:"whatsapp", recipient_type:"individual", to:"<E.164 sin +>", ...payload }` |
| Suscribir la app a la WABA | `POST {waba_id}/subscribed_apps` | (vacío). Sin esto Meta nunca llama al webhook. |
| Registrar el número | `POST {phone_number_id}/register` | `{ messaging_product:"whatsapp", pin:"000000" }` |
| Info del número | `GET {phone_number_id}?fields=display_phone_number,verified_name` | |
| Intercambio del code del Embedded Signup | `GET oauth/access_token?client_id=&client_secret=&code=` | devuelve `access_token` |

---

## 3. Reglas de plantillas (archivo puro, compartido por UI y servidor)

Un solo módulo sin imports de servidor, usado por el constructor (validación en vivo + preview) y
por las server actions (guardia final antes de llamar a Meta). Reproduce las restricciones
documentadas de Meta para fallar con un mensaje claro en vez de un rechazo crudo.

### 3.1 Tipos y constantes

```ts
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";
export type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";   // solo botones ESTÁTICOS
export interface TemplateButton { type: TemplateButtonType; text: string; url?: string; phone?: string }
export interface TemplateDraft {
  name: string; category: TemplateCategory; language: string;
  header: string;   // encabezado TEXT opcional ("" = ninguno)
  body: string;     // obligatorio
  footer: string;   // opcional
  examples: Record<string, string>;  // "1","2",… ejemplos de {{n}} del cuerpo; "header" → ejemplo del encabezado
  buttons?: TemplateButton[];
}
const BODY_MAX = 1024, HEADER_MAX = 60, FOOTER_MAX = 60, BUTTON_TEXT_MAX = 25;
const BUTTONS_MAX = 10, URL_BUTTONS_MAX = 2, PHONE_BUTTONS_MAX = 1, URL_MAX = 2000;
const NAME_RE = /^[a-z0-9_]{1,512}$/;
export const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
```

### 3.2 `validateTemplate(draft, lang)` → `Issue[]` (`{ level:"error"|"warn", msg }`)

Todas las reglas actuales son `error`:

**Nombre**: obligatorio; solo `a-z 0-9 _` (la UI ya lo normaliza a minúsculas y `_`).

**Cuerpo**:
- obligatorio, ≤ 1024 caracteres;
- variables secuenciales desde `{{1}}` sin saltos;
- cada variable del cuerpo necesita ejemplo (`examples[n]`);
- no dos variables seguidas (`{{1}} {{2}}`), hay que poner texto entre ellas;
- no puede ser solo variables;
- **no puede empezar ni terminar con una variable**, y Meta ignora la puntuación alrededor:
  `"…total es de {{2}}."` sigue contando como terminar en variable (error Meta `2388299`).
  Implementación: quitar `[\s.,;:!?¡¿()"'\-–—]+` al final/inicio y luego probar `/\{\{\s*\d+\s*\}\}$/`.

**Encabezado** (opcional, solo TEXT): ≤ 60; máximo una variable, que debe ser `{{1}}`, con
`examples.header`.

**Pie** (opcional): ≤ 60; sin variables.

**Botones** (opcional):
- ≤ 10 en total; ≤ 2 `URL`; ≤ 1 `PHONE_NUMBER`;
- las respuestas rápidas deben ir **agrupadas**, no intercaladas con enlaces/llamadas
  (mapea cada botón a `q`/`c` y rechaza `/qc+q|cq+c/`);
- texto obligatorio, ≤ 25, sin variables ni saltos de línea, único (sin distinguir mayúsculas);
- `URL`: `^https?://\S+\.\S+`, ≤ 2000, **sin variables** (un `{{1}}` en la URL exigiría un
  parámetro en cada envío; no lo soportamos);
- `PHONE_NUMBER`: 8 a 20 dígitos con código de país.

### 3.3 `buildComponents(draft)` → el array `components` que Meta espera

```ts
export function buildComponents(d: TemplateDraft): Record<string, unknown>[] {
  const comps: Record<string, unknown>[] = [];
  if (d.header.trim()) {
    const header: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: d.header };
    if (extractVars(d.header).length === 1) header.example = { header_text: [(d.examples.header ?? "").trim()] };
    comps.push(header);
  }
  const body: Record<string, unknown> = { type: "BODY", text: d.body };
  const bodyVars = uniqueVars(d.body);
  if (bodyVars.length) body.example = { body_text: [bodyVars.map((n) => (d.examples[String(n)] ?? "").trim())] };
  comps.push(body);
  if (d.footer.trim()) comps.push({ type: "FOOTER", text: d.footer });
  const buttons = d.buttons ?? [];
  if (buttons.length) comps.push({
    type: "BUTTONS",
    buttons: buttons.map((b) =>
      b.type === "URL" ? { type: "URL", text: b.text.trim(), url: (b.url ?? "").trim() }
      : b.type === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: "+" + (b.phone ?? "").replace(/\D/g, "") }
      : { type: "QUICK_REPLY", text: b.text.trim() }),
  });
  return comps;
}
```

Ejemplo del JSON completo que se manda a `POST {waba_id}/message_templates`:

```json
{
  "name": "actualizacion_pedido",
  "category": "UTILITY",
  "language": "es_MX",
  "components": [
    { "type": "HEADER", "format": "TEXT", "text": "Hola {{1}}", "example": { "header_text": ["Ana"] } },
    { "type": "BODY", "text": "Tu pedido {{1}} ya está listo. El total es {{2}} MXN.", "example": { "body_text": [["#1042", "350"]] } },
    { "type": "FOOTER", "text": "Responde a este mensaje si tienes dudas." },
    { "type": "BUTTONS", "buttons": [
      { "type": "QUICK_REPLY", "text": "Confirmar" },
      { "type": "QUICK_REPLY", "text": "Cambiar fecha" },
      { "type": "URL", "text": "Ver pedido", "url": "https://ejemplo.com/pedidos" },
      { "type": "PHONE_NUMBER", "text": "Llamar", "phone_number": "+525512345678" }
    ] }
  ]
}
```

### 3.4 `templateParts(components)` → lo que Meta devuelve, reducido a lo que se pinta y envía

```ts
export interface TemplateParts {
  header: string;               // solo encabezado TEXT
  mediaHeader: string | null;   // "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION" si el encabezado no es texto
  body: string; footer: string;
  buttons: TemplateButton[];    // QUICK_REPLY, PHONE_NUMBER y URL sin variable
  unsupportedButtons: number;   // URL con variable, COPY_CODE, FLOW, OTP…
}
```

`renderPreview(text, examples, headerVar=false)` sustituye cada `{{n}}` por su ejemplo (o lo deja
como `{{n}}`); con `headerVar` usa `examples.header`. `isEditableInApp(status)` es `true` para
`REJECTED | PAUSED | FLAGGED`.

---

## 4. El gestor (UI) de plantillas de Meta

### 4.1 Dónde vive

Página "Plantillas" con un control segmentado de dos pestañas: **"Mis plantillas"** (respuestas
guardadas propias, se mandan al instante dentro de la ventana) y **"Oficiales de Meta"**. La
segunda pestaña solo se muestra si el negocio tiene sesión oficial conectada (el servidor pasa un
booleano, nunca el token). Texto explicativo de la pestaña:

> Las aprueba Meta y son lo único que puedes mandar cuando pasaron más de 24 h desde el último
> mensaje del cliente. Las de "Mis plantillas" son tuyas: se usan al instante, mientras el chat
> esté abierto.

### 4.2 Server actions del gestor (todas resuelven credenciales con `officialSessionOf(negocio)`)

```ts
listTemplatesAction(): CloudResult<TemplateRow[]>          // listTemplates(wabaId, token).data.data
createTemplateAction(draft): CloudResult                    // validateTemplate → createTemplateFull(wabaId, token, { name, category, language, components: buildComponents(draft) })
editTemplateAction(templateId, status, draft): CloudResult  // rechaza si !isEditableInApp(status); validate → editTemplate(templateId, token, { category, components })
deleteTemplateAction(name): CloudResult                     // deleteTemplate(wabaId, token, name)
```

Importante: el gestor debe escribir en **la misma WABA** de la que el chat lee las plantillas
para enviar. Si el gestor creara en otra cuenta, la plantilla saldría aprobada en la lista y
jamás aparecería al ir a mandarla.

### 4.3 Componente `TemplateManager`

Constantes: `LANGS = ["es_MX","es_ES","en_US","en_GB","pt_BR"]`, `CATS = ["UTILITY","MARKETING"]`,
`BUTTON_TYPES = ["QUICK_REPLY","URL","PHONE_NUMBER"]`, borrador vacío
`{ name:"", category:"UTILITY", language:"es_MX", header:"", body:"", footer:"", examples:{}, buttons:[] }`.

Estado: `draft`, `editing: {id, status} | null`, `list: TemplateRow[]`, `note: {ok, text} | null`,
`openRow` (fila con la vista previa desplegada), `pending`.

**Constructor** (izquierda):

| Campo | Detalle |
|---|---|
| Nombre | `a-z 0-9 _`; se normaliza al escribir (`toLowerCase`, todo lo demás → `_`); deshabilitado al editar |
| Categoría | select de `CATS` |
| Idioma | select de `LANGS`; deshabilitado al editar |
| Encabezado | "Encabezado (opcional, máx. 60)" |
| Cuerpo | textarea + botón "+ Variable" (inserta `{{siguiente}}`) + contador `n/1024` |
| Pie | "Pie de página (opcional, máx. 60, sin variables)" |
| Botones | fila por botón: tipo, texto (maxLength 25), URL o teléfono según tipo, botón × para quitar; "+ Botón" mientras haya < 10. Si hay alguna respuesta rápida, aviso: *"Cuando el cliente toca una respuesta rápida, te llega como un mensaje suyo, y eso reabre el chat libre por 24 h."* |
| Ejemplos | un input por variable del cuerpo ("Ejemplo {{n}}") y uno para el encabezado ("Ejemplo encabezado {{1}}"). Meta los exige para revisar |

Validación en vivo: `validateTemplate(draft, lang)` en cada render; los errores se listan con ⛔
y el botón "Crear plantilla" / "Guardar cambios" queda deshabilitado mientras haya errores.
El resultado de Meta se muestra tal cual (`r.error`) o "Plantilla enviada a revisión ✓" /
"Plantilla actualizada ✓".

**Vista previa** (derecha): `WaTemplatePreview` con `renderPreview(draft.body, draft.examples)`.

**Lista "Plantillas del número"**: botón "Actualizar"; cada fila muestra nombre (mono), pill de
estado, `categoría · idioma`, y si está `REJECTED` el `rejected_reason` de Meta. Ojo abre la vista
previa reconstruida con `templateParts`; si `unsupportedButtons > 0` avisa que hay botones de un
tipo no manejado. "Editar" solo si `isEditableInApp(status)`; si no, enlace a
`https://business.facebook.com/wa/manage/message-templates/` ("Meta Manager"). Papelera → confirm
*"Eliminar plantilla — «nombre»: se borran todos sus idiomas"* → `deleteTemplateAction`.

Colores de estado: `APPROVED` verde · `PENDING`/`IN_APPEAL` azul · `PAUSED`/`FLAGGED` ámbar ·
`REJECTED` rojo · otro gris.

Al editar una existente: `rowToDraft(row)` usa `templateParts(row.components)`; los ejemplos vuelven
vacíos porque Meta **no devuelve los examples**, el usuario los reescribe.

### 4.4 `WaTemplatePreview` (una sola imitación de WhatsApp para todo)

Props: `header?`, `mediaHeader?` (se anuncia, no se dibuja), `body`, `footer?`, `buttons=[]`,
`emptyLabel?`, `compact?` (sin el fondo de chat). Colores fijos de WhatsApp (no del tema):
burbuja `#fff`, fondo `#e5ddd5`, botones `#00a5f4`, separador `#e9edef`. Iconos por tipo de botón:
`QUICK_REPLY → reply`, `URL → external`, `PHONE_NUMBER → phone`. Se usa en el constructor, en la
lista, en el selector del chat y en la burbuja del mensaje enviado. La regla: un solo dibujo para
que la vista previa sea una promesa real de cómo lo verá el cliente.

---

## 5. Envío de una plantilla desde el chat

### 5.1 Ventana de 24 h

Datos por conversación: `last_inbound_at` (created_at del último mensaje `direction='in'`) y
`wa_official` (el negocio tiene sesión oficial conectada).

```ts
const lastInboundAt = max(detail.last_inbound_at, último msg "in" cargado en pantalla);
const waBlocked = detail.wa_official && !detail.is_group && !(lastInboundAt && lastInboundAt + 24*3600_000 > now);
// `now` se refresca cada 60 s para que el bloqueo aparezca solo al vencer la ventana.
```

Cuando `waBlocked`: se oculta el compositor completo y se muestra un banner:

> La ventana de 24 h está cerrada: WhatsApp solo permite iniciar con una plantilla aprobada.
> Cuando el cliente responda, el chat libre se reabre. **[Enviar plantilla]**

Cualquier intento de enviar (`doSend`) con la ventana cerrada abre el modal de plantillas en vez de
mandar. Un tap del cliente en una respuesta rápida llega como mensaje entrante y reabre la ventana.

### 5.2 Modal "Enviar plantilla"

1. Al abrir, `getWaTemplates()`: `listTemplates` → solo `status === "APPROVED"` → cada una pasa por
   `templateParts` → `WaTemplateOption`:
   ```ts
   { name, language, body, header|null, footer|null, varCount /* variables distintas del cuerpo */,
     headerVar /* el encabezado lleva {{1}} */, mediaHeader, buttons,
     blocked: mediaHeader ? "media-header" : unsupportedButtons ? "buttons" : null }
   ```
2. Lista con vista previa de cada una. Al elegir: un input por variable del cuerpo
   ("Valor de la variable n") y uno para el encabezado si `headerVar`. La vista previa se rellena en
   vivo. `blocked` muestra por qué no se puede mandar (encabezado multimedia o botón dinámico) y
   deshabilita Enviar.
3. `ready` = elegida ∧ !blocked ∧ (headerParam si headerVar) ∧ todos los params llenos.
4. Enviar → `sendWaTemplate(convId, { name, language, body, header, footer, buttons }, params, headerParam)`.
   Con `ok`, el cliente pinta una burbuja optimista con `meta.template` y cierra.

### 5.3 `sendWaTemplate` (server action)

```ts
const session = await officialSessionOf(businessId);
if (!session) return { ok: false, error: "no-official-session" };
const rendered = tpl.body.replace(VAR_RE, (_, n) => params[Number(n) - 1] ?? "");
await supabase.from("messages").insert({
  business_id, conversation_id: convId, direction: "out", type: "text",
  body: encryptBody(businessId, rendered),          // texto para mostrar
  author_id: userId, state: "queued",
  meta: { template: { name: tpl.name, lang: tpl.language, params, headerParam?, header: renderedHeader?, footer?, buttons? } },
});
await supabase.from("conversations").update({ last_message_at: now }).eq("id", convId);
await flushCloudOutbox(businessId);                   // despacho inmediato
```

### 5.4 Outbox (`flushCloudOutbox`): de la fila al payload de Meta

Máquina de estados: `queued → sending` (reclamo atómico: `update({state:"sending"}).eq("state","queued")`,
así dos flushes concurrentes no duplican) `→ sent` (con `wa_id`) `→ delivered/read` por webhook;
un rechazo cae en `failed` + `fail_reason`. Se procesan lotes de 25 filas `out`, `queued`,
`deleted=false`, `next_retry_at` nulo o vencido, en orden cronológico.

Payload de plantilla (los botones **estáticos** no llevan componente: Meta los agrega solo):

```ts
const tpl = m.meta?.template;
const components = [
  ...(tpl.headerParam ? [{ type: "header", parameters: [{ type: "text", text: tpl.headerParam }] }] : []),
  ...(tpl.params?.length ? [{ type: "body", parameters: tpl.params.map((t) => ({ type: "text", text: t })) }] : []),
];
const payload = {
  type: "template",
  template: { name: tpl.name, language: { code: tpl.lang }, ...(components.length ? { components } : {}) },
};
// Respuesta a otro mensaje: payload.context = { message_id: quoted.wa_id }
const res = await sendCloudPayload(session.phoneNumberId, session.token, toDigits, payload);
if (res.ok) update({ state: "sent", wa_id: res.data.messages[0].id, send_attempts: 0, next_retry_at: null });
else        update({ state: "failed", fail_reason: res.error.slice(0, 300) });
```

JSON completo que recibe `POST {phone_number_id}/messages`:

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5215512345678",
  "type": "template",
  "template": {
    "name": "actualizacion_pedido",
    "language": { "code": "es_MX" },
    "components": [
      { "type": "header", "parameters": [{ "type": "text", "text": "Ana" }] },
      { "type": "body",   "parameters": [{ "type": "text", "text": "#1042" }, { "type": "text", "text": "350" }] }
    ]
  }
}
```

Fallos tempranos antes de llamar a Meta: la conversación es un grupo (la Cloud API no soporta
grupos), el contacto no tiene teléfono, el cuerpo no se puede descifrar.

### 5.5 Burbuja del mensaje enviado

Si `meta.template` trae `header`, `footer` o `buttons`, la burbuja renderiza
`<WaTemplatePreview compact header body={m.body} footer buttons />` en lugar del texto plano, para
que el agente vea exactamente lo que vio el cliente (botones incluidos). Si `state === "failed"`,
debajo de la hora se muestra el motivo (ver §7) y un botón **Reintentar** que, para plantillas,
pide confirmación: *"Se vuelve a mandar al cliente. Si ya le había llegado, la recibiría dos veces."*
`retryMessage` pone `state:"queued", send_attempts:0, next_retry_at:null` y vuelve a hacer flush.
Nada reintenta un `failed` automáticamente.

### 5.6 Eliminar un mensaje

En sesión oficial no hay "borrar para todos" en la Cloud API. Regla: si la fila no tiene `wa_id`
(nunca salió: fallida o en cola) se marca `deleted=true, body=""` de inmediato, y si estaba en cola
se cierra como `failed` para que ningún despachador la mande después; si sí tiene `wa_id` y la
sesión es oficial, solo se quita localmente.

---

## 6. Webhook

Endpoint público `GET|POST /api/whatsapp/webhook`.

- **GET** (verificación): si `hub.mode === "subscribe"` y `hub.verify_token === WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
  responde `hub.challenge` en `text/plain`; si no, 403.
- **POST**: verificar firma `x-hub-signature-256 = "sha256=" + HMAC_SHA256(rawBody, WHATSAPP_APP_SECRET)`
  con comparación en tiempo constante (401 si falta o no coincide). Luego, por cada
  `entry[].changes[]`, despachar `ingest(change.field, change.value)`. Responder siempre 200
  `{ok:true}` (Meta reintenta si no).
- **Enrutado**: `value.metadata.phone_number_id` → sesión oficial; si no hay, se descarta.
- **Campos que manejamos**:
  - `messages`: mensajes entrantes (dedupe por wamid), y `statuses[]` → estado de nuestros
    mensajes salientes buscando por `wa_id`:
    ```ts
    const map = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
    if (failed) fail_reason = unique([errors[0].title, errors[0].message]).join(": ").slice(0, 300);
    // "delivered" nunca pisa "read" (los recibos llegan desordenados)
    ```
    Cada evento de status además dispara `flushCloudOutbox(negocio)` como "tick" para drenar envíos
    programados.
  - `smb_message_echoes` (coexistencia): mensajes que el dueño mandó desde el teléfono; se guardan
    como salientes sin autor. **Carrera a cubrir**: el eco de nuestro propio envío puede llegar
    antes de que guardemos el `wa_id`; si hay una fila `out` en `sending` sin `wa_id` en los últimos
    90 s en esa conversación, se le cuelga el wamid en vez de insertar un duplicado.
  - Taps en botones: `type:"button"` (quick reply de plantilla → `button.text`, `button.payload`) y
    `type:"interactive"` (`button_reply`/`list_reply` → `title`). Se guardan como texto entrante con
    `meta.wa_reply`, lo que reabre la ventana de 24 h.
  - `history`, `smb_app_state_sync` (coexistencia: historial y nombres de contactos).
- **No manejado todavía** (recomendado al recrear): `message_template_status_update` (aprobada /
  rechazada / pausada) y `message_template_quality_update`. Hoy el estado solo se refresca al
  pulsar "Actualizar" en el gestor.

Variables de entorno: `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (inventado, se pega en Meta),
`WHATSAPP_APP_SECRET` (Meta app → Configuración → Básica), `NEXT_PUBLIC_FB_APP_ID`,
`NEXT_PUBLIC_WA_ES_CONFIG_ID` (config del Embedded Signup), `PLUGIN_SECRET_KEY` (cifra el token).

---

## 7. Errores de Meta que conviene traducir al usuario

`fail_reason` guarda `title: message` de Meta. Hints que mostramos (por substring):

| Señal | Qué significa | Qué decirle al usuario |
|---|---|---|
| `131042` / "Business eligibility payment issue" | La WABA no tiene método de pago; llega como **status failed por webhook** después de que la API aceptó el envío | Agregar tarjeta en WhatsApp Manager → Configuración → Pagos y reintentar |
| `131047` / "Re-engagement message" | Ventana de 24 h cerrada y se mandó texto libre | Solo se puede iniciar con plantilla aprobada |
| `131049` / "healthy ecosystem engagement" | Meta limita plantillas de marketing a ese contacto | Esperar o usar una de utilidad |
| `132001` "Template name does not exist in the translation" | Nombre o idioma no coinciden con la aprobada | Revisar `name` + `language.code` |
| `132012` "Parameter format does not match" / `132000` "Number of parameters does not match" | Params de más/menos o con saltos de línea, tabs o >4 espacios seguidos | Validar params antes de mandar |
| `2388299` (al crear) | El cuerpo empieza o termina con variable | Ya lo bloquea `validateTemplate` |

---

## 8. Onboarding (cómo se obtienen waba_id, phone_number_id y token)

Embedded Signup en el navegador con el SDK de Facebook:

```ts
window.addEventListener("message", (e) => { const d = JSON.parse(e.data); if (d.type === "WA_EMBEDDED_SIGNUP") { phone_number_id = d.data.phone_number_id; waba_id = d.data.waba_id; } });
FB.login(cb, { config_id: NEXT_PUBLIC_WA_ES_CONFIG_ID, response_type: "code", override_default_response_type: true,
  extras: coexistence ? { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } : { setup: {}, sessionInfoVersion: "3" } });
// cb → POST /api/whatsapp/embedded-signup { code, waba_id, phone_number_id }
```

Servidor: intercambia `code` por `access_token` (`oauth/access_token`), `subscribed_apps` (fatal si
falla), `register` con pin `000000` (solo advertencia si falla), `display_phone_number`, y hace
upsert de la fila oficial con `cloud_token: encryptSecret(token)`. Si otro negocio ya tenía ese
`phone_number_id`, se le vacía la fila (el número se mueve).

---

## 9. Límites conocidos de esta implementación (para no heredarlos)

1. Solo encabezados **TEXT**. Plantillas con encabezado IMAGE/VIDEO/DOCUMENT se listan pero no se
   pueden crear ni enviar (haría falta pedir el archivo en cada envío y mandar
   `{ type:"header", parameters:[{ type:"image", image:{ link } }] }`).
2. Solo botones estáticos. `URL` con `{{1}}`, `COPY_CODE`, `FLOW`, OTP se cuentan como
   `unsupportedButtons` y bloquean el envío.
3. `listTemplates` sin paginación (`limit=100`).
4. Sin webhook de estado de plantilla; el gestor se refresca a mano.
5. El servidor no guarda `error.code`; los hints se detectan por texto.
6. Las automatizaciones ("flujos") mandan **plantillas propias** (texto guardado), no plantillas de
   Meta: con la ventana cerrada fallan con `131047`. Si en tu proyecto los flujos deben salir fuera
   de ventana, guarda en la acción del flujo el `name`/`lang` de una plantilla de Meta y el mapeo de
   variables, e inserta la fila con `meta.template`.
7. Borrar por nombre elimina todos los idiomas; usar `hsm_id` para uno solo.
8. Al editar, Meta no devuelve los ejemplos: hay que pedirlos otra vez.

---

## 10. Checklist para recrearlo en otro proyecto

1. Migración: columnas oficiales en la tabla de sesiones; `meta jsonb`, `wa_id`, `state`,
   `fail_reason`, `send_attempts`, `next_retry_at`, `deleted` en mensajes.
2. Módulo `cloud-session`: `officialSessionOf(businessId)` y `officialSessionByPhoneNumberId`.
3. Módulo `whatsapp-cloud` (server-only): `graph()` + los endpoints de §2.
4. Módulo puro `template-rules`: tipos, `validateTemplate`, `buildComponents`, `templateParts`,
   `renderPreview`, `isEditableInApp`, `VAR_RE`, `extractVars`, `uniqueVars`.
5. Server actions del gestor: listar / crear / editar / borrar (validando siempre en servidor).
6. UI: `WaTemplatePreview` único; `TemplateManager` (constructor + preview + lista) dentro de una
   pestaña "Oficiales de Meta" visible solo con sesión oficial.
7. Chat: cálculo de `waBlocked`, banner + modal `WaTemplateModal`, `getWaTemplates` (solo APPROVED),
   `sendWaTemplate` (fila `queued` con `meta.template`), burbuja con `WaTemplatePreview compact`,
   motivo de fallo visible, confirm al reintentar plantillas.
8. Outbox: reclamo atómico `queued→sending`, payload `type:"template"`, `sent`+`wa_id` / `failed`+`fail_reason`.
9. Webhook: verificación GET, firma HMAC, `statuses` → estado/`fail_reason`, taps de botones como
   entrantes, dedupe del eco, y (mejora) `message_template_status_update`.
10. Onboarding con Embedded Signup y `subscribed_apps`; documentar al cliente que debe agregar
    método de pago en su WABA antes de mandar plantillas.
