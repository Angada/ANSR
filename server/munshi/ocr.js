// Munshi OCR — scanned/image-only PDF reader. Ported to the munshi3 method:
// rasterise each page (poppler, downscaled) → transcribe via the gated VISION
// skill (munshi3:read, provider/model swappable in the Vault) → stitch. Because
// it routes through runVisionSkill it uses whatever vision key exists (glm-4.5v
// on Z.AI, gemini, gpt-4o, claude) — no GPU, no Anthropic-only assumption.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVisionSkill, pickVisionProvider } from "../vision.js";

const DPI = Number(process.env.MUNSHI_OCR_DPI || 170);          // munshi3 default
const SCALE_TO = Number(process.env.MUNSHI_OCR_SCALE || 1700);  // cap longest edge (no sharp needed)
const MAX_PAGES = Number(process.env.MUNSHI_OCR_MAX_PAGES || 120);
const CONCURRENCY = Number(process.env.MUNSHI_OCR_CONCURRENCY || 6);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 200)}`))));
  });
}

// OCR possible here? poppler installed AND a keyed vision provider.
export async function ocrAvailable() {
  if (!pickVisionProvider()) return false;
  try { await run("pdftoppm", ["-h"]); return true; } catch { return false; }
}

// Rasterise a PDF to per-page PNGs (downscaled to SCALE_TO px longest edge).
async function rasterize(pdfPath, dir, { firstPage, lastPage } = {}) {
  const args = ["-png", "-r", String(DPI), "-scale-to", String(SCALE_TO)];
  if (firstPage) args.push("-f", String(firstPage));
  if (lastPage) args.push("-l", String(lastPage));
  args.push(pdfPath, join(dir, "pg"));
  await run("pdftoppm", args);
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

async function ocrOnePng(pngPath) {
  const data = readFileSync(pngPath).toString("base64");
  return runVisionSkill("munshi3:read", [{ media_type: "image/png", data }]);
}

// OCR a whole PDF via the gated vision skill. Returns { text, pages, ocr, mode }.
export async function ocrPdf(pdfPath, _opts = {}) {
  if (!(await ocrAvailable())) {
    return { text: "", pages: 0, ocr: false, mode: "unavailable", error: "no vision key or poppler" };
  }
  const dir = mkdtempSync(join(tmpdir(), "munshi-ocr-"));
  try {
    let pngs = await rasterize(pdfPath, dir, { lastPage: MAX_PAGES });
    const total = pngs.length;
    const truncated = total > MAX_PAGES;
    pngs = pngs.slice(0, MAX_PAGES);
    let mode = "ai";
    const pageTexts = await mapLimit(pngs, CONCURRENCY, async (png) => {
      const r = await ocrOnePng(png);
      if (r.mode !== "ai") mode = r.mode;
      return r.mode === "ai" ? (r.text || "") : "";
    });
    let text = pageTexts.map((t, i) => `<!-- page ${i + 1} -->\n\n${t}`.trimEnd()).join("\n\n---\n\n").trim();
    if (truncated) text += `\n\n<!-- OCR stopped at ${MAX_PAGES} of ${total} pages (MUNSHI_OCR_MAX_PAGES) -->`;
    return { text, pages: pngs.length, ocr: mode === "ai" && !!text, mode };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// OCR a single IMAGE file (a photographed/scanned contract page uploaded as
// png/jpg/webp). Same gated vision skill as PDF pages.
const IMG_MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export async function ocrImage(imgPath, ext) {
  const media = IMG_MEDIA[String(ext || "").toLowerCase()];
  if (!media) return { text: "", ocr: false, mode: "unsupported" };
  if (!pickVisionProvider()) return { text: "", ocr: false, mode: "unavailable", error: "no vision key" };
  const data = readFileSync(imgPath).toString("base64");
  const r = await runVisionSkill("munshi3:read", [{ media_type: media, data }]);
  return { text: r.mode === "ai" ? (r.text || "") : "", ocr: r.mode === "ai", mode: r.mode };
}

// Figure backfill: pages that HAVE some text but whose substance is an image
// (a heading above a scanned annexure). OCR the page and APPEND what the image
// says below the existing text — never replace what the text layer gave us.
export async function backfillFigures(pdfPath, pages, figureNos, { maxPages = 60 } = {}) {
  const targets = (pages || []).filter((p) => (figureNos || []).includes(p.page_no)).slice(0, maxPages);
  if (!targets.length) return { recovered: [] };
  if (!(await ocrAvailable())) return { recovered: [], reason: "no vision key or poppler" };
  const recovered = [];
  await mapLimit(targets, CONCURRENCY, async (p) => {
    const dir = mkdtempSync(join(tmpdir(), "munshi-fig-"));
    try {
      const imgs = await rasterize(pdfPath, dir, { firstPage: p.page_no, lastPage: p.page_no });
      if (imgs.length) {
        const r = await ocrOnePng(imgs[0]);
        // only append when the image genuinely held more than the text layer did
        if (r.mode === "ai" && r.text && r.text.trim().length > (p.text?.trim().length ?? 0) + 80) {
          p.text = `${(p.text || "").trim()}\n\n<!-- OCR of the page image -->\n${r.text.trim()}`;
          recovered.push(p.page_no);
        }
      }
    } catch { /* per-page best-effort */ }
    finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  });
  recovered.sort((a, b) => a - b);
  return { recovered };
}

// Scanned-only backfill: OCR just the pages whose text layer is sparse, mutating
// each page's text in place. Text-native PDFs → no-op, zero cost.
export async function backfillScanned(pdfPath, pages, { minChars = 20 } = {}) {
  const sparse = (pages || []).filter((p) => (p.text?.trim().length ?? 0) < minChars);
  if (!sparse.length) return { scanned: 0, backfilled: [] };
  if (!(await ocrAvailable())) return { scanned: sparse.length, backfilled: [], reason: "no vision key or poppler" };
  // Pages run CONCURRENTLY. Sequentially, a 38-page scan needed ~10 minutes and
  // died against the request timeout with two thirds of the document unread.
  const backfilled = [];
  await mapLimit(sparse, CONCURRENCY, async (p) => {
    const dir = mkdtempSync(join(tmpdir(), "munshi-bf-"));
    try {
      const imgs = await rasterize(pdfPath, dir, { firstPage: p.page_no, lastPage: p.page_no });
      if (imgs.length) {
        const r = await ocrOnePng(imgs[0]);
        if (r.mode === "ai" && r.text && r.text.trim().length > minChars) { p.text = r.text; backfilled.push(p.page_no); }
      }
    } catch { /* per-page best-effort */ }
    finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  });
  backfilled.sort((a, b) => a - b);
  return { scanned: sparse.length, backfilled };
}
