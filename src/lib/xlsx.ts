// Minimal .xlsx writer (browser-side, no dependencies). An xlsx file is a ZIP of XML parts;
// we emit the smallest valid set — [Content_Types], root rels, workbook (+rels) and one
// worksheet per sheet — with cells as inline strings or numbers, ZIP entries stored
// uncompressed. Enough for Excel/Numbers/Sheets to open it cleanly.

import { zip } from "@/lib/zip";

export type CellValue = string | number | null | undefined;

const xmlEsc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Column index (0-based) → "A", "B", … "AA" …
const colRef = (i: number): string => {
  let s = "";
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
};

// Excel sheet-name rules: ≤31 chars, none of []:*?/\
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Hoja";

function sheetXml(rows: CellValue[][]): string {
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  const body = rows.map((row, ri) => {
    const cells = row.map((v, ci) => {
      if (v == null || v === "") return "";
      const ref = `${colRef(ci)}${ri + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cols><col min="1" max="${nCols}" width="18" customWidth="1"/></cols>` +
    `<sheetData>${body}</sheetData></worksheet>`;
}

/** Build an .xlsx Blob from named sheets of rows. */
export function xlsxBlob(sheets: { name: string; rows: CellValue[][] }[]): Blob {
  const enc = new TextEncoder();
  const names = sheets.map((s, i) => {
    let n = sheetName(s.name);
    // Dedupe (Excel rejects duplicate sheet names).
    if (sheets.slice(0, i).some((p) => sheetName(p.name) === n)) n = `${n.slice(0, 28)} ${i + 1}`;
    return n;
  });

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    `</workbook>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) })),
  ], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/** Trigger a browser download of the given sheets as an .xlsx file. */
export function downloadXlsx(filename: string, sheets: { name: string; rows: CellValue[][] }[]) {
  const url = URL.createObjectURL(xlsxBlob(sheets));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
