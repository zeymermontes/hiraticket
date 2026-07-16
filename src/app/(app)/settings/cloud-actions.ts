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

export async function listTemplatesAction(): Promise<CloudResult<TemplateRow[]>> {
  const denied = await guard();
  if (denied) return denied;
  const { token, wabaId } = cloudTestCreds();
  if (!token || !wabaId) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_WABA_ID)." };
  const r = await listTemplates(wabaId, token);
  return r.ok ? { ok: true, data: r.data.data } : r;
}

export async function createTemplateAction(draft: TemplateDraft): Promise<CloudResult> {
  const denied = await guard();
  if (denied) return denied;
  const { token, wabaId } = cloudTestCreds();
  if (!token || !wabaId) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_WABA_ID)." };
  const errs = validateTemplate(draft).filter((i) => i.level === "error");
  if (errs.length) return { ok: false, error: errs.map((e) => e.msg).join(" ") };
  return createTemplateFull(wabaId, token, {
    name: draft.name.trim(),
    category: draft.category,
    language: draft.language,
    components: buildComponents(draft),
  });
}

export async function editTemplateAction(templateId: string, status: string, draft: TemplateDraft): Promise<CloudResult> {
  const denied = await guard();
  if (denied) return denied;
  const { token } = cloudTestCreds();
  if (!token) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN)." };
  // Approved templates must be edited on Meta's Business Manager, not here.
  if (!isEditableInApp(status)) return { ok: false, error: "Solo se editan plantillas rechazadas o pausadas. Las aprobadas se editan en Meta Business Manager." };
  const errs = validateTemplate(draft).filter((i) => i.level === "error");
  if (errs.length) return { ok: false, error: errs.map((e) => e.msg).join(" ") };
  return editTemplate(templateId, token, { category: draft.category, components: buildComponents(draft) });
}

export async function deleteTemplateAction(name: string): Promise<CloudResult> {
  const denied = await guard();
  if (denied) return denied;
  const { token, wabaId } = cloudTestCreds();
  if (!token || !wabaId) return { ok: false, error: "Faltan credenciales (WHATSAPP_CLOUD_TOKEN / WHATSAPP_TEST_WABA_ID)." };
  if (!name.trim()) return { ok: false, error: "Nombre inválido." };
  return deleteTemplate(wabaId, token, name.trim());
}
