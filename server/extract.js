// Pull text/data out of an uploaded file so the model can work with it.
// Office docs + PDF go through officeparser; spreadsheets also get a structured
// pass via SheetJS so tables (EMP LIST, Rules, calc sheets) survive intact.
import { extname } from "node:path";
import { readFileSync } from "node:fs";
import { parseOfficeAsync } from "officeparser";
import * as XLSX from "xlsx";

const SHEET_EXT = new Set([".xlsx", ".xls", ".xlsm", ".csv", ".ods"]);
const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".json", ".text"]);

// Returns { kind, text, sheets? } describing the file's content.
export async function extractFile(path, originalName) {
  const ext = extname(originalName || path).toLowerCase();

  if (SHEET_EXT.has(ext)) {
    // xlsx's ESM build doesn't bind readFile to fs — read the buffer ourselves.
    const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      csv: XLSX.utils.sheet_to_csv(wb.Sheets[name]),
      json: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null }),
    }));
    const text = sheets.map((s) => `# Sheet: ${s.name}\n${s.csv}`).join("\n\n");
    return { kind: "spreadsheet", text, sheets };
  }

  if (TEXT_EXT.has(ext)) {
    return { kind: "document", text: readFileSync(path, "utf8") };
  }

  // .pdf .docx .pptx .odt etc.
  const text = await parseOfficeAsync(path);
  return { kind: "document", text: String(text || "") };
}

// Render an extract as a markdown document for the T2 docstore (the readable
// failsafe pointer to the original — the hybrid knowledge store's middle tier).
export function toMarkdown({ docType, originalName, sha256, extract }) {
  const fm = [
    "---",
    `doc: ${docType}`,
    `source_file: "${originalName}"`,
    `sha256: ${sha256 || ""}`,
    "authority: original document (this MD is an extract — on any dispute, go to the file)",
    `extracted: ${new Date().toISOString()}`,
    "---",
    "",
  ].join("\n");
  if (extract.kind === "spreadsheet") {
    const body = extract.sheets
      .map((s) => `## Sheet: ${s.name}\n\n\`\`\`csv\n${s.csv}\n\`\`\``)
      .join("\n\n");
    return fm + body;
  }
  return fm + extract.text;
}
