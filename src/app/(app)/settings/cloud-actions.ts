"use server";
import { showOfficialWhatsApp } from "@/lib/whatsapp-official";
import {
  cloudTestCreds,
  sendText,
  sendTemplate,
  createTemplate,
  createTemplateFull,
  editTemplate,
  deleteTemplate,
  listTemplates,
  type CloudResult,
  type TemplateRow,
} from "@/lib/whatsapp-cloud";
import { validateTemplate, buildComponents, isEditableInApp, type TemplateDraft } from "@/lib/template-rules";
import { getMyBusiness } from "@/lib/queries";
import { officialSessionOf } from "@/lib/cloud-session";

// Server actions behind the App Review test panel. Gated to allowlisted users (showOfficialWhatsApp)
// and driven by the shared WHATSAPP_CLOUD_* test credentials. These exercise the two permissions
// under review: whatsapp_business_messaging (send) and whatsapp_business_management (templates).

async function guard(): Promise<CloudResult<never> | null> {
  if (!(await showOfficialWhatsApp())) return { ok: false, error: "No autorizado." };
  return null;
}

export async function testSendMessage(to: string, body: string): Promise<CloudResult> {
  const denied = await guard();
  if (denied) return denied;
  const { token, phoneNumberId } = cloudTestCreds();
  if (!token || !phoneNumberId) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_PHONE_NUMBER_ID)." };
  const num = to.replace(/[^\d]/g, "");
  if (!num) return { ok: false, error: "Número de destino inválido." };
  // Freeform text needs an open 24h window; fall back to the hello_world template if Meta rejects it.
  const text = body.trim();
  if (text) {
    const r = await sendText(phoneNumberId, token, num, text);
    if (r.ok) return r;
  }
  return sendTemplate(phoneNumberId, token, num);
}

export async function testCreateTemplate(name: string, category: string, body: string): Promise<CloudResult> {
  const denied = await guard();
  if (denied) return denied;
  const { token, wabaId } = cloudTestCreds();
  if (!token || !wabaId) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_WABA_ID)." };
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!clean) return { ok: false, error: "Nombre de plantilla inválido." };
  if (!body.trim()) return { ok: false, error: "El cuerpo de la plantilla no puede estar vacío." };
  return createTemplate(wabaId, token, { name: clean, category: category || "UTILITY", language: "es_MX", body: body.trim() });
}

// ---- Full template manager (list / create / edit / delete) --------------------------------------

/**
 * A qué cuenta de WhatsApp le habla el gestor de plantillas.
 *
 * El chat lee las plantillas de la cuenta del PROPIO negocio (getWaTemplates), así que el gestor
 * tiene que escribir en esa misma: si creara en otra, la plantilla saldría aprobada en Ajustes y
 * jamás aparecería al ir a mandarla. La cuenta de prueba queda solo como respaldo para quien está
 * en la lista de pruebas y todavía no conectó un número (el revisor de Meta, por ejemplo).
 */
async function templateCreds(): Promise<{ token: string; wabaId: string } | { error: string }> {
  const biz = await getMyBusiness();
  const session = biz ? await officialSessionOf(biz.id) : null;
  if (session) return { token: session.token, wabaId: session.wabaId };
  if (!(await showOfficialWhatsApp())) return { error: "Conecta tu número por la API oficial para usar plantillas." };
  const { token, wabaId } = cloudTestCreds();
  if (!token || !wabaId) return { error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_WABA_ID)." };
  return { token, wabaId };
}

export async function listTemplatesAction(): Promise<CloudResult<TemplateRow[]>> {
  const c = await templateCreds();
  if ("error" in c) return { ok: false, error: c.error };
  const r = await listTemplates(c.wabaId, c.token);
  return r.ok ? { ok: true, data: r.data.data } : r;
}

export async function createTemplateAction(draft: TemplateDraft): Promise<CloudResult> {
  const c = await templateCreds();
  if ("error" in c) return { ok: false, error: c.error };
  const errs = validateTemplate(draft).filter((i) => i.level === "error");
  if (errs.length) return { ok: false, error: errs.map((e) => e.msg).join(" ") };
  return createTemplateFull(c.wabaId, c.token, {
    name: draft.name.trim(),
    category: draft.category,
    language: draft.language,
    components: buildComponents(draft),
  });
}

export async function editTemplateAction(templateId: string, status: string, draft: TemplateDraft): Promise<CloudResult> {
  const c = await templateCreds();
  if ("error" in c) return { ok: false, error: c.error };
  // Approved templates must be edited on Meta's Business Manager, not here.
  if (!isEditableInApp(status)) return { ok: false, error: "Solo se editan plantillas rechazadas o pausadas. Las aprobadas se editan en Meta Business Manager." };
  const errs = validateTemplate(draft).filter((i) => i.level === "error");
  if (errs.length) return { ok: false, error: errs.map((e) => e.msg).join(" ") };
  return editTemplate(templateId, c.token, { category: draft.category, components: buildComponents(draft) });
}

export async function deleteTemplateAction(name: string): Promise<CloudResult> {
  const c = await templateCreds();
  if ("error" in c) return { ok: false, error: c.error };
  if (!name.trim()) return { ok: false, error: "Nombre inválido." };
  return deleteTemplate(c.wabaId, c.token, name.trim());
}
