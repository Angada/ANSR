// Q&ANSR microsite server. Doc intake (hybrid knowledge store), the doc x api
// switch (serve the .md extract, never the original), the AI-pipeline registry,
// and config. The calc/normalize/assure/statement engines mount here as built.
import express from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, toMarkdown } from "./extract.js";
import { q } from "./db/client.js";
import { loadConfig, saveConfig, publicConfig, encryptKey } from "./store.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docstore = join(root, "docstore");
const uploads = join(root, "uploads");
for (const d of [docstore, uploads]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(join(root, "public")));
const upload = multer({ dest: uploads });

const slug = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

app.get("/health", (_req, res) => res.json({ ok: true, service: "qansr", ts: Date.now() }));

// ---- doc intake: original → extract → T2 markdown in /docstore + T3 doc row --
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "no file" });
    const customer = slug(req.body.customer || "ANSR-KENVUE");
    const docType = (req.body.docType || "other").toLowerCase();
    const buf = readFileSync(f.path);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const extract = await extractFile(f.path, f.originalname);

    const dir = join(docstore, customer);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const docId = `${docType}-${sha256.slice(0, 8)}`;
    const mdPath = join(dir, `${docId}.md`);
    writeFileSync(mdPath, toMarkdown({ docType, originalName: f.originalname, sha256, extract }));

    // T3 fact row (best-effort; JSON docstore is the durable path locally).
    await q(
      `insert into document(customer_id, doc_type, filename, sha256, storage_path, md_path, meta)
       values((select id from customer where code=$1), $2, $3, $4, $5, $6, $7)
       on conflict do nothing`,
      [customer, docType, f.originalname, sha256, f.path, mdPath, JSON.stringify({ kind: extract.kind, sheets: extract.sheets?.map((s) => s.name) })]
    ).catch(() => {});

    res.json({ ok: true, customer, docId, docType, kind: extract.kind, sheets: extract.sheets?.map((s) => s.name) || [], mdPath: `/api/doc/${customer}/${docId}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- the "doc x api switch": serve the MD extract, never the original --------
app.get("/api/doc/:customer/:docId", (req, res) => {
  const p = join(docstore, slug(req.params.customer), `${req.params.docId}.md`);
  if (!existsSync(p)) return res.status(404).send("Document extract not found.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(readFileSync(p, "utf8"));
});

app.get("/api/docs/:customer", (req, res) => {
  const dir = join(docstore, slug(req.params.customer));
  if (!existsSync(dir)) return res.json({ docs: [] });
  res.json({ docs: readdirSync(dir).filter((f) => extname(f) === ".md").map((f) => f.replace(/\.md$/, "")) });
});

// ---- AI-pipeline registry + config -----------------------------------------
app.get("/api/config", (_req, res) => res.json(publicConfig()));
app.get("/api/pipelines", (_req, res) => res.json({ pipelines: loadConfig().pipelines }));
app.post("/api/pipelines/:id", (req, res) => {
  const cfg = loadConfig();
  const p = cfg.pipelines[req.params.id];
  if (!p) return res.status(404).json({ error: "unknown pipeline" });
  const { provider, model, enabled } = req.body || {};
  cfg.pipelines[req.params.id] = { ...p, ...(provider !== undefined && { provider }), ...(model !== undefined && { model }), ...(enabled !== undefined && { enabled: !!enabled }) };
  saveConfig(cfg);
  res.json({ ok: true, pipeline: cfg.pipelines[req.params.id] });
});
app.post("/api/providers/:provider", (req, res) => {
  const cfg = loadConfig();
  if (!cfg.providers[req.params.provider]) return res.status(404).json({ error: "unknown provider" });
  if (req.body?.apiKey) cfg.providers[req.params.provider].apiKey = encryptKey(req.body.apiKey);
  saveConfig(cfg);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => console.log(`Q&ANSR on http://localhost:${PORT}`));
