// Local JSON config store — API keys (AES-256-GCM encrypted at rest), model
// selection, and the Q&ANSR pipeline registry. Lives in data/config.json
// (gitignored). Adapted from the ESPL store; pipelines are the AI-pipeline
// registry (Leela pattern): each is gated by `enabled` and bound to a provider/
// model/skill set. raw user text is never sent to a model outside a pipeline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { q, getPool } from "./db/client.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const configPath = join(dataDir, "config.json");
const secretPath = join(dataDir, ".secret");

function secret() {
  const env = process.env.CONFIG_SECRET;
  if (env) return Buffer.from(env.padEnd(64, "0").slice(0, 64), "hex");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(secretPath, "utf8").trim(), "hex");
}

export function encryptKey(plain) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secret(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptKey(stored) {
  if (!stored) return "";
  if (!stored.startsWith("enc:")) return stored;
  try {
    const [, iv, tag, data] = stored.split(":");
    const d = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "hex"));
    d.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
  } catch { return ""; }
}

const DEFAULT_CONFIG = {
  providers: {
    anthropic: { label: "Claude", apiKey: "", models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"] },
    openai:    { label: "OpenAI", apiKey: "", models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"] },
    google:    { label: "Gemini", apiKey: "", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
    zai:       { label: "Z.AI", apiKey: "", models: ["glm-5.1", "glm-5", "glm-4.6", "glm-4.6-air", "glm-4.5", "glm-4.5-x", "glm-4.5-air", "glm-4.5-airx", "glm-4.5-flash", "glm-z1-air", "glm-z1-flash", "glm-z1-rumination", "glm-4-plus", "glm-4-long"], baseURL: "https://api.z.ai/api/anthropic" },
    xai:       { label: "x.AI", apiKey: "", models: ["grok-4", "grok-3", "grok-3-mini"] },
    deepseek:  { label: "DeepSeek", apiKey: "", models: ["deepseek-chat", "deepseek-reasoner"] },
  },
  // Q&ANSR AI-pipeline registry, grouped by product. kind: deterministic | llm | hybrid.
  // Only enabled llm/hybrid pipelines may call a provider. Each carries an editable prompt.
  pipelines: {
    "contract-intake": { id: "contract-intake", product: "Mint", name: "Contract Intake", kind: "hybrid",
      description: "Read the SOW → structured rule tables (TA bands, milestone split, OSS slabs) with clause refs.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-contract-intake", "qansr-knowledge-store"], enabled: true,
      prompt: "You are an AR contract analyst. Read the SOW extract and emit typed boxes (company, legal, payment_terms, commercial_terms, billing_rules, caveats, flags). For billing_rules derive executable TA/OSS/milestone logic with clause refs. Cite the clause for every claim." },
    "normalize": { id: "normalize", product: "Mint", name: "Normalizer", kind: "hybrid",
      description: "Map messy source/role/status/level/date/CTC to canonical values. AI suggests → human confirms → learns.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-normalizer"], enabled: true,
      prompt: "Normalize the employee roster. Map each raw source/role/status/date/CTC to its canonical value. For anything ambiguous propose the top option with confidence + reasoning. Never silently bucket unknowns — flag them." },
    "calc": { id: "calc", product: "Mint", name: "Calc Engine", kind: "deterministic",
      description: "Deterministic TA + OSS + milestone-split computation from the lifecycle ledger. No model call.",
      provider: "", model: "", skills: ["qansr-calc-engine", "qansr-lifecycle-ledger"], enabled: true, prompt: "" },
    "assure": { id: "assure", product: "Mint", name: "Invoice Assurance", kind: "hybrid",
      description: "Reproduce the calc, detect variance vs contract, flag exceptions.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["qansr-variance", "qansr-invoice-assurance", "qansr-exceptions"], enabled: true,
      prompt: "Assure the computed invoice. Check each line against the rule book + clause. Flag deviations, missing data, and exceptions with a one-line reason each." },
    "statement": { id: "statement", product: "Mint", name: "Statement Generator", kind: "deterministic",
      description: "Generate the monthly Statement of Invoicing (cover / OSS / TA / evidence / exceptions) → xlsx.",
      provider: "", model: "", skills: ["qansr-statement-generator"], enabled: true, prompt: "" },
    "clarify": { id: "clarify", product: "Mint", name: "AI Clarify", kind: "llm",
      description: "When data is ambiguous, ask a clause/evidence-backed question + recommend an option; persist the decision.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-ai-clarify"], enabled: true,
      prompt: "Given an ambiguity, trace the evidence across documents, recommend one option with confidence and risk-if-wrong, and cite the clause. Keep it to a single clear question." },
    "qa": { id: "qa", product: "Mint", name: "AR Analyst Q&A (grounded chat)", kind: "hybrid",
      description: "Answer 'why is this invoice line X' from the calc TRACE (BigFlex) + the contract clauses + the archetype playbook (Atlas). Deterministic md/db read + AI phrasing; corrections promote across the family.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-knowledge-store", "bigflex", "atlas"], enabled: true,
      prompt: "Answer as an AR analyst. Ground every answer in: (1) the calc trace for the number, (2) the cited contract clause, (3) the archetype playbook for how this family of contracts behaves. Never invent numbers — read them from the DB/markdown trace. If the user corrects you, record it as an interpretation/decision." },

    // ---- Atlas — the cross-contract learning brain (its own product group) ----
    "atlas-classify": { id: "atlas-classify", product: "Atlas", name: "Classify & Route", kind: "hybrid",
      description: "Fingerprint a contract's billing shape, match it to an archetype (weighted Jaccard + embedding blend), and route it. On a PARTIAL match the model maps divergent fields onto the family template; matched/novel are deterministic.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["atlas", "bigflex"], enabled: true,
      prompt: "Given a contract fingerprint and the closest archetype template, map each divergent field (heads/dims/measures/milestones) onto the template or flag it as genuinely new. Never silently force a mismatch — flag divergences for human review." },
    "atlas-preintake": { id: "atlas-preintake", product: "Atlas", name: "Pre-intake (raw SOW)", kind: "llm",
      description: "Read raw SOW prose BEFORE compile and propose the likely archetype shape + candidate families. Persists nothing — returns a confirm token for the human gate. Falls back to keyword heuristics when no key.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["atlas", "qansr-knowledge-store"], enabled: true,
      prompt: "Read the raw SOW text and infer its billing physiology: revenue heads (one_time_split / recurring_slab / per_unit / flat), driver dimensions, measures, milestones, currency. Return a structured fingerprint only — do not invent rates. This is a pre-compile proposal a human will confirm." },
    "atlas-embed": { id: "atlas-embed", product: "Atlas", name: "Semantic Embedding", kind: "deterministic",
      description: "Vector embedding of a fingerprint for the semantic-similarity blend (0.75·Jaccard + 0.25·cosine). Key-free hashed vector today; swappable for a provider embedding model.",
      provider: "", model: "", skills: ["atlas"], enabled: true, prompt: "" },
    "atlas-federation": { id: "atlas-federation", product: "Atlas", name: "Federated Normalizer Learning", kind: "deterministic",
      description: "Promote a label confirmed on one contract across its archetype once ≥2 siblings agree (conflict-detected). Auto-applies to future siblings. No model call.",
      provider: "", model: "", skills: ["atlas"], enabled: true, prompt: "" },
    "atlas-epidemiology": { id: "atlas-epidemiology", product: "Atlas", name: "Exception Epidemiology", kind: "deterministic",
      description: "Recompute the archetype's recurring exceptions after each run (prevalence + suggested fix) and pre-warn new contracts of that family. No model call.",
      provider: "", model: "", skills: ["atlas"], enabled: true, prompt: "" },
    "atlas-drift": { id: "atlas-drift", product: "Atlas", name: "Drift & Fork", kind: "deterministic",
      description: "Detect when a contract's fingerprint no longer fits its archetype (sim<.8 or heads changed) and suggest reroute or fork a new archetype version (lineage kept). No model call.",
      provider: "", model: "", skills: ["atlas"], enabled: true, prompt: "" },

    // ---- Whisperer — demand↔supply content intelligence -------------------
    "clientmind-parse": { id: "clientmind-parse", product: "Whisperer", name: "ClientMind Parse", kind: "hybrid",
      description: "Read a candidate's whole corpus (CV, letters, history, notes) → a master profile + rich 'chips' (skills, interests, behaviours, aspirations, career patterns, motivations). Munshi method — re-parse on change, weekly refresh.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["whisperer", "munshi"], enabled: true,
      prompt: "You read a candidate's documents and history. Return STRICT JSON {\"master_md\":\"...\",\"chips\":[{\"kind\":\"skill|interest|behaviour|aspiration|career_pattern|motivation|domain|tenure\",\"value\":\"short label\",\"weight\":0-1}]}. Be detailed and specific; never invent facts — only what the docs support." },
    "cohort-nl-query": { id: "cohort-nl-query", product: "Whisperer", name: "Cohort NL Query", kind: "llm",
      description: "Turn a natural-language cohort description ('never stayed >2 years anywhere') into a structured filter over candidate meta + chips.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["whisperer"], enabled: true,
      prompt: "Convert the natural-language cohort query into STRICT JSON filter rules over candidate fields (meta.years_exp, meta.domain, meta.tenure[], chips[].value). Return {\"rules\":[{\"field\":\"...\",\"op\":\"...\",\"value\":...}], \"explain\":\"...\"}. Flag ambiguity, don't guess." },
    "hunger-generate": { id: "hunger-generate", product: "Whisperer", name: "Hunger Story", kind: "llm",
      description: "Analyse a cohort's ClientMind chips → a Hunt Outcome: who they are, what they care about, likely searches, motivations, emotional drivers, and the Demand Topics.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["whisperer"], enabled: true,
      prompt: "From the cohort's aggregated chips, write a warm, specific Hunt Outcome. Return STRICT JSON {\"who\":\"...\",\"cares_about\":[\"...\"],\"likely_searches\":[\"...\"],\"motivations\":[\"...\"],\"emotional_drivers\":[\"...\"],\"demand_topics\":[\"...\"]}." },
    "trend-detect": { id: "trend-detect", product: "Whisperer", name: "Trend Detection", kind: "hybrid",
      description: "Scan collected feed items (YouTube/Reddit/Trends/News) for emerging topics, viral conversations, recurring themes and opportunity signals.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["whisperer"], enabled: true,
      prompt: "Given feed items, surface the strongest emerging trends relevant to the demand topics. Return STRICT JSON {\"trends\":[{\"title\":\"...\",\"signal\":\"...\",\"why_trending\":\"...\"}]}." },
    "feedstory-generate": { id: "feedstory-generate", product: "Whisperer", name: "Feed Story", kind: "llm",
      description: "Turn a matched (demand × trend) into a Feed Story: a HEADING + a TOPIC GUIDE (brief) — never finished content. Classified + justified.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["whisperer"], enabled: true,
      prompt: "Produce a content idea as STRICT JSON {\"heading\":\"...\",\"summary\":\"...\",\"topic_guide\":{\"take\":\"...\",\"beats\":[\"...\"],\"proof\":[\"...\"]},\"why_now\":\"...\",\"why_relevant\":\"...\",\"why_cohort\":\"...\",\"one_up\":\"...\",\"emotional_framework\":\"...\",\"emotional_register\":\"...\"}. The output is a heading + brief for a writer — do NOT write the finished piece. Be scientific AND creative in the justifications." },
  },
};

function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
}

// Merge a stored config over defaults (so new default providers/pipelines appear
// even on configs saved before they existed).
function mergeDefaults(cfg) {
  const providers = { ...DEFAULT_CONFIG.providers };
  // model lists are code-defined (not user data) — always take the latest from
  // DEFAULT so new models appear even over a saved config; keep saved apiKey/baseURL.
  for (const [id, p] of Object.entries(cfg.providers || {})) providers[id] = { ...DEFAULT_CONFIG.providers[id], ...p, models: DEFAULT_CONFIG.providers[id]?.models || p.models };
  const pipelines = { ...DEFAULT_CONFIG.pipelines };
  for (const [id, p] of Object.entries(cfg.pipelines || {})) {
    const d = DEFAULT_CONFIG.pipelines[id] || {};
    // user keeps runtime choices (provider/model/enabled/prompt); code-defined
    // descriptive fields (name/description/skills/kind) always take the latest
    // from DEFAULT so registry edits propagate over a saved config.
    pipelines[id] = { ...d, ...p, name: d.name ?? p.name, description: d.description ?? p.description, skills: d.skills ?? p.skills, kind: d.kind ?? p.kind };
  }
  return { ...DEFAULT_CONFIG, ...cfg, providers, pipelines };
}

function readFile() {
  ensure();
  return JSON.parse(readFileSync(configPath, "utf8"));
}

// Persistence: in-memory cache + a backend. Cloud Run disk is ephemeral, so in
// prod the config (incl. encrypted keys) lives in Postgres (app_config single
// row). Dev with no DB uses the local data/config.json exactly as before.
// Accessors stay SYNC (callers unchanged); writes persist best-effort.
let _cfg = null;
let _backend = "file"; // "file" | "db"

async function persistDb(cfg) {
  await q(
    `insert into app_config(id, data) values(1, $1::jsonb)
     on conflict (id) do update set data = $1::jsonb, updated_at = now()`,
    [JSON.stringify(cfg)]
  );
}

// Call once at boot (awaited) to bind the backend + warm the cache.
export async function initConfig() {
  if (getPool()) {
    try {
      const r = await q("select data from app_config where id = 1");
      if (r.rows?.[0]?.data) { _cfg = mergeDefaults(r.rows[0].data); _backend = "db"; return _backend; }
      // No row yet — seed from local file-or-default, then own the DB row.
      _cfg = mergeDefaults(readFile());
      _backend = "db";
      await persistDb(_cfg).catch(() => {});
      return _backend;
    } catch { /* table missing / DB down → fall through to file */ }
  }
  _cfg = mergeDefaults(readFile());
  _backend = "file";
  return _backend;
}

export function loadConfig() {
  if (!_cfg) _cfg = mergeDefaults(readFile()); // lazy dev fallback if initConfig wasn't called
  return _cfg;
}

export function saveConfig(next) {
  _cfg = mergeDefaults(next);
  if (_backend === "db") persistDb(_cfg).catch(() => {});
  else { ensure(); writeFileSync(configPath, JSON.stringify(_cfg, null, 2)); }
  return _cfg;
}

// Redacted view for the browser — never ship raw/encrypted keys to the client.
export function publicConfig() {
  const cfg = loadConfig();
  const providers = {};
  for (const [id, p] of Object.entries(cfg.providers)) {
    const plain = decryptKey(p.apiKey);
    providers[id] = { label: p.label || id, models: p.models || [], hasKey: Boolean(plain), keyHint: plain ? `…${plain.slice(-4)}` : "" };
  }
  return { providers, pipelines: cfg.pipelines };
}

export function getPipeline(id) { return loadConfig().pipelines[id]; }

export function getApiKey(provider) {
  const env = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY };
  return decryptKey(loadConfig().providers[provider]?.apiKey || "") || env[provider] || "";
}
