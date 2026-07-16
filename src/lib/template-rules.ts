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
}

const BODY_MAX = 1024;
const HEADER_MAX = 60;
const FOOTER_MAX = 60;
const NAME_RE = /^[a-z0-9_]{1,512}$/;
const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

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

  return comps;
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
