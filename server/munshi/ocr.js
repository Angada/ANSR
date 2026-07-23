// Munshi OCR — vision-LLM fallback for scanned / image-only PDFs.
//
// Reverse-engineered from the DeepSeek-OCR / Unlimited-OCR pipeline
// (render → page-wise parse → stitch to layout markdown) but run on the Vault's
// vision LLMs (Claude / Gemini / GPT) through the gated `munshi-ocr` pipeline —
// no GPU, no self-hosting. Because it's a normal gated pipeline it can later be
// pointed at a self-hosted DeepSeek-OCR/vLLM endpoint with no code change.
//
// The "long-horizon / unlimited" trick is here too: we never send the whole PDF
// in one call — each page is rasterised, transcribed, and stitched back, so
// document length is bounded only by MAX_PAGES (a cost guard), not by any model
// context window.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../ai.js";

// DeepSeek-OCR renders at 300 DPI; 200 keeps PNG payloads small for commercial
// vision APIs (Claude auto-downscales to ~1568px anyway). All env-overridable.
const DPI = Number(process.env.MUNSHI_OCR_DPI || 200);
const MAX_PAGES = Number(process.env.MUNSHI_OCR_MAX_PAGES || 30);   // cost guard
const CONCURRENCY = Number(process.env.MUNSHI_OCR_CONCURRENCY || 3);

const OCR_PROMPT =
  "Transcribe this document page image to clean GitHub-Flavoured Markdown. " +
  "Preserve reading order, headings, lists and tables (use Markdown tables). " +
  "Transcribe ONLY what is visibly printed — never invent or complete text. " +
  "Output the transcription only, with no commentary. If the page is blank, output nothing.";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 200)}`))));
  });
}

// Is pdftoppm (poppler) available on this host? (dev machines may lack it.)
export async function ocrAvailable() {
  try { await run("pdftoppm", ["-h"]); return true; } catch { return false; }
}

// Rasterise a PDF to per-page PNGs at DPI. Returns absolute PNG paths, in order.
async function rasterize(pdfPath, dir, dpi) {
  await run("pdftoppm", ["-png", "-r", String(dpi), pdfPath, join(dir, "pg")]);
  return readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => join(dir, f));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// OCR a whole PDF via the gated munshi-ocr vision pipeline.
// Returns { text, pages, ocr, mode, error? }.
export async function ocrPdf(pdfPath, { provider, model } = {}) {
  if (!(await ocrAvailable())) {
    return { text: "", pages: 0, ocr: false, error: "poppler (pdftoppm) not installed on host" };
  }
  const dir = mkdtempSync(join(tmpdir(), "munshi-ocr-"));
  try {
    let pngs = await rasterize(pdfPath, dir, DPI);
    const total = pngs.length;
    const truncated = total > MAX_PAGES;
    pngs = pngs.slice(0, MAX_PAGES);

    let mode = "ai";
    const pageTexts = await mapLimit(pngs, CONCURRENCY, async (png) => {
      const data = readFileSync(png).toString("base64");
      const r = await runPipeline("munshi-ocr", {
        images: [{ media_type: "image/png", data }],
        user: OCR_PROMPT, maxTokens: 4000, provider, model,
      });
      if (r.mode !== "ai") mode = r.mode; // stub/disabled/error — surface it
      return r.mode === "ai" ? (r.text || "") : "";
    });

    let text = pageTexts.map((t, i) => `\n\n<!-- page ${i + 1} -->\n\n${t}`.trimEnd()).join("\n").trim();
    if (truncated) text += `\n\n<!-- OCR stopped at ${MAX_PAGES} of ${total} pages (MUNSHI_OCR_MAX_PAGES) -->`;
    return { text, pages: pngs.length, ocr: mode === "ai" && !!text, mode };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
