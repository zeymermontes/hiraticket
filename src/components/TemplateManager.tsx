"use client";
import React, { useCallback, useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
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
  type TemplateDraft,
  type TemplateCategory,
} from "@/lib/template-rules";
import {
  listTemplatesAction,
  createTemplateAction,
  editTemplateAction,
  deleteTemplateAction,
} from "@/app/(app)/settings/cloud-actions";

const LANGS = ["es_MX", "es_ES", "en_US", "en_GB", "pt_BR"];
const CATS: TemplateCategory[] = ["UTILITY", "MARKETING"];

const emptyDraft: TemplateDraft = { name: "", category: "UTILITY", language: "es_MX", header: "", body: "", footer: "", examples: {} };

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
  const comps = row.components ?? [];
  const header = comps.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT")?.text ?? "";
  const body = comps.find((c) => c.type === "BODY")?.text ?? "";
  const footer = comps.find((c) => c.type === "FOOTER")?.text ?? "";
  return { name: row.name, category: (row.category as TemplateCategory) || "UTILITY", language: row.language, header, body, footer, examples: {} };
}

export function TemplateManager() {
  const { lang } = useApp();
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  const [pending, start] = useTransition();

  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editing, setEditing] = useState<{ id: string; status: string } | null>(null);
  const [list, setList] = useState<TemplateRow[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setEx = (key: string, v: string) => setDraft((d) => ({ ...d, examples: { ...d.examples, [key]: v } }));

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
      if (!confirm(t(`¿Eliminar la plantilla "${name}"? Se borran todos sus idiomas.`, `Delete template "${name}"? All its languages are removed.`))) return;
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>
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
          <div style={{ background: "#e5ddd5", borderRadius: 12, padding: 14, minHeight: 120 }}>
            <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px", boxShadow: "0 1px 1px rgba(0,0,0,.12)", maxWidth: 260 }}>
              {previewHeader && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#111" }}>{previewHeader}</div>}
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: "#111" }}>{preview || t("(cuerpo vacío)", "(empty body)")}</div>
              {draft.footer && <div style={{ fontSize: 12, color: "#667781", marginTop: 5 }}>{draft.footer}</div>}
            </div>
          </div>
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
          return (
            <div key={row.id} className="row gap-2" style={{ alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
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
          );
        })}
      </div>
    </div>
  );
}
