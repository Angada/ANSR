// Pull text/data out of an uploaded file so the model can work with it.
// Office docs + PDF go through officeparser; spreadsheets also get a structured
// pass via SheetJS so tables (EMP LIST, Rules, calc sheets) survive intact.
import { extname } from "node:path";
import { readFileSync, copyFileSync, rmSync } from "node:fs";
import { parseOfficeAsync } from "officeparser";
import * as XLSX from "xlsx";
import { useOcr } from "./munshi/flag.js";
import { ocrPdf, backfillScanned, ocrAvailable } from "./munshi/ocr.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

// Per-page text from a PDF via poppler (already required for OCR rasterising).
// Whole-document extraction cannot tell a 40-page contract whose schedules are
// scans from one that is fully readable — both return "some text". Per page, the
// difference is obvious, and we can OCR just the sparse pages.
async function pdfPages(pdfPath) {
  try {
    const { stdout } = await execFileP("pdfinfo", [pdfPath], { timeout: 20000 });
    const total = Number((stdout.match(/^Pages:\s+(\d+)/m) || [])[1] || 0);
    if (!total) return null;
    const pages = [];
    for (let n = 1; n <= total; n++) {
      let text = "";
      try {
        const r = await execFileP("pdftotext", ["-f", String(n), "-l", String(n), pdfPath, "-"], { timeout: 20000, maxBuffer: 12e6 });
        text = String(r.stdout || "");
      } catch { /* a page that won't extract is exactly what OCR is for */ }
      pages.push({ page_no: n, text });
    }
    return pages;
  } catch { return null; }   // poppler missing → caller falls back to whole-doc
}

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

  // .pdf .docx .pptx .odt etc. — officeparser detects type by file EXTENSION,
  // but multer's temp file has none, so copy it to a path with the real ext.
  const withExt = ext && !path.toLowerCase().endsWith(ext) ? path + ext : path;
  let made = false;
  if (withExt !== path) { copyFileSync(path, withExt); made = true; }
  try {
    const text = String((await parseOfficeAsync(withExt)) || "");
    if (ext === ".pdf" && useOcr()) {
      // PER PAGE, not per document. The old gate only fired when the WHOLE file
      // was near-empty, so a contract with a born-digital body and SCANNED
      // schedules or signature pages passed on the strength of its text pages —
      // and those scans never reached the transcript, silently. Contracts put
      // annexures and executed signatures in exactly those pages.
      const pages = await pdfPages(withExt);
      if (pages && pages.length) {
        const sparse = pages.filter((p) => p.text.replace(/\s/g, "").length < 40);
        if (sparse.length && await ocrAvailable()) {
          const r = await backfillScanned(withExt, pages, { minChars: 40 });
          const merged = pages.map((p) => p.text).join("\n\n").trim();
          if (merged) return { kind: "document", text: merged, ocr: (r.backfilled || []).length > 0,
            pages: pages.length, ocr_pages: r.backfilled || [],
            // an honest gap: sparse pages OCR could not recover
            unread_pages: sparse.map((p) => p.page_no).filter((n) => !(r.backfilled || []).includes(n)) };
        }
        const merged = pages.map((p) => p.text).join("\n\n").trim();
        if (merged.length >= text.replace(/\s/g, "").length) return { kind: "document", text: merged, pages: pages.length };
      }
      // poppler unavailable → the original whole-document fallback
      if (text.replace(/\s/g, "").length < 60) {
        const r = await ocrPdf(withExt);
        if (r.ocr && r.text) return { kind: "document", text: r.text, ocr: true, pages: r.pages };
      }
    }
    return { kind: "document", text };
  } finally {
    if (made) { try { rmSync(withExt); } catch { /* ignore */ } }
  }
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
