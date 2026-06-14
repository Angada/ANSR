// Local JSON config store — API keys (AES-256-GCM encrypted at rest), model
// selection, and the Q&ANSR pipeline registry. Lives in data/config.json
// (gitignored). Adapted from the ESPL store; pipelines are the AI-pipeline
// registry (Leela pattern): each is gated by `enabled` and bound to a provider/
// model/skill set. raw user text is never sent to a model outside a pipeline.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

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
    anthropic: { label: "Anthropic (Claude)", apiKey: "", models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"] },
    openai:    { label: "OpenAI", apiKey: "", models: ["gpt-5.1", "gpt-5.1-mini"] },
  },
  // Q&ANSR AI-pipeline registry. kind: deterministic | llm | hybrid.
  // Only enabled llm/hybrid pipelines may call a provider.
  pipelines: {
    "contract-intake": { id: "contract-intake", name: "Contract Intake", kind: "hybrid",
      description: "Read the SOW → structured rule tables (TA bands, milestone split, OSS slabs) with clause refs.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-contract-intake", "qansr-knowledge-store"], enabled: true },
    "normalize": { id: "normalize", name: "Normalizer", kind: "hybrid",
      description: "Map messy source/role/status/level/date/CTC to canonical values. AI suggests → human confirms → learns.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-normalizer"], enabled: true },
    "calc": { id: "calc", name: "Calc Engine", kind: "deterministic",
      description: "Deterministic TA + OSS + milestone-split computation from the lifecycle ledger. No model call.",
      provider: "", model: "", skills: ["qansr-calc-engine", "qansr-lifecycle-ledger"], enabled: true },
    "assure": { id: "assure", name: "Invoice Assurance", kind: "hybrid",
      description: "Reproduce the Excel workbook, detect variance vs contract calc, flag exceptions.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["qansr-variance", "qansr-invoice-assurance", "qansr-exceptions"], enabled: true },
    "statement": { id: "statement", name: "Statement Generator", kind: "deterministic",
      description: "Generate the monthly Statement of Invoicing (cover / OSS / TA / evidence / exceptions) → xlsx.",
      provider: "", model: "", skills: ["qansr-statement-generator"], enabled: true },
    "clarify": { id: "clarify", name: "AI Clarify", kind: "llm",
      description: "When data is ambiguous, ask a clause/evidence-backed question + recommend an option; persist the decision.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-ai-clarify"], enabled: true },
    "qa": { id: "qa", name: "AR Analyst Q&A", kind: "hybrid",
      description: "Answer 'why is this invoice line X' with evidence + calc trail + clause reference. Deterministic md/db + AI-read.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-knowledge-store"], enabled: true },
  },
};

function ensure() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
}

export function loadConfig() {
  ensure();
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  const providers = { ...DEFAULT_CONFIG.providers };
  for (const [id, p] of Object.entries(cfg.providers || {})) providers[id] = { ...DEFAULT_CONFIG.providers[id], ...p };
  return { ...DEFAULT_CONFIG, ...cfg, providers, pipelines: { ...DEFAULT_CONFIG.pipelines, ...cfg.pipelines } };
}

export function saveConfig(next) { ensure(); writeFileSync(configPath, JSON.stringify(next, null, 2)); return next; }

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
