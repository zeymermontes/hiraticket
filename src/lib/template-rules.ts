// WhatsApp message-template rules — pure helpers shared by the builder UI (live validation +
// preview) and the server actions (final guard before hitting Meta). Mirrors Meta's documented
// constraints so we fail fast with a clear message instead of a raw Graph API rejection.

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface TemplateDraft {
  name: string;
  category: TemplateCategory;
  language: string;
  header: string; // optional TEXT header ("" = none)
  body: string; // required
  footer: string; // optional ("" = none)
  examples: Record<string, string>; // "1","2",… → body var examples; "header" → header var example
  buttons?: TemplateButton[]; // optional, in the order they show under the bubble
}

export type TemplateButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER";

// Only STATIC buttons: a URL with a {{1}} suffix would need a parameter on every send, and the
// composer has nowhere to ask for it. Quick replies come back as a normal inbound message.
export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string; // URL
  phone?: string; // PHONE_NUMBER, with country code
}

const BODY_MAX = 1024;
const HEADER_MAX = 60;
const FOOTER_MAX = 60;
const BUTTON_TEXT_MAX = 25;
const BUTTONS_MAX = 10;
const URL_BUTTONS_MAX = 2;
const PHONE_BUTTONS_MAX = 1;
const URL_MAX = 2000;
const NAME_RE = /^[a-z0-9_]{1,512}$/;
export const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

// Variable numbers in the order they appear.
export function extractVars(text: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text))) out.push(Number(m[1]));
  return out;
}

// Distinct variable numbers, sorted ascending.
export function uniqueVars(text: string): number[] {
  return [...new Set(extractVars(text))].sort((a, b) => a - b);
}

export interface Issue {
  level: "error" | "warn";
  msg: string;
}

export function validateTemplate(d: TemplateDraft, lang: "es" | "en" = "es"): Issue[] {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const issues: Issue[] = [];
  const err = (es: string, en: string) => issues.push({ level: "error", msg: t(es, en) });
  const warn = (es: string, en: string) => issues.push({ level: "warn", msg: t(es, en) });

  // Name
  if (!d.name.trim()) err("El nombre es obligatorio.", "Name is required.");
  else if (!NAME_RE.test(d.name))
    err("El nombre solo admite minúsculas, números y guion bajo (a-z, 0-9, _).", "Name allows only lowercase, digits and underscore (a-z, 0-9, _).");

  // Body
  const body = d.body.trim();
  if (!body) err("El cuerpo es obligatorio.", "Body is required.");
  if (d.body.length > BODY_MAX) err(`El cuerpo excede ${BODY_MAX} caracteres.`, `Body exceeds ${BODY_MAX} characters.`);

  // Body variables: sequential from 1, no gaps, examples present, not adjacent, not only-variables.
  const bodyVars = uniqueVars(d.body);
  bodyVars.forEach((n, i) => {
    if (n !== i + 1)
      err(
        `Las variables deben ir en orden desde {{1}} sin saltos (falta {{${i + 1}}}).`,
        `Variables must be sequential from {{1}} with no gaps (missing {{${i + 1}}}).`,
      );
  });
  for (const n of bodyVars) {
    if (!(d.examples[String(n)] ?? "").trim())
      err(`Falta el ejemplo de la variable {{${n}}}.`, `Missing example for variable {{${n}}}.`);
  }
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(d.body))
    err("No puede haber dos variables seguidas; agrega texto entre ellas.", "Two variables can't be adjacent; add text between them.");
  if (body && body.replace(VAR_RE, "").trim() === "")
    err("El cuerpo no puede ser solo variables.", "Body can't be only variables.");
  // Meta rejects bodies that begin or end with a variable (error 2388299) — and it ignores
  // surrounding punctuation, so "…total es de {{2}}." still counts as ending with a variable.
  const stripped = body.replace(/[\s.,;:!?¡¿()"'\-–—]+$/g, "");
  const strippedStart = body.replace(/^[\s.,;:!?¡¿()"'\-–—]+/g, "");
  if (/^\{\{\s*\d+\s*\}\}/.test(strippedStart))
    err(
      "El cuerpo no puede empezar con una variable; agrega texto antes.",
      "Body can't start with a variable; add text before it.",
    );
  if (/\{\{\s*\d+\s*\}\}$/.test(stripped))
    err(
      "El cuerpo no puede terminar con una variable (la puntuación no cuenta); agrega texto después, ej. “{{2}} MXN”.",
      "Body can't end with a variable (punctuation doesn't count); add text after it, e.g. “{{2}} MXN”.",
    );

  // Header (optional): TEXT, max 60, at most 1 variable, which must be {{1}} with an example.
  if (d.header.trim()) {
    if (d.header.length > HEADER_MAX) err(`El encabezado excede ${HEADER_MAX} caracteres.`, `Header exceeds ${HEADER_MAX} characters.`);
    const hv = extractVars(d.header);
    if (hv.length > 1) err("El encabezado admite máximo una variable.", "Header allows at most one variable.");
    if (hv.length === 1) {
      if (hv[0] !== 1) err("La variable del encabezado debe ser {{1}}.", "The header variable must be {{1}}.");
      if (!(d.examples.header ?? "").trim()) err("Falta el ejemplo de la variable del encabezado.", "Missing example for the header variable.");
    }
  }

  // Footer (optional): max 60, no variables.
  if (d.footer.trim()) {
    if (d.footer.length > FOOTER_MAX) err(`El pie excede ${FOOTER_MAX} caracteres.`, `Footer exceeds ${FOOTER_MAX} characters.`);
    if (extractVars(d.footer).length) err("El pie de página no admite variables.", "Footer can't contain variables.");
  }

  // Buttons (optional).
  const buttons = d.buttons ?? [];
  if (buttons.length > BUTTONS_MAX) err(`Máximo ${BUTTONS_MAX} botones.`, `At most ${BUTTONS_MAX} buttons.`);
  if (buttons.filter((b) => b.type === "URL").length > URL_BUTTONS_MAX)
    err(`Máximo ${URL_BUTTONS_MAX} botones de enlace.`, `At most ${URL_BUTTONS_MAX} link buttons.`);
  if (buttons.filter((b) => b.type === "PHONE_NUMBER").length > PHONE_BUTTONS_MAX)
    err("Solo se admite un botón de llamada.", "Only one call button is allowed.");
  // Meta rejects quick replies interleaved with link/call buttons: each kind must sit together.
  const kinds = buttons.map((b) => (b.type === "QUICK_REPLY" ? "q" : "c")).join("");
  if (/qc+q|cq+c/.test(kinds))
    err(
      "Las respuestas rápidas deben ir juntas, no intercaladas con enlaces o llamadas.",
      "Quick replies must be grouped together, not mixed between link or call buttons.",
    );
  const seen = new Set<string>();
  buttons.forEach((b, i) => {
    const n = i + 1;
    const text = b.text.trim();
    if (!text) err(`El botón ${n} no tiene texto.`, `Button ${n} has no text.`);
    if (b.text.length > BUTTON_TEXT_MAX) err(`El texto del botón ${n} excede ${BUTTON_TEXT_MAX} caracteres.`, `Button ${n} text exceeds ${BUTTON_TEXT_MAX} characters.`);
    if (extractVars(b.text).length || /\n/.test(b.text)) err(`El texto del botón ${n} no admite variables ni saltos de línea.`, `Button ${n} text can't contain variables or line breaks.`);
    if (text && seen.has(text.toLowerCase())) err(`El botón ${n} repite el texto de otro.`, `Button ${n} repeats another button's text.`);
    seen.add(text.toLowerCase());
    if (b.type === "URL") {
      const url = (b.url ?? "").trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) err(`El botón ${n} necesita un enlace que empiece con https://.`, `Button ${n} needs a link starting with https://.`);
      if (url.length > URL_MAX) err(`El enlace del botón ${n} es demasiado largo.`, `Button ${n} link is too long.`);
      if (extractVars(url).length) err(`El enlace del botón ${n} no admite variables.`, `Button ${n} link can't contain variables.`);
    }
    if (b.type === "PHONE_NUMBER") {
      const digits = (b.phone ?? "").replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 20) err(`El botón ${n} necesita un teléfono con código de país.`, `Button ${n} needs a phone number with country code.`);
    }
  });

  return issues;
}

// Build Meta's `components` array from a draft (assumes it already validates).
export function buildComponents(d: TemplateDraft): Record<string, unknown>[] {
  const comps: Record<string, unknown>[] = [];

  if (d.header.trim()) {
    const hv = extractVars(d.header);
    const header: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: d.header };
    if (hv.length === 1) header.example = { header_text: [(d.examples.header ?? "").trim()] };
    comps.push(header);
  }

  const body: Record<string, unknown> = { type: "BODY", text: d.body };
  const bodyVars = uniqueVars(d.body);
  if (bodyVars.length) body.example = { body_text: [bodyVars.map((n) => (d.examples[String(n)] ?? "").trim())] };
  comps.push(body);

  if (d.footer.trim()) comps.push({ type: "FOOTER", text: d.footer });

  const buttons = d.buttons ?? [];
  if (buttons.length)
    comps.push({
      type: "BUTTONS",
      buttons: buttons.map((b) =>
        b.type === "URL"
          ? { type: "URL", text: b.text.trim(), url: (b.url ?? "").trim() }
          : b.type === "PHONE_NUMBER"
            ? { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: "+" + (b.phone ?? "").replace(/\D/g, "") }
            : { type: "QUICK_REPLY", text: b.text.trim() },
      ),
    });

  return comps;
}

// What Meta returns for a template, reduced to what we draw and edit. The shape is declared here
// (not imported from whatsapp-cloud) so this file stays free of server-only imports.
export interface TemplateParts {
  header: string; // TEXT header only; media headers are reported through `mediaHeader`
  mediaHeader: string | null; // "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"
  body: string;
  footer: string;
  buttons: TemplateButton[];
  /** Buttons we can neither build nor send (dynamic URL, copy code, flows, OTP…). */
  unsupportedButtons: number;
}

type RawComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string }[];
};

export function templateParts(components: RawComponent[] | undefined): TemplateParts {
  const comps = components ?? [];
  const head = comps.find((c) => c.type === "HEADER");
  const isText = !head || (head.format ?? "TEXT") === "TEXT";
  const buttons: TemplateButton[] = [];
  let unsupportedButtons = 0;
  for (const b of comps.find((c) => c.type === "BUTTONS")?.buttons ?? []) {
    const text = b.text ?? "";
    if (b.type === "QUICK_REPLY") buttons.push({ type: "QUICK_REPLY", text });
    else if (b.type === "PHONE_NUMBER") buttons.push({ type: "PHONE_NUMBER", text, phone: b.phone_number ?? "" });
    else if (b.type === "URL" && !extractVars(b.url ?? "").length) buttons.push({ type: "URL", text, url: b.url ?? "" });
    else unsupportedButtons++;
  }
  return {
    header: isText ? (head?.text ?? "") : "",
    mediaHeader: isText ? null : (head?.format ?? null),
    body: comps.find((c) => c.type === "BODY")?.text ?? "",
    footer: comps.find((c) => c.type === "FOOTER")?.text ?? "",
    buttons,
    unsupportedButtons,
  };
}

// Substitute variables with their examples (or a placeholder) for the live preview.
export function renderPreview(text: string, examples: Record<string, string>, headerVar = false): string {
  return text.replace(VAR_RE, (_, n: string) => {
    const key = headerVar ? "header" : n;
    const ex = (examples[key] ?? "").trim();
    return ex || `{{${n}}}`;
  });
}

// Which template statuses we allow editing in-app. APPROVED must be edited on Meta's Manager site.
export function isEditableInApp(status: string): boolean {
  const s = status.toUpperCase();
  return s === "REJECTED" || s === "PAUSED" || s === "FLAGGED";
}
