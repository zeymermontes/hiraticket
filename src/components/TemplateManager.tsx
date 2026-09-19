"use client";
import React, { useCallback, useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import { useConfirm } from "@/components/Confirm";
import { Pill } from "@/components/ui";
import { useApp } from "@/components/AppContext";
import type { PillColor } from "@/lib/types";
import type { TemplateRow } from "@/lib/whatsapp-cloud";
import {
  validateTemplate,
  renderPreview,
  uniqueVars,
  extractVars,
  isEditableInApp,
  templateParts,
  type TemplateDraft,
  type TemplateCategory,
  type TemplateButton,
  type TemplateButtonType,
} from "@/lib/template-rules";
import { WaTemplatePreview } from "@/components/WaTemplatePreview";
import {
  listTemplatesAction,
  createTemplateAction,
  editTemplateAction,
  deleteTemplateAction,
} from "@/app/(app)/settings/cloud-actions";

const LANGS = ["es_MX", "es_ES", "en_US", "en_GB", "pt_BR"];
const CATS: TemplateCategory[] = ["UTILITY", "MARKETING"];

const BUTTON_TYPES: TemplateButtonType[] = ["QUICK_REPLY", "URL", "PHONE_NUMBER"];

const emptyDraft: TemplateDraft = { name: "", category: "UTILITY", language: "es_MX", header: "", body: "", footer: "", examples: {}, buttons: [] };

function statusColor(status: string): PillColor {
  switch (status.toUpperCase()) {
    case "APPROVED": return "green";
    case "PENDING": case "IN_APPEAL": return "blue";
    case "PAUSED": case "FLAGGED": return "amber";
    case "REJECTED": return "red";
    default: return "slate";
  }
}

// Best-effort: turn a template's components back into an editable draft (examples aren't returned, so the user refills them).
function rowToDraft(row: TemplateRow): TemplateDraft {
  const { header, body, footer, buttons } = templateParts(row.components);
  return { name: row.name, category: (row.category as TemplateCategory) || "UTILITY", language: row.language, header, body, footer, examples: {}, buttons };
}

export function TemplateManager() {
  const { lang } = useApp();
  const ask = useConfirm(); // diálogo propio, no el confirm() del navegador
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const [pending, start] = useTransition();

  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editing, setEditing] = useState<{ id: string; status: string } | null>(null);
  const [list, setList] = useState<TemplateRow[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null); // plantilla de la lista con la vista previa abierta

  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setEx = (key: string, v: string) => setDraft((d) => ({ ...d, examples: { ...d.examples, [key]: v } }));

  const buttons = draft.buttons ?? [];
  const setButton = (i: number, patch: Partial<TemplateButton>) =>
    set("buttons", buttons.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const buttonTypeLabel = (ty: TemplateButtonType) =>
    ty === "QUICK_REPLY" ? t("Respuesta rápida", "Quick reply") : ty === "URL" ? t("Abrir enlace", "Open link") : t("Llamar", "Call");

  const issues = validateTemplate(draft, lang);
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  const bodyVars = uniqueVars(draft.body);
  const headerHasVar = extractVars(draft.header).length === 1;

  const refresh = useCallback(() => {
    start(async () => {
      const r = await listTemplatesAction();
      if (r.ok) setList(r.data);
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const insertVar = () => {
    const next = bodyVars.length ? Math.max(...bodyVars) + 1 : 1;
    set("body", draft.body + (draft.body && !draft.body.endsWith(" ") ? " " : "") + `{{${next}}}`);
  };

  const resetForm = () => { setDraft(emptyDraft); setEditing(null); setNote(null); };

  const submit = () =>
    start(async () => {
      setNote(null);
      const r = editing
        ? await editTemplateAction(editing.id, editing.status, draft)
        : await createTemplateAction(draft);
      if (r.ok) {
        setNote({ ok: true, text: editing ? t("Plantilla actualizada ✓", "Template updated ✓") : t("Plantilla enviada a revisión ✓", "Template submitted for review ✓") });
        resetForm();
        refresh();
      } else {
        setNote({ ok: false, text: r.error });
      }
    });

  const startEdit = (row: TemplateRow) => {
    setEditing({ id: row.id, status: row.status });
    setDraft(rowToDraft(row));
    setNote(null);
  };

  const remove = (name: string) =>
    start(async () => {
      if (!(await ask({ icon: "trash", danger: true, title: t("Eliminar plantilla", "Delete template"), message: t(`"${name}" — se borran todos sus idiomas.`, `"${name}" — all its languages are removed.`), confirmLabel: t("Eliminar", "Delete"), cancelLabel: t("Volver", "Back") }))) return;
      const r = await deleteTemplateAction(name);
      setNote(r.ok ? { ok: true, text: t("Plantilla eliminada ✓", "Template deleted ✓") } : { ok: false, text: r.error });
      refresh();
    });

  const preview = renderPreview(draft.body, draft.examples);
  const previewHeader = draft.header ? renderPreview(draft.header, draft.examples, true) : "";

  return (
    <div className="col gap-3">
      {editing && (
        <div className="row gap-2">
          <Pill color="amber">{t("Editando plantilla", "Editing template")}</Pill>
          <span className="mono t-sm muted">{draft.name}</span>
        </div>
      )}

      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
        {/* ---- Builder ---- */}
        <div className="col gap-2" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
          <div className="row gap-2">
            <input className="inp-inline grow" placeholder={t("Nombre (a-z, 0-9, _)", "Name (a-z, 0-9, _)")}
              value={draft.name} disabled={!!editing}
              onChange={(e) => set("name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
            <select className="inp-inline" value={draft.category} onChange={(e) => set("category", e.target.value as TemplateCategory)}>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="inp-inline" value={draft.language} disabled={!!editing} onChange={(e) => set("language", e.target.value)}>
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <input className="inp-inline" placeholder={t("Encabezado (opcional, máx. 60)", "Header (optional, max 60)")}
            value={draft.header} onChange={(e) => set("header", e.target.value)} />

          <textarea className="inp-inline" rows={4} placeholder={t("Cuerpo del mensaje", "Message body")}
            value={draft.body} onChange={(e) => set("body", e.target.value)} />
          <div className="row gap-2">
            <button className="btn btn-xs btn-outline" style={{ width: "fit-content" }} onClick={insertVar}>
              <Icon name="plus" size={12} />{t("Variable", "Variable")}
            </button>
            <span className="t-xs muted">{draft.body.length}/1024</span>
          </div>

          <input className="inp-inline" placeholder={t("Pie de página (opcional, máx. 60, sin variables)", "Footer (optional, max 60, no variables)")}
            value={draft.footer} onChange={(e) => set("footer", e.target.value)} />

          {/* Buttons */}
          <div className="col gap-1" style={{ marginTop: 4 }}>
            <span className="t-xs muted">{t("Botones (opcional)", "Buttons (optional)")}</span>
            {buttons.map((b, i) => (
              <div key={i} className="row gap-2" style={{ flexWrap: "wrap" }}>
                <select className="inp-inline" value={b.type} onChange={(e) => setButton(i, { type: e.target.value as TemplateButtonType })}>
                  {BUTTON_TYPES.map((ty) => <option key={ty} value={ty}>{buttonTypeLabel(ty)}</option>)}
                </select>
                <input className="inp-inline grow" style={{ minWidth: 120 }} maxLength={25} placeholder={t("Texto del botón (máx. 25)", "Button text (max 25)")}
                  value={b.text} onChange={(e) => setButton(i, { text: e.target.value })} />
                {b.type === "URL" && (
                  <input className="inp-inline grow" style={{ minWidth: 160 }} placeholder="https://…"
                    value={b.url ?? ""} onChange={(e) => setButton(i, { url: e.target.value })} />
                )}
                {b.type === "PHONE_NUMBER" && (
                  <input className="inp-inline grow" style={{ minWidth: 160 }} inputMode="tel" placeholder={t("+52 55 1234 5678", "+1 555 123 4567")}
                    value={b.phone ?? ""} onChange={(e) => setButton(i, { phone: e.target.value })} />
                )}
                <button className="iconbtn sm" title={t("Quitar botón", "Remove button")} onClick={() => set("buttons", buttons.filter((_, k) => k !== i))}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            {buttons.length < 10 && (
              <button className="btn btn-xs btn-outline" style={{ width: "fit-content" }}
                onClick={() => set("buttons", [...buttons, { type: "QUICK_REPLY", text: "" }])}>
                <Icon name="plus" size={12} />{t("Botón", "Button")}
              </button>
            )}
            {buttons.some((b) => b.type === "QUICK_REPLY") && (
              <span className="t-xs muted">
                {t("Cuando el cliente toca una respuesta rápida, te llega como un mensaje suyo, y eso reabre el chat libre por 24 h.",
                   "When the customer taps a quick reply it arrives as a message from them — which reopens free chat for 24h.")}
              </span>
            )}
          </div>

          {/* Variable examples */}
          {(headerHasVar || bodyVars.length > 0) && (
            <div className="col gap-1" style={{ marginTop: 4 }}>
              <span className="t-xs muted">{t("Ejemplos de variables (para la revisión de Meta)", "Variable examples (for Meta's review)")}</span>
              {headerHasVar && (
                <input className="inp-inline" placeholder={t("Ejemplo encabezado {{1}}", "Header example {{1}}")}
                  value={draft.examples.header ?? ""} onChange={(e) => setEx("header", e.target.value)} />
              )}
              {bodyVars.map((n) => (
                <input key={n} className="inp-inline" placeholder={t(`Ejemplo {{${n}}}`, `Example {{${n}}}`)}
                  value={draft.examples[String(n)] ?? ""} onChange={(e) => setEx(String(n), e.target.value)} />
              ))}
            </div>
          )}

          {/* Live validation */}
          {(errors.length > 0 || warns.length > 0) && (
            <div className="col gap-1" style={{ marginTop: 4 }}>
              {errors.map((i, k) => <div key={`e${k}`} className="t-xs" style={{ color: "var(--red, #dc2626)" }}>⛔ {i.msg}</div>)}
              {warns.map((i, k) => <div key={`w${k}`} className="t-xs" style={{ color: "var(--amber, #d97706)" }}>⚠️ {i.msg}</div>)}
            </div>
          )}

          <div className="row gap-2" style={{ marginTop: 6 }}>
            <button className="btn btn-sm btn-primary" disabled={pending || errors.length > 0} onClick={submit}>
              <Icon name={editing ? "check" : "plus"} size={14} />
              {editing ? t("Guardar cambios", "Save changes") : t("Crear plantilla", "Create template")}
            </button>
            {editing && (
              <button className="btn btn-sm btn-outline" disabled={pending} onClick={resetForm}>
                {t("Cancelar", "Cancel")}
              </button>
            )}
          </div>
          {note && <div className="t-xs" style={{ color: note.ok ? "var(--green, #16a34a)" : "var(--red, #dc2626)", wordBreak: "break-word" }}>{note.text}</div>}
        </div>

        {/* ---- Live WhatsApp-style preview ---- */}
        <div className="col gap-2">
          <span className="t-xs muted">{t("Vista previa", "Preview")}</span>
          <WaTemplatePreview header={previewHeader} body={preview} footer={draft.footer} buttons={buttons}
            emptyLabel={t("(cuerpo vacío)", "(empty body)")} />
        </div>
      </div>

      {/* ---- Template list ---- */}
      <div className="col gap-2" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: 14 }}>
        <div className="row gap-2">
          <strong className="grow">{t("Plantillas del número", "Number's templates")}</strong>
          <button className="btn btn-xs btn-outline" disabled={pending} onClick={refresh}><Icon name="refresh" size={12} />{t("Actualizar", "Refresh")}</button>
        </div>
        {list.length === 0 && <div className="t-sm muted">{pending ? t("Cargando…", "Loading…") : t("Sin plantillas todavía.", "No templates yet.")}</div>}
        {list.map((row) => {
          const editable = isEditableInApp(row.status);
          const open = openRow === row.id;
          const parts = open ? templateParts(row.components) : null;
          return (
            <div key={row.id} className="col gap-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row gap-2">
                  <strong className="mono t-sm">{row.name}</strong>
                  <Pill color={statusColor(row.status)} dot>{row.status}</Pill>
                  <span className="t-xs muted">{row.category} · {row.language}</span>
                </div>
                {row.status.toUpperCase() === "REJECTED" && row.rejected_reason && (
                  <div className="t-xs" style={{ color: "var(--red, #dc2626)" }}>{t("Motivo:", "Reason:")} {row.rejected_reason}</div>
                )}
              </div>
              <button className="iconbtn sm" aria-expanded={open} title={t("Vista previa", "Preview")} onClick={() => setOpenRow(open ? null : row.id)}>
                <Icon name="eye" size={14} />
              </button>
              {editable ? (
                <button className="btn btn-xs btn-outline" disabled={pending} onClick={() => startEdit(row)}><Icon name="edit" size={12} />{t("Editar", "Edit")}</button>
              ) : (
                <a className="btn btn-xs btn-ghost" href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener"
                  title={t("Las aprobadas se editan en Meta Business Manager", "Approved templates are edited in Meta Business Manager")}>
                  <Icon name="arrowr" size={12} />{t("Meta Manager", "Meta Manager")}
                </a>
              )}
              <button className="iconbtn sm" disabled={pending} title={t("Eliminar", "Delete")} onClick={() => remove(row.name)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            {parts && (
              <div className="col gap-1">
                <WaTemplatePreview header={parts.header} mediaHeader={parts.mediaHeader} body={parts.body} footer={parts.footer} buttons={parts.buttons} />
                {parts.unsupportedButtons > 0 && (
                  <span className="t-xs muted">
                    {t(`Tiene ${parts.unsupportedButtons} botón(es) de un tipo que Hiraticket aún no maneja (enlace con variable, código, flujo).`,
                       `Has ${parts.unsupportedButtons} button(s) of a kind Hiraticket doesn't handle yet (link with a variable, code, flow).`)}
                  </span>
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
