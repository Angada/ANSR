// Q&ANSR microsite server. Doc intake (hybrid knowledge store), the doc x api
// switch (serve the .md extract, never the original), the AI-pipeline registry,
// and config. The calc/normalize/assure/statement engines mount here as built.
import express from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, toMarkdown } from "./extract.js";
import { q } from "./db/client.js";
import { loadConfig, saveConfig, publicConfig, encryptKey, getApiKey, initConfig } from "./store.js";
import { putOriginal, putExtract, getExtract, listExtracts, usingBucket } from "./storage.js";
import { stubRun, stubOps, stubContracts, stubContract, stubRuns, stubAnalysis } from "./stub.js";
import Anthropic from "@anthropic-ai/sdk";
import { inferMapping, detectIssues, summarizeIssues, CANONICAL } from "./roster.js";
import { runPipeline, aiMap } from "./ai.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploads = join(root, "uploads"); // multer temp only — persistent artifacts go to storage.js
if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });

const app = express();
app.use(express.json({ limit: "4mb" }));

// ---- soft login (prototype gate — not hardened security) --------------------
const AUTH_USER = process.env.QANSR_USER || "vik";
const AUTH_PW = process.env.QANSR_PW || "thedik";
const AUTH_TOKEN = createHash("sha256").update(`${AUTH_USER}:${AUTH_PW}:qansr-soft`).digest("hex");
const OPEN = ["/login.html", "/login.js", "/app.css", "/favicon.png", "/apple-touch-icon.png", "/api/login", "/health"];
const cookieToken = (req) => (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("qansr_auth="))?.slice(11);

app.post("/api/login", (req, res) => {
  const { user, pw } = req.body || {};
  if (user === AUTH_USER && pw === AUTH_PW) {
    res.setHeader("Set-Cookie", `qansr_auth=${AUTH_TOKEN}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "wrong login or password" });
});
app.get("/api/me", (req, res) => {
  if (cookieToken(req) !== AUTH_TOKEN) return res.status(401).json({ error: "auth required" });
  res.json({ user: AUTH_USER, role: "Admin" });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "qansr_auth=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (OPEN.some((p) => req.path === p) || req.path.startsWith("/brand/")) return next();
  if (cookieToken(req) === AUTH_TOKEN) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth required" });
  return res.redirect("/login.html");
});

app.use(express.static(join(root, "public")));
app.use("/brand", express.static(join(root, "brand"))); // tokens.css + logo for the UI
const MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB
const upload = multer({ dest: uploads, limits: { fileSize: MAX_UPLOAD } });

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

    const docId = `${docType}-${sha256.slice(0, 8)}`;
    // T1 original + T2 md → persistent store (Supabase bucket in prod, disk in dev).
    const storagePath = await putOriginal(customer, sha256, extname(f.originalname), buf);
    const mdPath = await putExtract(customer, docId, toMarkdown({ docType, originalName: f.originalname, sha256, extract }));

    // T3 fact row (best-effort; the bucket/docstore is the durable artifact path).
    await q(
      `insert into document(customer_id, doc_type, filename, sha256, storage_path, md_path, meta)
       values((select id from customer where code=$1), $2, $3, $4, $5, $6, $7)
       on conflict do nothing`,
      [customer, docType, f.originalname, sha256, storagePath, mdPath, JSON.stringify({ kind: extract.kind, sheets: extract.sheets?.map((s) => s.name) })]
    ).catch(() => {});

    res.json({ ok: true, customer, docId, docType, kind: extract.kind, sheets: extract.sheets?.map((s) => s.name) || [], mdPath: `/api/doc/${customer}/${docId}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- the "doc x api switch": serve the MD extract, never the original --------
app.get("/api/doc/:customer/:docId", async (req, res) => {
  const md = await getExtract(slug(req.params.customer), req.params.docId);
  if (md == null) return res.status(404).send("Document extract not found.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(md);
});

app.get("/api/docs/:customer", async (req, res) => {
  res.json({ docs: await listExtracts(slug(req.params.customer)) });
});

// ---- shell data (stub until Phase A + calc engine land) --------------------
app.get("/api/ops", (_req, res) => res.json({ ops: stubOps() }));
app.get("/api/contracts", (_req, res) => res.json({ contracts: stubContracts() }));
app.get("/api/contract/:id", (req, res) => res.json(stubContract(slug(req.params.id))));
app.get("/api/runs/:customer", (req, res) => res.json({ runs: stubRuns(slug(req.params.customer)) }));
app.get("/api/run/:customer/:runNo", (req, res) => {
  res.json(stubRun(slug(req.params.customer), Number(req.params.runNo) || 1));
});

// ---- Mint contract analysis (run system: recall / new / purge) -------------
app.get("/api/clients", (_req, res) => res.json({ clients: stubContracts() }));
app.get("/api/mint/runs/:client", (req, res) => res.json({ runs: stubRuns(slug(req.params.client)) }));
app.get("/api/mint/run/:client/:no", (req, res) => res.json(stubAnalysis(slug(req.params.client), Number(req.params.no) || 3)));
app.post("/api/mint/run", (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const runs = stubRuns(client);
  res.json(stubAnalysis(client, (runs[runs.length - 1]?.run_no || 0) + 1));
});
app.post("/api/mint/purge", (_req, res) => res.json({ ok: true, purged: true }));

// ---- working-sheet (roster) ingestion: upload → map → issues → confirm ------
app.post("/api/mint/roster/map", upload.single("file"), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "no file" });
    const client = slug(req.body.client || "ANSR-KENVUE");
    const buf = readFileSync(f.path);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const extract = await extractFile(f.path, f.originalname);
    const sheet = (extract.sheets || [])[0];
    const rows = sheet?.json || [];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const mapping = inferMapping(headers);
    const issues = detectIssues(rows, mapping);
    // store the original's md extract — the doc×api switch (filename → API)
    const docId = `roster-${sha256.slice(0, 8)}`;
    const storagePath = await putOriginal(client, sha256, extname(f.originalname), buf);
    const mdPath = await putExtract(client, docId, toMarkdown({ docType: "roster", originalName: f.originalname, sha256, extract }));
    await q(`insert into document(customer_id,doc_type,filename,sha256,storage_path,md_path,meta)
             values((select id from customer where code=$1),'roster',$2,$3,$4,$5,$6) on conflict do nothing`,
      [client, f.originalname, sha256, storagePath, mdPath, JSON.stringify({ sheet: sheet?.name, rows: rows.length })]).catch(() => {});
    res.json({ filename: f.originalname, docId, apiUrl: `/api/doc/${client}/${docId}`,
      sheet: sheet?.name, headers, canonical: CANONICAL, mapping, rowCount: rows.length,
      rows: rows.slice(0, 25), issues, summary: summarizeIssues(issues) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/mint/roster/confirm", (req, res) => {
  const { client, docId, rowCount, mapping } = req.body || {};
  // stub save — the real version inserts/updates `placement` rows from mapping.
  res.json({ ok: true, saved: rowCount || 0, db: "postgres + md", mapped_fields: Object.keys(mapping || {}).length,
    apiUrl: `/api/doc/${slug(client || "ANSR-KENVUE")}/${docId}`, switched: true });
});

// validation: contract terms (AI-identified) vs the supplied data
app.get("/api/mint/validate/:client", (req, res) => {
  res.json({ steps: [
    { label: "Match contract terms to roster columns", status: "pass", detail: "TA bands · milestones · OSS slabs aligned" },
    { label: "Validate lifecycle dates (sourcing/offer/join/exit)", status: "pass" },
    { label: "Confirm CTC present for every billable row", status: "pass" },
    { label: "Resolve source → referral classification", status: "warn", detail: "2 sources need confirming" },
    { label: "Headcount roll-forward consistent (OSS)", status: "pass" },
    { label: "Currency / FX basis resolved", status: "pass", detail: "INR → USD @ RBI invoice-date" },
  ], ready: true });
});

// box interactions (stub AI until pipelines wired)
app.post("/api/box/:id/chat", async (req, res) => {
  const msg = (req.body?.message || "").slice(0, 500);
  const out = await runPipeline("qa", { system: `You are answering about the contract analysis box "${req.params.id}". Be concise; cite the clause; show the calc trail when relevant.`, user: msg });
  res.json({ reply: out.text || out.fallback || "…", mode: out.mode, model: out.model || null });
});

// the AI write-up / mapping for the Admin tab
app.get("/api/ai/map", (_req, res) => res.json({ pipelines: aiMap() }));
app.post("/api/box/:id/amend", (req, res) => {
  res.json({ ok: true, box_id: req.params.id, version: 2, note: "stub — amendment recorded; recompiles rule on real engine" });
});

// ---- AI-pipeline registry + config -----------------------------------------
app.get("/api/config", (_req, res) => res.json(publicConfig()));
app.get("/api/pipelines", (_req, res) => res.json({ pipelines: loadConfig().pipelines }));
// make a provider+model the default across all (non-deterministic) journeys.
// MUST be declared before /api/pipelines/:id so "default" isn't read as an id.
app.post("/api/pipelines/default", (req, res) => {
  const { provider, model } = req.body || {};
  if (!provider) return res.status(400).json({ error: "provider required" });
  const cfg = loadConfig();
  let applied = 0;
  for (const [pid, p] of Object.entries(cfg.pipelines)) {
    if (p.kind !== "deterministic") { cfg.pipelines[pid] = { ...p, provider, ...(model && { model }) }; applied++; }
  }
  saveConfig(cfg);
  res.json({ ok: true, applied });
});

app.post("/api/pipelines/:id", (req, res) => {
  const cfg = loadConfig();
  const p = cfg.pipelines[req.params.id];
  if (!p) return res.status(404).json({ error: "unknown pipeline" });
  const { provider, model, enabled, prompt } = req.body || {};
  cfg.pipelines[req.params.id] = { ...p, ...(provider !== undefined && { provider }), ...(model !== undefined && { model }), ...(enabled !== undefined && { enabled: !!enabled }), ...(prompt !== undefined && { prompt }) };
  saveConfig(cfg);
  res.json({ ok: true, pipeline: cfg.pipelines[req.params.id] });
});
// test a connector: live ping for anthropic-compatible, key-presence else.
app.post("/api/providers/:id/test", async (req, res) => {
  const id = req.params.id;
  const key = getApiKey(id);
  if (!key) return res.json({ ok: false, detail: "no key saved" });
  const cfg = loadConfig().providers[id] || {};
  const model = (cfg.models || [])[0];
  try {
    const t0 = Date.now();
    if (id === "anthropic" || cfg.baseURL) {
      const client = new Anthropic({ apiKey: key, baseURL: cfg.baseURL || undefined });
      await client.messages.create({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
      return res.json({ ok: true, detail: `live ok · ${model}`, ms: Date.now() - t0 });
    }
    return res.json({ ok: true, detail: "key present (live test not wired for this provider)" });
  } catch (e) {
    return res.json({ ok: false, detail: String(e.message || e).slice(0, 120) });
  }
});

app.post("/api/providers/:provider", (req, res) => {
  const cfg = loadConfig();
  if (!cfg.providers[req.params.provider]) return res.status(404).json({ error: "unknown provider" });
  if (req.body?.apiKey) cfg.providers[req.params.provider].apiKey = encryptKey(req.body.apiKey);
  saveConfig(cfg);
  res.json({ ok: true });
});

// multer / upload errors → clean JSON (e.g. file too large)
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large — max 25 MB." });
  if (err) return res.status(500).json({ error: err.message || "upload error" });
  res.status(500).json({ error: "error" });
});

const PORT = process.env.PORT || 4100;
// Bind the config backend (Postgres in prod, local file in dev) before serving.
initConfig()
  .then((backend) => console.log(`Q&ANSR config backend: ${backend} · storage: ${usingBucket() ? "supabase-bucket" : "local-disk"}`))
  .catch(() => {})
  .finally(() => app.listen(PORT, () => console.log(`Q&ANSR on http://localhost:${PORT}`)));
