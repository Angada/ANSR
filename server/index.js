// Q&ANSR microsite server. Doc intake (hybrid knowledge store), the doc x api
// switch (serve the .md extract, never the original), the AI-pipeline registry,
// and config. The calc/normalize/assure/statement engines mount here as built.
import express from "express";
import multer from "multer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, toMarkdown } from "./extract.js";
import { q } from "./db/client.js";
import { loadConfig, saveConfig, publicConfig, encryptKey, getApiKey, initConfig, publicIntegrations, setIntegration, getIntegrationKey, assertSecurity } from "./store.js";
import { putOriginal, putExtract, getExtract, listExtracts, usingBucket } from "./storage.js";
import { stubRun, stubOps, stubContracts, stubContract, stubRuns, stubAnalysis, stubInvoice } from "./stub.js";
import Anthropic from "@anthropic-ai/sdk";
import { inferMapping, detectIssues, summarizeIssues, CANONICAL } from "./roster.js";
import { runPipeline, aiMap, buildContext } from "./ai.js";
import { saveLedger, computeAndPersist, getRuleBook, runWorkedExamples, federation, epidemiology } from "./engine/run.js";
import { parseDate } from "./engine/normalize.js";
import { mountWhisperer } from "./whisperer.js";
import { mountJourney } from "./raydar-journey.js";
import { getRate, setManualRate } from "./fx.js";
import { classify as atlasClassify, route as atlasRoute, listArchetypes, archetypeDetail, getWiki } from "./atlas/atlas.js";
import { createDrift } from "./atlas/drift.js";
import { createPreIntake } from "./atlas/preintake.js";
import { runMigrations } from "./migrate.js";
import { stubClauses, upsertInterpretation, getInterpretations } from "./clauses.js";
import { registerCorpusDoc, intakeCorpus, reparse, getChipGroups, ruleBookFromChips, seedStubCorpus, mstore } from "./munshi/engine.js";
import { parserMode, setParserMode, ocrMode, setOcrMode } from "./munshi/flag.js";
import { mountContra } from "./contra.js";
import { mountQLegal } from "./qlegal.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploads = join(root, "uploads"); // multer temp only — persistent artifacts go to storage.js
if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });

const app = express();
app.use(express.json({ limit: "4mb" }));

// ---- security headers (all responses) ---------------------------------------
const IS_PROD = process.env.NODE_ENV === "production";
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

// ---- soft login + per-role app access ---------------------------------------
// Three accounts, each seeing only its own apps. Access is enforced SERVER-SIDE
// (page + API prefix), not just hidden in the nav — a hidden tab is not a gate.
const AUTH_USER = process.env.QANSR_USER || "admin";
const AUTH_PW = process.env.QANSR_PW || "admin";
const ACCOUNTS = [
  { user: AUTH_USER, pw: AUTH_PW, role: "Admin", apps: ["raydar", "contra", "qlegal", "mint"], admin: true },
  { user: process.env.CONTENT_USER || "content", pw: process.env.CONTENT_PW || "content", role: "Content", apps: ["raydar"], admin: false },
  // `locked` apps are SEEN but not entered: the tile renders with a lock, clicking
  // explains what the app does and offers to request access. Access itself is still
  // decided by `apps` — a locked app is simply not in it, so the server blocks it
  // exactly as it blocks any other app the account doesn't hold.
  { user: process.env.LEGAL_USER || "legal", pw: process.env.LEGAL_PW || "legal", role: "Legal", apps: ["qlegal"], locked: ["contra"], admin: false },
];
// which pages + api prefixes belong to each app (everything else is admin-only)
const APP_ROUTES = {
  raydar: { pages: ["/whisperer.html", "/whisperer.js"], apis: ["/api/wh/"] },
  contra: { pages: ["/contra.html", "/contra.js", "/contract.html", "/contract.js", "/contracts.html", "/contracts.js"], apis: ["/api/contra/"] },
  qlegal: { pages: ["/qlegal.html", "/qlegal.js"], apis: ["/api/qlegal/"] },
  mint:   { pages: ["/mint.html", "/mint.js", "/invoice.html", "/invoice.js", "/invoice-doc.js", "/atlas.html", "/atlas.js"], apis: ["/api/mint/", "/api/atlas/", "/api/runs", "/api/customers", "/api/roster", "/api/ruleset"] },
};
// admin-only surfaces: the Vault, the pipeline registry, integrations, accounts
const ADMIN_ONLY = { pages: ["/admin.html", "/admin.js"], apis: ["/api/config", "/api/pipelines", "/api/providers", "/api/integrations", "/api/vault"] };
const token = (a) => createHash("sha256").update(`${a.user}:${a.pw}:qansr-soft`).digest("hex");
const OPEN = ["/login.html", "/login.js", "/app.css", "/favicon.png", "/apple-touch-icon.png", "/q-emblem.png", "/api/login", "/health"];
const cookieToken = (req) => (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("qansr_auth="))?.slice(11);
// constant-time compare (no login/cookie timing oracle); Secure cookie in prod only (local dev is http)
const safeEq = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
const accountOf = (req) => { const t = cookieToken(req); return ACCOUNTS.find((a) => safeEq(t, token(a))) || null; };
const authed = (req) => !!accountOf(req);
const setSession = (res, acct) => res.setHeader("Set-Cookie", `qansr_auth=${token(acct)}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${IS_PROD ? "; Secure" : ""}`);

// May this account touch this path? Shared plumbing (/api/me, /q.js, /brand, the
// landing page) is allowed to everyone who is signed in.
function allowedFor(acct, path) {
  if (acct.admin) return true;
  const hitsAdmin = ADMIN_ONLY.pages.includes(path) || ADMIN_ONLY.apis.some((p) => path.startsWith(p));
  if (hitsAdmin) return false;
  for (const [app, r] of Object.entries(APP_ROUTES)) {
    const owned = r.pages.includes(path) || r.apis.some((p) => path.startsWith(p));
    if (owned) return acct.apps.includes(app);
  }
  return true;   // shared assets + shared APIs
}

// in-memory login throttle (per-IP sliding window) — blunts brute force
const LOGIN_HITS = new Map();
const loginThrottled = (ip) => {
  const now = Date.now(), win = 5 * 60_000, max = 12;
  const hits = (LOGIN_HITS.get(ip) || []).filter((t) => now - t < win);
  hits.push(now); LOGIN_HITS.set(ip, hits);
  if (LOGIN_HITS.size > 5000) LOGIN_HITS.clear();
  return hits.length > max;
};

app.post("/api/login", (req, res) => {
  // XFF[0] is the CLIENT-supplied end of the chain — GCP's load balancer appends
  // the real IP rather than replacing the header, so trusting [0] let anyone
  // reset their own throttle by rotating a made-up value. Take the last hop.
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : (req.ip || "?");
  if (loginThrottled(ip)) return res.status(429).json({ error: "too many attempts — wait a few minutes" });
  const { user, pw } = req.body || {};
  const provided = createHash("sha256").update(`${user}:${pw}:qansr-soft`).digest("hex");
  const acct = ACCOUNTS.find((a) => safeEq(provided, token(a)));
  if (acct) { setSession(res, acct); return res.json({ ok: true, role: acct.role, apps: acct.apps, home: acct.apps.length === 1 ? APP_ROUTES[acct.apps[0]].pages[0] : "/" }); }
  res.status(401).json({ error: "wrong login or password" });
});
// the nav renders from this — the account's apps, and whether Admin is theirs
app.get("/api/me", (req, res) => {
  const acct = accountOf(req);
  if (!acct) return res.status(401).json({ error: "auth required" });
  res.json({ user: acct.user, role: acct.role, apps: acct.apps, locked: acct.locked || [], admin: acct.admin });
});
// "I can see this app but can't open it — please give me access." Recorded, not
// granted: an admin still has to act. Append-only, like every other decision.
app.post("/api/access-request", async (req, res) => {
  const acct = accountOf(req);
  if (!acct) return res.status(401).json({ error: "auth required" });
  const app_id = String(req.body?.app || "").slice(0, 40);
  if (!app_id) return res.status(400).json({ error: "app required" });
  await q(`insert into audit_log(actor, action, object_type, object_id, detail) values($1,'access.request','app',$2,$3::jsonb)`,
    [acct.user, app_id, JSON.stringify({ role: acct.role, note: String(req.body?.note || "").slice(0, 300) })]).catch(() => {});
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `qansr_auth=; HttpOnly; Path=/; Max-Age=0${IS_PROD ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (OPEN.some((p) => req.path === p) || req.path.startsWith("/brand/") || req.path.startsWith("/raydar-approach-note") || req.path.startsWith("/raydar-engine")) return next(); // public: shareable client approach note + engine pipeline doc
  const acct = accountOf(req);
  if (!acct) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth required" });
    return res.redirect("/login.html");
  }
  // signed in, but is this app theirs? (enforced here, not in the nav)
  if (!allowedFor(acct, req.path)) {
    if (req.path.startsWith("/api/")) return res.status(403).json({ error: "not available on this account" });
    const home = acct.apps.length ? APP_ROUTES[acct.apps[0]].pages[0] : "/login.html";
    return res.redirect(home);
  }
  return next();
});

// Always revalidate code/markup so a deploy shows up immediately (ETag → 304 when
// unchanged, fresh 200 after a deploy) — no more stale cached whisperer.js/contra.js.
const revalidate = (res, p) => { if (/\.(js|css|html)$/i.test(p)) res.setHeader("Cache-Control", "no-cache"); };
app.use(express.static(join(root, "public"), { setHeaders: revalidate }));
app.use("/brand", express.static(join(root, "brand"), { setHeaders: revalidate })); // tokens.css + logo for the UI
const MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB
const upload = multer({ dest: uploads, limits: { fileSize: MAX_UPLOAD } });
mountContra(app, upload); // Contra — contract review (archetype maker + review)
mountQLegal(app, upload); // Q-Legal — legal repository intelligence (registry · search · obligations · rules)

const slug = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
// docId must be a bare token — never a path (blocks ../ traversal into the docstore)
const safeDocId = (s) => String(s || "").replace(/[^A-Za-z0-9._-]/g, "").replace(/\.\.+/g, ".").slice(0, 120);

// SSRF guard: only http(s), and refuse hosts that resolve to private / link-local /
// metadata ranges (blocks 169.254.169.254, RFC1918, localhost, …) + no redirects.
const isBlockedIp = (ip) => {
  if (!ip) return true;
  if (isIP(ip) === 6) { const l = ip.toLowerCase(); return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:"); }
  const p = ip.split(".").map(Number); if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
};
async function safeFetchJson(raw) {
  let u; try { u = new URL(String(raw)); } catch { throw new Error("bad url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked scheme");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|metadata\.google\.internal)$/i.test(host)) throw new Error("blocked host");
  const addrs = isIP(host) ? [{ address: host }] : await dnsLookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new Error("blocked host");
  const r = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(8000) });
  return r.json();
}

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
    console.error("upload:", e.message);
    res.status(500).json({ error: "upload failed" });
  } finally {
    if (req.file?.path) rmSync(req.file.path, { force: true }); // never leave multer temp files behind
  }
});

// ---- the "doc x api switch": serve the MD extract, never the original --------
// Which app owns a docstore namespace. Q-Legal writes under Q-LEGAL; everything
// else is a Mint customer code. Without this the docstore was a side door around
// the app gate — a Content account could read Q-Legal contracts and Mint roster
// PII, because /api/doc/ matches no app prefix and fell through to "allow".
const docNamespaceApp = (ns) => (String(ns || "").toUpperCase().startsWith("Q-LEGAL") ? "qlegal" : "mint");
function mayReadDocs(req, ns) {
  const acct = accountOf(req);
  if (!acct) return false;
  if (acct.admin) return true;
  return (acct.apps || []).includes(docNamespaceApp(ns));
}

app.get("/api/doc/:customer/:docId", async (req, res) => {
  if (!mayReadDocs(req, req.params.customer)) return res.status(403).json({ error: "not available on this account" });
  const md = await getExtract(slug(req.params.customer), safeDocId(req.params.docId));
  if (md == null) return res.status(404).send("Document extract not found.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(md);
});

app.get("/api/docs/:customer", async (req, res) => {
  if (!mayReadDocs(req, req.params.customer)) return res.status(403).json({ error: "not available on this account" });
  res.json({ docs: await listExtracts(slug(req.params.customer)) });
});

// ---- shell data (stub until Phase A + calc engine land) --------------------
// The hub shows only the agents the signed-in account actually holds. This is
// filtered SERVER-side, not hidden in CSS: a Content login must not even be told
// that Mint or Q-Legal exist. `locked` apps are the deliberate exception — they
// render as a locked tile the account can ask for access to. Admin sees all.
app.get("/api/ops", (req, res) => {
  const acct = accountOf(req);
  const all = stubOps();
  if (!acct || acct.admin) return res.json({ ops: all });
  // map each live tile to its app key via APP_ROUTES (href → app), so this stays
  // correct automatically when a page is added to an app.
  const appOf = (href) => Object.entries(APP_ROUTES).find(([, r]) => r.pages.includes(href))?.[0] || null;
  const mine = new Set(acct.apps || []), locked = new Set(acct.locked || []);
  const ops = all.filter((a) => {
    if (a.href === "/admin.html") return false;              // admin console is admin-only
    const app = appOf(a.href);
    if (!app) return false;                                  // "coming soon" tiles: noise for a scoped login
    return mine.has(app) || locked.has(app);
  }).map((a) => (locked.has(appOf(a.href)) ? { ...a, status: "locked" } : a));
  res.json({ ops });
});
app.get("/api/contracts", (_req, res) => res.json({ contracts: stubContracts() }));
app.get("/api/contract/:id", (req, res) => res.json(stubContract(slug(req.params.id))));
app.get("/api/runs/:customer", (req, res) => res.json({ runs: stubRuns(slug(req.params.customer)) }));
app.get("/api/run/:customer/:runNo", async (req, res) => {
  const client = slug(req.params.customer), no = Number(req.params.runNo) || 1;
  try {
    const r = await q(`select manifest from run where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, no]);
    if (r.rows?.[0]?.manifest?.source === "engine") return res.json(r.rows[0].manifest);
  } catch { /* */ }
  res.json(stubRun(client, no));
});

// ---- Mint contract analysis (run system: recall / new / purge) -------------
app.get("/api/clients", async (_req, res) => {
  try {
    const r = await q(`select code as id, name, coalesce(billing_ccy, currency, 'USD') as currency from customer order by name`);
    if (r.rows?.length) return res.json({ clients: r.rows });
  } catch { /* fall back */ }
  res.json({ clients: stubContracts() });
});
app.post("/api/clients", async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const code = slug(name), currency = (req.body?.currency || "USD").trim() || "USD";
  try {
    await q(`insert into customer(code,name,currency,billing_ccy,contract_ccy)
             values($1,$2,$3,$3,$3) on conflict(code) do update set name=excluded.name`, [code, name, currency]);
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('vik','client.create','customer',$1,$2::jsonb)`,
      [code, JSON.stringify({ name, currency, notes: req.body?.notes || "" })]).catch(() => {});
    return res.json({ ok: true, id: code, name, currency, persisted: true });
  } catch (e) {
    return res.json({ ok: true, id: code, name, currency, persisted: false });
  }
});
app.get("/api/mint/runs/:client", async (req, res) => {
  const client = slug(req.params.client);
  try {
    const r = await q(`select run_no, label, status, invoice_month, to_char(finished_at,'YYYY-MM-DD') as created from run
                       where customer_id=(select id from customer where code=$1) order by run_no`, [client]);
    if (r.rows?.length) return res.json({ runs: r.rows.map((x) => ({ run_no: x.run_no, month: x.invoice_month || x.created, status: x.status, label: x.label })) });
  } catch { /* fall back */ }
  res.json({ runs: stubRuns(client) });
});

// Contract Compiler readiness — the canonical rule set + coverage/validation.
app.get("/api/mint/ruleset/:client", async (req, res) => {
  const client = slug(req.params.client);
  try {
    const rs = (await q(`select id, version_no, status, coverage_pct, compiled from rule_set
                         where customer_id=(select id from customer where code=$1) and status<>'superseded'
                         order by (status='locked') desc, version_no desc limit 1`, [client])).rows?.[0];
    if (!rs) return res.json({ exists: false });
    const val = (await q(`select coverage_pct, status, gaps, conflicts, examples from rule_validation where rule_set_id=$1 order by run_at desc limit 1`, [rs.id])).rows?.[0] || null;
    const dims = (await q(`select name, source_column, type, allowed_values from rule_dimension where rule_set_id=$1`, [rs.id])).rows || [];
    const heads = (rs.compiled?.cost_heads || []).map((h) => ({ code: h.code, kind: h.kind, dimensions: h.rate_table?.keys || [] }));
    res.json({ exists: true, version: rs.version_no, status: rs.status, coverage_pct: rs.coverage_pct, dimensions: dims, heads, validation: val });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Billing-month range CALIBRATED from the worksheet's own dates — scans every
// date-like value in the ledger (generic; works for any contract structure).
// SaaS/usage contracts with no dates → empty range → client falls back to today.
app.get("/api/mint/daterange/:client", async (req, res) => {
  const client = slug(req.params.client);
  const set = new Set();
  try {
    const rows = (await q(`select raw from placement where customer_id=(select id from customer where code=$1)`, [client])).rows || [];
    for (const r of rows) for (const [k, v] of Object.entries(r.raw || {})) {
      if (!/date/i.test(k)) continue;                      // only real date fields, not CTC/seats/etc.
      const d = parseDate(v); if (!d.iso) continue;
      const y = +d.iso.slice(0, 4); if (y >= 2000 && y <= 2100) set.add(d.iso.slice(0, 7)); // sane years
    }
  } catch { /* */ }
  const months = [...set].sort();
  res.json(months.length ? { min: months[0], max: months[months.length - 1], months, default: months[months.length - 1] } : { min: null, max: null, months: [], default: null });
});
app.get("/api/mint/run/:client/:no", async (req, res) => {
  const client = slug(req.params.client), no = Number(req.params.no) || 1;
  try {
    const r = await q(`select manifest from run where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, no]);
    if (r.rows?.[0]?.manifest) return res.json(r.rows[0].manifest);
  } catch { /* fall back */ }
  res.json(stubAnalysis(client, no));
});
const BOX_PROMPT = `From the contract below, output STRICT JSON only — no prose, no code fences:
{"summary":{"title":"Contract summary","text":"<2-4 sentences>"},
 "findings":["<key billing fact>", ...],
 "boxes":[{"box_type_code":"company|legal|payment_terms|commercial_terms|billing_rules|caveats|flags",
   "title":"<short>","ai_explain":"<1-2 sentences>","content":{<key:value facts; arrays of objects for tables>},
   "confidence":0.0-1.0,"clause_ref":"§<n>"}]}
Always include a "billing_rules" box with the executable TA/OSS/milestone logic (ctc_definition, ta_rate_table, milestones, oss_slabs, currency). Cite the clause for every box.`;

async function nextRunNo(client) {
  try {
    const r = await q(`select coalesce(max(run_no),0)+1 as n from run where customer_id=(select id from customer where code=$1)`, [client]);
    if (r.rows?.[0]) return r.rows[0].n;
  } catch { /* ignore */ }
  return (stubRuns(client).at(-1)?.run_no || 0) + 1;
}

app.post("/api/mint/run", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const runNo = await nextRunNo(client);
  const sowDocId = req.body?.sowDocId;
  let payload = null;
  if (sowDocId) {
    try {
      const md = await getExtract(client, sowDocId);
      if (md) {
        const out = await runPipeline("contract-intake", { system: BOX_PROMPT, user: md.slice(0, 60000), maxTokens: 4000 });
        if (out.mode === "ai" && out.text) {
          const m = out.text.match(/\{[\s\S]*\}/);
          if (m) {
            const j = JSON.parse(m[0]);
            const boxes = (j.boxes || []).map((b) => ({ id: b.box_type_code, box_type_code: b.box_type_code, title: b.title, ai_explain: b.ai_explain, content: b.content || {}, confidence: b.confidence ?? 0.8, clause_ref: b.clause_ref || "", status: "draft", chat: [], suggestions: [] }));
            if (boxes.length) payload = { client, run_no: runNo, source: `ai:${out.model}`, steps: stubAnalysis(client).steps, summary: j.summary || { title: "Contract summary", text: "" }, findings: j.findings || [], boxes };
          }
        }
        if (!payload) payload = { ...stubAnalysis(client, runNo), source: out.mode === "ai" ? "ai-parse-failed" : `no-ai (${out.mode})`, sow: true };
      }
    } catch (e) { /* fall through */ }
  }
  if (!payload) payload = stubAnalysis(client, runNo);

  // Atlas template-fill: route this contract; a matched archetype pre-loads its
  // compiled rule book so the journey starts ready (AI later fills only deltas).
  try {
    const route = await atlasRoute(client);
    payload.atlas = { decision: route.decision, similarity: route.similarity, archetype: route.archetype };
    if (route.decision !== "novel" && route.preloaded?.cost_heads?.length) payload.compiled_rule_book = route.preloaded;
    // epidemiology pre-warning: recurring exceptions across this archetype's siblings
    try { const pw = await epidemiology.prewarn(client); if (pw.warnings?.length) payload.atlas.prewarn = pw.warnings; } catch { /* */ }
  } catch { /* atlas optional */ }

  // persist the run (history / audit) — best-effort
  try {
    await q(`insert into run(customer_id, run_no, label, status, manifest, started_at, finished_at)
             values((select id from customer where code=$1), $2, $3, 'complete', $4::jsonb, now(), now())
             on conflict(customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now()`,
      [client, runNo, payload.source || "run", JSON.stringify(payload)]);
    for (const b of payload.boxes || []) {
      await q(`insert into box(customer_id, box_type_code, title, content, ai_explain, confidence, clause_ref, status)
               values((select id from customer where code=$1), $2, $3, $4::jsonb, $5, $6, $7, 'draft')`,
        [client, b.box_type_code, b.title, JSON.stringify(b.content || {}), b.ai_explain || "", b.confidence ?? null, b.clause_ref || ""]).catch(() => {});
    }
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('vik','run.create','run',$1,$2::jsonb)`,
      [`${client}#${runNo}`, JSON.stringify({ source: payload.source, boxes: (payload.boxes || []).length })]).catch(() => {});
  } catch { /* json-only fallback */ }

  res.json(payload);
});

app.get("/api/mint/invoice/:client/:no", async (req, res) => {
  const client = slug(req.params.client), no = Number(req.params.no) || 3;
  try {
    const r = await q(`select manifest from run where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, no]);
    const m = r.rows?.[0]?.manifest;
    if (m?.source === "engine") return res.json(invoiceFromManifest(client, m));
  } catch { /* */ }
  res.json(stubInvoice(client, no));
});
function invoiceFromManifest(client, m) {
  const c = m.currency || "USD";
  const title = (h) => String(h).replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
  let lines;
  if (m.by_head && Object.keys(m.by_head).length) {
    // generic: one line per cost head the engine produced (works for any structure)
    lines = Object.entries(m.by_head).map(([head, amount]) => ({ head: title(head), desc: `${title(head)} · ${m.invoice_month}`, hsn: "998511", amount }));
  } else {
    // legacy fallback: TA/OSS buckets
    const sum = (k) => (m.ta || []).reduce((s, t) => s + (t[k] || 0), 0);
    lines = [
      m.oss ? { head: "OSS", desc: `Operations Support Fee · ${m.invoice_month} · ${m.oss.closing_active_hc} active HC`, hsn: "998511", amount: m.oss.oss_amount } : null,
      { head: "TA — Sourcing", desc: "Sourcing commencement advances", hsn: "998511", amount: sum("sourcing_billed") },
      { head: "TA — Acceptance", desc: "Offer acceptance advances", hsn: "998511", amount: sum("acceptance_billed") },
      { head: "TA — Balance", desc: "Balance TA fees (post-onboarding)", hsn: "998511", amount: sum("balance_billed") },
    ];
  }
  lines = lines.filter((l) => l && l.amount); // drop zero lines; keep negative (credits/clawback)
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  return { client, run_no: m.run_no, invoice_month: m.invoice_month, currency: c, source: "engine",
    invoice_no: `ANSR/${client.replace(/[^A-Z0-9]/g, "").slice(0, 4)}/${(m.invoice_month || "").replace("-", "")}/${String(m.run_no).padStart(2, "0")}`,
    from: { name: "ANSR Global Services Pvt. Ltd.", addr: "<ANSR registered address>", gstin: "<ANSR GSTIN>", email: "billing@ansr.com" },
    to: { name: client, addr: "<client billing address>", attn: "<accounts payable>", gstin: "<client GSTIN>" },
    lines, subtotal, tax: { label: "Tax", rate: 0, amount: 0, note: "place-of-supply / GST as applicable" }, total: subtotal,
    notes: "Computed by Q&ANSR · Mint from the SOW + worksheet. Clause- and calc-traceable." };
}

// Analytics — generic, assembled from every computed run's manifest (no
// contract-specific assumptions): monthly series + a flat, filterable line list.
app.get("/api/mint/analytics/:client", async (req, res) => {
  const client = slug(req.params.client);
  let runs = [];
  try { runs = (await q(`select run_no, manifest from run where customer_id=(select id from customer where code=$1) order by run_no`, [client])).rows || []; } catch { /* */ }
  const byMonth = new Map(); // latest run per invoice_month
  for (const r of runs) { const m = r.manifest; if (m?.source === "engine" && m.invoice_month) byMonth.set(m.invoice_month, m); }
  const months = [], lines = [];
  let currency = "USD";
  for (const m of [...byMonth.values()].sort((a, b) => a.invoice_month.localeCompare(b.invoice_month))) {
    currency = m.currency || currency;
    months.push({ month: m.invoice_month, oss: m.totals?.oss || 0, ta: m.totals?.ta || 0, grand: m.totals?.grand || 0, run_no: m.run_no, exceptions: (m.exceptions || []).length });
    const title = (h) => String(h).replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
    // per-employee detail for one_time_split heads (richer filtering by level/referral)
    const detailed = new Set();
    for (const t of m.ta || []) {
      const head = title(t._head || "ta"); detailed.add(t._head || "ta");
      if (t.sourcing_billed) lines.push({ month: m.invoice_month, head: `${head} · Sourcing`, name: t.employee, level: t.level, referral: t.referral, tech: t.tech, ccy: t.ccy, amount: t.sourcing_billed });
      if (t.acceptance_billed) lines.push({ month: m.invoice_month, head: `${head} · Acceptance`, name: t.employee, level: t.level, referral: t.referral, tech: t.tech, ccy: t.ccy, amount: t.acceptance_billed });
      if (t.balance_billed) lines.push({ month: m.invoice_month, head: `${head} · Balance`, name: t.employee, level: t.level, referral: t.referral, tech: t.tech, ccy: t.ccy, amount: t.balance_billed });
    }
    // head-level lines for every other cost head (slab / per_unit / flat / credit) — generic
    for (const [head, amount] of Object.entries(m.by_head || {})) {
      if (detailed.has(head) || !amount) continue;
      lines.push({ month: m.invoice_month, head: title(head), name: "", level: "", referral: null, tech: null, ccy: m.currency, amount });
    }
  }
  res.json({ client, currency, months, lines });
});

app.post("/api/mint/purge", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  try {
    await q(`delete from run where customer_id=(select id from customer where code=$1)`, [client]);
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('vik','run.purge','customer',$1,'{}'::jsonb)`, [client]).catch(() => {});
  } catch { /* ignore */ }
  res.json({ ok: true, purged: true });
});

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
    await putExtract(client, `${docId}-rows`, JSON.stringify(rows)); // full parsed rows for the ledger save
    await q(`insert into document(customer_id,doc_type,filename,sha256,storage_path,md_path,meta)
             values((select id from customer where code=$1),'roster',$2,$3,$4,$5,$6) on conflict do nothing`,
      [client, f.originalname, sha256, storagePath, mdPath, JSON.stringify({ sheet: sheet?.name, rows: rows.length })]).catch(() => {});
    // AI reads the actual data and explains it in natural language + asks only the
    // clarifications it genuinely needs (gated normalize pipeline). Heuristic
    // fallback lives in the client when there's no model/key.
    const ai = await understandRoster(client, { headers, mapping, sample: rows.slice(0, 6), issues }).catch(() => null);
    res.json({ filename: f.originalname, docId, apiUrl: `/api/doc/${client}/${docId}`,
      sheet: sheet?.name, headers, canonical: CANONICAL, mapping, rowCount: rows.length,
      rows: rows.slice(0, 25), issues, summary: summarizeIssues(issues), ai });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI worksheet understanding — natural language, asks real clarifications.
async function understandRoster(client, { headers, mapping, sample, issues }) {
  let rb = {}; try { rb = await getRuleBook(client); } catch { /* */ }
  const need = (rb.inputs || []).map((i) => i.field).join(", ") || "name, dates, CTC, source, level";
  const sys = `You are a friendly AR analyst reading a client's employee working sheet so it can be billed.
Talk like a helpful colleague — natural, warm, concise. NEVER output tables or JSON prose; write plain sentences.
The billing needs these inputs: ${need}.
Return STRICT JSON only: {"understanding":["short natural sentence", ...], "questions":[{"topic":"...","question":"natural question","options":["opt a","opt b"]}]}
Rules: only ask a question when you genuinely can't tell from the data (e.g. whether Total CTC = fixed + variable, or a date format that's ambiguous). Use topic "ctc" for CTC composition, "date_format" for date format, "map:<field>" to confirm a column for a billing field. If everything is clear, return an empty questions array.`;
  const user = `Headers: ${JSON.stringify(headers)}
My auto-mapping (billing field → column): ${JSON.stringify(mapping)}
A few sample rows: ${JSON.stringify(sample)}
Data issues I noticed: ${JSON.stringify((issues || []).slice(0, 8))}`;
  const out = await runPipeline("normalize", { system: sys, user, maxTokens: 900 });
  if (out.mode !== "ai" || !out.text) return null;
  const m = out.text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { const j = JSON.parse(m[0]); return { understanding: j.understanding || [], questions: j.questions || [], mode: out.mode, model: out.model }; }
  catch { return null; }
}

// the periodic feed can be an API, not just a file: push rows[] or pull a url.
// Flows into the SAME map → confirm → compute pipeline as an upload.
app.post("/api/mint/roster/api", async (req, res) => {
  try {
    const client = slug(req.body?.client || "ANSR-KENVUE");
    let rows = req.body?.rows;
    if (!rows && req.body?.url) {
      const j = await safeFetchJson(req.body.url);
      rows = Array.isArray(j) ? j : (j.rows || j.data || j.records);
    }
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: "no rows — provide rows[] or a url returning an array" });
    const headers = Object.keys(rows[0]);
    const mapping = req.body?.mapping || inferMapping(headers);
    const issues = detectIssues(rows, mapping);
    const sha = createHash("sha256").update(JSON.stringify(rows).slice(0, 8000) + rows.length).digest("hex");
    const docId = `api-${sha.slice(0, 8)}`;
    await putExtract(client, `${docId}-rows`, JSON.stringify(rows));
    await putExtract(client, docId, toMarkdown({ docType: "roster", originalName: `api-feed (${rows.length} rows)`, sha256: sha, extract: { kind: "document", text: `API data feed · ${rows.length} rows\nheaders: ${headers.join(", ")}\nsource: ${req.body?.url || "pushed rows"}` } }));
    await q(`insert into document(customer_id,doc_type,filename,sha256,storage_path,md_path,meta)
             values((select id from customer where code=$1),'roster','api-feed',$2,'api',$3,$4) on conflict do nothing`,
      [client, sha, `/api/doc/${client}/${docId}`, JSON.stringify({ source: "api", rows: rows.length, url: req.body?.url || null })]).catch(() => {});
    res.json({ filename: `API feed (${rows.length} rows)`, docId, apiUrl: `/api/doc/${client}/${docId}`, source: "api",
      sheet: "api", headers, canonical: CANONICAL, mapping, rowCount: rows.length, rows: rows.slice(0, 25), issues, summary: summarizeIssues(issues) });
  } catch (e) { console.error("roster/api:", e.message); res.status(400).json({ error: /^(bad url|blocked)/.test(e.message) ? e.message : "could not load feed rows" }); }
});

app.post("/api/mint/roster/confirm", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const { docId, mapping } = req.body || {};
  const saved = await saveLedger(client, docId, mapping);
  res.json({ ok: true, saved, db: "postgres", mapped_fields: Object.keys(mapping || {}).length,
    apiUrl: `/api/doc/${client}/${docId}`, switched: true });
});

// run the calc engine for a month → compute clean rows, quarantine the rest
app.post("/api/mint/run/compute", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const month = (req.body?.month || new Date().toISOString().slice(0, 7));
  // runNo present → recalibrate THAT existing run in place; absent → a new full run.
  const runNo = req.body?.runNo;
  try { res.json(await computeAndPersist(client, month, { runNo: runNo ?? undefined })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// release (freeze) a run — immutable statement for audit; next compute = new version
app.post("/api/mint/run/:client/:no/release", async (req, res) => {
  const client = slug(req.params.client), no = Number(req.params.no);
  try {
    await q(`update run set status='released', finished_at=now() where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, no]);
    await q(`update run set manifest = jsonb_set(manifest,'{status}','"released"') where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, no]).catch(() => {});
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('vik','run.release','run',$1,'{}'::jsonb)`, [`${client}#${no}`]).catch(() => {});
    res.json({ ok: true, released: true, run_no: no });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// clarifications: derived during compute; the latest run's open ones
app.get("/api/mint/clarifications/:client", async (req, res) => {
  const client = slug(req.params.client);
  try {
    const r = await q(`select manifest from run where customer_id=(select id from customer where code=$1) order by run_no desc limit 1`, [client]);
    res.json({ clarifications: r.rows?.[0]?.manifest?.clarifications || [], exceptions: r.rows?.[0]?.manifest?.exceptions || [] });
  } catch { res.json({ clarifications: [], exceptions: [] }); }
});
// resolve a clarification → persist decision → recompute that month
app.post("/api/mint/clarify", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const { topic, choice, month } = req.body || {};
  let runNo = req.body?.runNo;
  if (!topic || !choice) return res.status(400).json({ error: "topic + choice required" });
  try {
    await q(`insert into decision(customer_id, topic, choice, decided_by) values((select id from customer where code=$1),$2,$3,'vik')
             on conflict (customer_id, topic) do update set choice=excluded.choice, decided_at=now()`, [client, topic, choice]);
    await federation.record(client, topic, choice).catch(() => {}); // promote across the archetype
    const m = month || (await q(`select invoice_month from run where customer_id=(select id from customer where code=$1) order by run_no desc limit 1`, [client])).rows?.[0]?.invoice_month || new Date().toISOString().slice(0, 7);
    // recompute the SAME run being clarified (not a new one). fall back to the
    // latest non-released run for the month if the client didn't send a run_no.
    if (runNo == null) runNo = (await q(`select run_no from run where customer_id=(select id from customer where code=$1) and invoice_month=$2 and status<>'released' order by run_no desc limit 1`, [client, m])).rows?.[0]?.run_no ?? null;
    res.json(await computeAndPersist(client, m, { runNo: runNo ?? undefined }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// compiled rule book + worked-example self-test (trust badge)
app.get("/api/mint/rulebook/:client", async (req, res) => {
  const client = slug(req.params.client);
  const rb = await getRuleBook(client);
  res.json({ rule_book: rb, tests: await runWorkedExamples(rb, getRate), warnings: rb._warnings || [] });
});
// FX manual override / pin
app.post("/api/fx/override", async (req, res) => {
  const { from, to, rate, date } = req.body || {};
  if (!from || !to || !rate) return res.status(400).json({ error: "from,to,rate required" });
  res.json(await setManualRate(from, to, Number(rate), date));
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
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const ctx = await buildContext(client, { boxId: req.params.id });
  const out = await runPipeline("qa", {
    system: `You are answering about the contract analysis box "${req.params.id}". Answer ONLY from the context below; cite the clause § and show the calc trail when relevant.\n\n${ctx.text}`,
    user: msg,
  });
  res.json({ reply: out.text || out.fallback || "…", mode: out.mode, model: out.model || null, cited: ctx.cited });
});

// clause store (source of truth, chunked) + interpretation memory (learning)
app.get("/api/mint/clauses/:client", async (req, res) => {
  const client = slug(req.params.client);
  res.json({ clauses: stubClauses(client), interpretations: await getInterpretations(client) });
});
// correction write-back — a confirmed reading that grounds every future query
app.post("/api/mint/interpret", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  const { clause_ref, reading, compiles_to } = req.body || {};
  if (!clause_ref || !reading) return res.status(400).json({ error: "clause_ref + reading required" });
  const ok = await upsertInterpretation(client, { clause_ref, reading, compiles_to });
  res.json({ ok, clause_ref, learned: ok });
});

// ---- Munshi-for-Mint — living contract corpus + atomic rule-chips ----------
// (flag-gated: MINT_PARSER=munshi routes calc through the chip set; default stub)
// register a doc (uploaded via /api/upload → docId) into the contract corpus
app.post("/api/mint/corpus/add", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  try { res.json(await registerCorpusDoc(client, req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/mint/corpus/:client", async (req, res) => {
  res.json({ corpus: await mstore.listCorpus(slug(req.params.client)) });
});
// full (re)build of the chip set from the whole corpus
app.post("/api/mint/corpus/intake", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  try { await seedStubCorpus(client); res.json(await intakeCorpus(client)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// re-parse only the docs whose content hash moved (delta); confirmed chips kept
app.post("/api/mint/corpus/reparse", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  try { res.json(await reparse(client, { force: !!req.body?.force })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// the chip view: 7 boxes as chip groups + corpus + confirmed-vs-amendment conflicts
app.get("/api/mint/chips/:client", async (req, res) => {
  try { res.json(await getChipGroups(slug(req.params.client))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/mint/chip/:id/confirm", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  res.json({ ok: await mstore.confirmChip(client, Number(req.params.id)) });
});
app.post("/api/mint/chip/:id/amend", async (req, res) => {
  const client = slug(req.body?.client || "ANSR-KENVUE");
  if (req.body?.value === undefined) return res.status(400).json({ error: "value required" });
  res.json({ ok: await mstore.amendChip(client, Number(req.params.id), req.body.value) });
});
// trust badge: run the SOW's worked examples through the CHIP-assembled rule book
app.get("/api/mint/trust/:client", async (req, res) => {
  const client = slug(req.params.client);
  try {
    const rb = await ruleBookFromChips(client);
    if (!rb) return res.json({ ready: false, reason: "no chips — run corpus intake first" });
    const tests = await runWorkedExamples(rb, getRate);
    res.json({ ready: tests.length > 0 && tests.every((t) => t.pass), tests, heads: rb.cost_heads.map((h) => h.code), warnings: rb._warnings || [], source: rb._source });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// the parser flag (stub | munshi) — read + toggle
app.get("/api/mint/parser", (_req, res) => res.json({ mode: parserMode() }));
app.post("/api/mint/parser", (req, res) => res.json({ mode: setParserMode(req.body?.mode) }));
app.get("/api/mint/ocr", (_req, res) => res.json({ mode: ocrMode() }));
app.post("/api/mint/ocr", (req, res) => res.json({ mode: setOcrMode(req.body?.mode) }));

// the AI write-up / mapping for the Admin tab
app.get("/api/ai/map", (_req, res) => res.json({ pipelines: aiMap() }));

// ---- Atlas — contract archetype library (meta-learning) --------------------
app.post("/api/atlas/classify/:client", async (req, res) => { try { res.json(await atlasClassify(slug(req.params.client))); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/api/atlas/route/:client", async (req, res) => { try { res.json(await atlasRoute(slug(req.params.client))); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/api/atlas/archetypes", async (_req, res) => { try { res.json({ archetypes: await listArchetypes() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/api/atlas/archetype/:slug", async (req, res) => { const a = await archetypeDetail(req.params.slug); a ? res.json(a) : res.status(404).json({ error: "not found" }); });
app.get("/api/atlas/epidemiology/:client", async (req, res) => { try { res.json(await epidemiology.prewarn(slug(req.params.client))); } catch (e) { res.status(500).json({ error: e.message }); } });
const atlasDrift = createDrift({ q, getRuleBook }), atlasPreIntake = createPreIntake(q);
app.get("/api/atlas/drift/:client", async (req, res) => { try { res.json(await atlasDrift.check(slug(req.params.client))); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/api/atlas/fork/:client", async (req, res) => { try { res.json(await atlasDrift.fork(slug(req.params.client))); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/api/atlas/preintake", async (req, res) => { try { res.json(await atlasPreIntake.propose(slug(req.body?.client || ""), req.body?.sow || "")); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post("/api/atlas/preintake/confirm", async (req, res) => { try { res.json(await atlasPreIntake.confirm(slug(req.body?.client || ""), req.body || {})); } catch (e) { res.status(500).json({ error: e.message }); } });
// hybrid-knowledge wikis (MD) — doc×api switch over the Atlas namespace
app.get("/api/atlas/wiki", async (_req, res) => { const md = await getWiki("index"); res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.send(md || "# Atlas\nNo archetypes yet — route a contract."); });
app.get("/api/atlas/wiki/:slug", async (req, res) => { const md = await getWiki(req.params.slug); md == null ? res.status(404).send("not found") : (res.setHeader("Content-Type", "text/plain; charset=utf-8"), res.send(md)); });
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

// Embedding pipelines are NOT free-form. A chat model cannot embed, Anthropic has
// no embeddings endpoint at all, and Z.AI answers "Unknown Model" for the names
// its own docs list — which cost this estate a full re-index and, worse, silently
// downgraded every vector to key-free hashes while reporting success. So the
// choice is restricted to what is known to work, and the restriction lives on the
// SERVER: a dropdown that only offers valid options is a suggestion, not a gate.
const EMBED_PIPELINES = new Set(["qlegal-embed", "atlas-embed"]);
const EMBED_ALLOWED = {
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
};

app.post("/api/pipelines/:id", (req, res) => {
  const cfg = loadConfig();
  const p = cfg.pipelines[req.params.id];
  if (!p) return res.status(404).json({ error: "unknown pipeline" });
  const { provider, model, enabled, prompt } = req.body || {};

  if (EMBED_PIPELINES.has(req.params.id) && (provider !== undefined || model !== undefined)) {
    const wantP = provider !== undefined ? provider : p.provider;
    const wantM = model !== undefined ? model : p.model;
    const ok = EMBED_ALLOWED[wantP] && EMBED_ALLOWED[wantP].includes(wantM);
    if (!ok) return res.status(400).json({
      error: `${wantP}:${wantM} cannot be used for embeddings. Allowed: ${Object.entries(EMBED_ALLOWED).map(([k, v]) => v.map((m) => `${k}:${m}`).join(", ")).join(", ")}.`,
      why: "Z.AI rejects its own documented embedding model names, Anthropic has no embeddings endpoint, and a chat model cannot embed at all — each of those falls back to key-free hash vectors that look like success while making semantic search keyword-grade.",
    });
    // A model with no key is not a working choice — it is the same silent
    // degradation wearing a valid name.
    if (!getApiKey(wantP)) return res.status(400).json({
      error: `No API key saved for ${wantP}. Add it in Admin → Vault before pointing embeddings at it.`,
    });
  }
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
    // OpenAI / Gemini aren't Anthropic-compatible, so they get their own live ping.
    // Listing models proves the key works without spending a generation.
    if (id === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return res.json({ ok: false, detail: `HTTP ${r.status}: ${String(j?.error?.message || "").slice(0, 120)}` });
      const names = (j.data || []).map((m) => m.id);
      const emb = names.filter((n) => n.includes("embedding"));
      return res.json({ ok: true, ms: Date.now() - t0,
        detail: `live ok · ${names.length} models${emb.length ? ` · embeddings: ${emb.slice(0, 3).join(", ")}` : ""}` });
    }
    if (id === "google") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return res.json({ ok: false, detail: `HTTP ${r.status}: ${String(j?.error?.message || "").slice(0, 120)}` });
      const names = (j.models || []).map((m) => String(m.name || "").replace(/^models\//, ""));
      const emb = names.filter((n) => n.includes("embedding"));
      return res.json({ ok: true, ms: Date.now() - t0,
        detail: `live ok · ${names.length} models${emb.length ? ` · embeddings: ${emb.slice(0, 3).join(", ")}` : ""}` });
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

// ---- AUDIT TRAIL ----------------------------------------------------------
// One row per state-changing request, written automatically. Hand-placed audit
// calls only ever cover the endpoints someone remembered; this covers all of
// them, including any added later. Reads (GET) are deliberately NOT logged —
// they would bury the signal — except Ask/search queries, which ARE actions
// worth tracing back to a person.
const AUDIT_APP = [["/api/wh/", "raydar"], ["/api/qlegal/", "qlegal"], ["/api/contra/", "contra"],
  ["/api/mint/", "mint"], ["/api/atlas/", "mint"], ["/api/roster", "mint"], ["/api/runs", "mint"],
  ["/api/ruleset", "mint"], ["/api/customers", "mint"], ["/api/integrations", "admin"],
  ["/api/config", "admin"], ["/api/pipelines", "admin"], ["/api/vault", "admin"], ["/api/audit", "admin"]];
const auditAppOf = (p) => AUDIT_APP.find(([pre]) => p.startsWith(pre))?.[1] || "core";
// a query is a GET worth recording — the user asked the system something
const AUDIT_QUERY = /\/(ask|search|answer|qa)(\/|$|\?)/i;
// never let a secret reach the log, even if a field is added upstream later
const AUDIT_REDACT = /(key|token|secret|password|pw|apikey|authorization)/i;
const auditDetail = (req) => {
  const out = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (AUDIT_REDACT.test(k)) { out[k] = "«redacted»"; continue; }
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s != null) out[k] = String(s).slice(0, 300);
  }
  if (req.query && Object.keys(req.query).length) out._query = JSON.stringify(req.query).slice(0, 300);
  return out;
};
app.use((req, res, next) => {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const isQuery = req.method === "GET" && AUDIT_QUERY.test(req.path);
  if (!req.path.startsWith("/api/") || (!isWrite && !isQuery)) return next();
  const t0 = Date.now();
  res.on("finish", () => {
    const acct = accountOf(req);
    q(`insert into audit_log(actor, role, app, action, method, path, status, ms, ip, object_type, detail)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [acct?.user || "anonymous", acct?.role || null, auditAppOf(req.path),
       isQuery ? "query" : req.path.split("/").filter(Boolean).slice(-1)[0] || req.method,
       req.method, req.path, res.statusCode, Date.now() - t0,
       String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null,
       "api", JSON.stringify(auditDetail(req))]
    ).catch(() => { /* auditing must never break the request it is recording */ });
  });
  next();
});

// read the trail — admin only, filterable by app, actor, action and free text
app.get("/api/audit", async (req, res) => {
  const acct = accountOf(req);
  if (!acct?.admin) return res.status(403).json({ error: "admin only" });
  const { app: a, actor, action, q: term, limit } = req.query;
  const args = []; const w = [];
  if (a && a !== "all") { args.push(a); w.push(`app = $${args.length}`); }
  if (actor && actor !== "all") { args.push(actor); w.push(`actor = $${args.length}`); }
  if (action && action !== "all") { args.push(action); w.push(`action = $${args.length}`); }
  if (term) { args.push(`%${term}%`); w.push(`(path ilike $${args.length} or detail::text ilike $${args.length})`); }
  args.push(Math.min(Number(limit) || 200, 1000));
  try {
    const rows = (await q(`select id, at, actor, role, app, action, method, path, status, ms, ip, detail
        from audit_log ${w.length ? "where " + w.join(" and ") : ""} order by at desc limit $${args.length}`, args)).rows;
    const facets = (await q(`select
        (select coalesce(json_agg(distinct app), '[]') from audit_log where app is not null) as apps,
        (select coalesce(json_agg(distinct actor), '[]') from audit_log where actor is not null) as actors,
        (select count(*) from audit_log) as total`)).rows[0] || {};
    res.json({ rows, facets });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 140) }); }
});

// ---- RayDar integrations (key-based: YouTube, Reddit, Perplexity, Tavily, Serper…) ----
app.get("/api/integrations", (_req, res) => res.json({ integrations: publicIntegrations() }));
app.post("/api/integrations/:id", (req, res) => {
  const r = setIntegration(req.params.id, { apiKey: req.body?.apiKey, enabled: req.body?.enabled });
  if (!r) return res.status(404).json({ error: "unknown integration" });
  q(`insert into audit_log(actor,action,object_type,object_id,detail) values('admin','integration.set','integration',$1,$2::jsonb)`,
    [req.params.id, JSON.stringify({ enabled: r.enabled, hasKey: r.hasKey })]).catch(() => {});
  res.json({ ok: true, integration: r });
});
// best-effort connectivity test for a few providers (else: key-present check)
app.post("/api/integrations/:id/test", async (req, res) => {
  const id = req.params.id, key = getIntegrationKey(id), t0 = Date.now();
  const done = (ok, detail) => res.json({ ok, detail, ms: Date.now() - t0 });
  if (id === "wikidata") return done(true, "public — no key");
  if (!key) return done(false, "no key saved");
  try {
    if (id === "tavily") { const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, query: "test", max_results: 1 }) }); return done(r.ok, r.ok ? "connected" : `HTTP ${r.status}`); }
    if (id === "serper") { const r = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "content-type": "application/json" }, body: JSON.stringify({ q: "test" }) }); return done(r.ok, r.ok ? "connected" : `HTTP ${r.status}`); }
    if (id === "perplexity") { const r = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }) }); return done(r.ok || r.status === 400, r.ok ? "connected" : `key accepted (HTTP ${r.status})`); }
    if (id === "youtube") { const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${encodeURIComponent(key)}`); return done(r.ok, r.ok ? "connected" : `HTTP ${r.status}`); }
    return done(true, "key saved (no live test for this provider)");
  } catch (e) { return done(false, String(e.message || e).slice(0, 120)); }
});

// Whisperer routes (demand↔supply content intelligence — Journey 1, mock-first)
mountWhisperer(app, slug, upload);
// RayDar Journey — the gated, high-involvement lane alongside the express sweep
mountJourney(app, upload);

// multer / upload errors → clean JSON (e.g. file too large)
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large — max 25 MB." });
  if (err) return res.status(500).json({ error: err.message || "upload error" });
  res.status(500).json({ error: "error" });
});

const PORT = process.env.PORT || 4100;
// Apply schema (idempotent) + bind the config backend before serving.
runMigrations()
  .catch(() => {})
  .then(() => initConfig())
  .then((backend) => console.log(`Q&ANSR config backend: ${backend} · storage: ${usingBucket() ? "supabase-bucket" : "local-disk"}`))
  .catch(() => {})
  .finally(() => app.listen(PORT, () => console.log(`Q&ANSR on http://localhost:${PORT}`)));
