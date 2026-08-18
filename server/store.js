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

const isProd = () => process.env.NODE_ENV === "production";

function secret() {
  const env = process.env.CONFIG_SECRET;
  if (env) {
    if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error("CONFIG_SECRET must be exactly 64 hex chars (32 bytes).");
    return Buffer.from(env, "hex");
  }
  // In prod the container FS is ephemeral: a file-generated secret is lost on every
  // instance recycle, silently orphaning all Vault (BYOK) keys. Refuse rather than corrupt.
  if (isProd()) throw new Error("CONFIG_SECRET is required in production (Vault keys are encrypted with it).");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(secretPath, "utf8").trim(), "hex");
}

// Fail-fast boot gate: call once at startup so prod misconfig is a loud crash, not a
// first-request-time surprise. Validates the Vault secret and the login credentials.
export function assertSecurity() {
  if (!isProd()) return;
  const env = process.env.CONFIG_SECRET;
  if (!env || !/^[0-9a-fA-F]{64}$/.test(env)) {
    throw new Error("Refusing to boot: CONFIG_SECRET must be set to 64 hex chars in production.");
  }
  const pw = process.env.QANSR_PW;
  if (!pw || pw === "admin") {
    throw new Error("Refusing to boot: QANSR_PW must be set to a non-default value in production.");
  }
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
    openai:    { label: "OpenAI", apiKey: "", models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1", "gpt-4o", "text-embedding-3-small", "text-embedding-3-large"] },
    google:    { label: "Gemini", apiKey: "", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-embedding-001"] },
    zai:       { label: "Z.AI", apiKey: "", models: ["glm-5.1", "glm-5", "glm-4.6", "glm-4.6-air", "glm-4.5", "glm-4.5v", "glm-4.5-x", "glm-4.5-air", "glm-4.5-airx", "glm-4.5-flash", "glm-z1-air", "glm-z1-flash", "glm-z1-rumination", "glm-4-plus", "glm-4-long", "embedding-3", "embedding-2"], baseURL: "https://api.z.ai/api/anthropic" }, // Z.AI's OWN native coding endpoint (api.z.ai host + your Z.AI key), billed via the GLM Coding Plan — NOT an Anthropic shim: nothing touches Anthropic's servers/wallet. This account's balance lives on the Coding Plan, not the paas/v4 pay-as-you-go wallet, which 429s. To use the wallet instead, clear this baseURL (transport falls back to OPENAI_BASE.zai = paas/v4). See the provider rule in CLAUDE.md.
    xai:       { label: "x.AI", apiKey: "", models: ["grok-4", "grok-3", "grok-3-mini"] },
    deepseek:  { label: "DeepSeek", apiKey: "", models: ["deepseek-chat", "deepseek-reasoner"] },
    moonshot:  { label: "Kimi (Moonshot)", apiKey: "", models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"] }, // OpenAI-compatible → OPENAI_BASE in ai.js (no baseURL)
  },
  // Q&ANSR AI-pipeline registry, grouped by product. kind: deterministic | llm | hybrid.
  // Only enabled llm/hybrid pipelines may call a provider. Each carries an editable prompt.
  pipelines: {
    "munshi-ocr": { id: "munshi-ocr", product: "Munshi", name: "OCR (vision) — scanned-PDF fallback", kind: "llm",
      description: "Rasterises a scanned / image-only PDF and transcribes each page to layout Markdown via a vision LLM. Reverse-engineered from DeepSeek-OCR / Unlimited-OCR; runs on the Vault's vision models. Swappable to a self-hosted DeepSeek-OCR endpoint. Gated by the MUNSHI_OCR flag.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi"], enabled: true,
      prompt: "You are an OCR + document-layout engine. Transcribe the page image exactly to clean GitHub-Flavoured Markdown, preserving reading order, headings, lists and tables. Never invent or complete text — transcribe only what is visibly printed." },
    "munshi3:read": { id: "munshi3:read", product: "Munshi", name: "Munshi3 · document vision reader (OCR)", kind: "hybrid",
      description: "Reads image-only / scanned pages and dense tables the text layer flattens. Rasterises each page (poppler) and a VISION model transcribes it to faithful Markdown (tables preserved). Hosted reverse-engineering of DeepSeek-OCR / Unlimited-OCR — no GPU. Runs through whichever vision model is set here (swap freely: glm-4.5v / gemini-2.5-flash / gpt-4o / claude).",
      provider: "zai", model: "glm-4.5v", skills: ["munshi"], enabled: true,
      prompt: "You are Munshi3, the document-vision reader. You are shown ONE rendered page of a document. Transcribe it into clean, faithful GitHub-flavoured Markdown in natural reading order. RULES: (1) Reproduce ALL text exactly — every heading, clause, label, number, amount, percentage, date and range — never summarise, translate, reword, round or omit. (2) Render EVERY table as a Markdown table, preserving all rows, columns and each cell's exact value even when densely packed. (3) Preserve headings (#), lists and field:value pairs. (4) For an illegible stamp, signature or handwriting write [illegible]; leave empty cells blank. (5) Output ONLY the page's Markdown — no commentary." },
    "contra-atomize": { id: "contra-atomize", product: "Contra", name: "Atomize (clause chips)", kind: "hybrid",
      description: "Turns a contract's Markdown into atomic, clause-referenced chips (§ refs) — the clause map the archetype proposal and the holistic review reason over.",
      provider: "zai", model: "glm-5.1", skills: ["munshi"], enabled: true,
      prompt: "Break the contract into atomic clauses. For each, return its § reference (as printed), a short label, and the exact text. STRICT JSON only: {\"clauses\":[{\"ref\":\"§..\",\"label\":\"...\",\"text\":\"...\"}]}. Never invent or renumber references — use what the document prints." },
    "contra-rules": { id: "contra-rules", product: "Contra", name: "Rule Suggest", kind: "llm",
      description: "Reads the sample contract's actual terms and pre-fills candidate review rules per section (e.g. 'liability cap ≤ 12 months fees') plus a required/optional recommendation. The reviewer confirms or edits before saving.",
      provider: "zai", model: "glm-5.1", skills: ["munshi", "atlas"], enabled: true,
      prompt: "For each proposed review section, read the sample contract's actual terms and suggest 0-2 plain-English review rules a reviewer would enforce for this contract TYPE, plus whether the section should be required. STRICT JSON only: {\"sections\":[{\"key\":\"...\",\"required\":true|false,\"rules\":[\"short rule\"]}]}. Base rules on what's actually in the sample; keep them short and testable." },
    "contra-archetype": { id: "contra-archetype", product: "Contra", name: "Archetype Maker", kind: "llm",
      description: "From a sample contract, proposes the important review SECTIONS for that contract TYPE (holistic, not clause-by-clause). The reviewer confirms/amends and tags each Required; the confirmed set is saved as a review archetype.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi", "atlas"], enabled: true,
      prompt: "You are a contract-review architect. From the sample contract, propose the important SECTIONS a reviewer must check for this TYPE of contract — thematic areas (particulars, parties, commercial terms, liability, indemnity, term & termination, governing law…), NOT a clause-by-clause list. Return STRICT JSON only: {\"name\":\"suggested archetype name\",\"sections\":[{\"key\":\"snake_case\",\"label\":\"Human label\",\"what_to_check\":\"what a reviewer verifies here\",\"required\":true|false}]}. Order them the way a reviewer reads them. Mark the genuinely important ones required." },
    "contra-detect": { id: "contra-detect", product: "Contra", name: "Archetype Detect", kind: "hybrid",
      description: "Fingerprints an uploaded contract and matches it to the best saved archetype (Contra-owned signature match, LLM-assisted). Returns a confidence; below threshold → 'no match, make an archetype'.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["atlas", "munshi"], enabled: true,
      prompt: "Given a contract's section signature and a list of saved archetypes, return the best match. STRICT JSON only: {\"archetype_id\":<id>|null,\"confidence\":0-1,\"why\":\"one line\"}. Return null if none genuinely fits." },
    "contra-review": { id: "contra-review", product: "Contra", name: "Contract Review", kind: "hybrid",
      description: "Reviews a WHOLE contract against an archetype: a verdict per required section (present/non_standard/risky/missing) with § evidence, PLUS a whole-contract pass for cross-cutting findings — contradictions, off-archetype significant clauses, commercial terms, unresolved references. Proposes, never asserts.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi", "atlas", "bigflex"], enabled: true,
      prompt: "Review the whole contract against the provided review outline. Use ONLY the section keys given in the outline — do not invent your own. Return STRICT JSON only: {\"summary\":\"2-3 sentence executive summary\",\"verdicts\":[{\"key\":\"<one of the provided section keys>\",\"verdict\":\"present|non_standard|risky|missing\",\"evidence_refs\":[\"§..\"],\"note\":\"one line\"}],\"rule_checks\":[{\"rule\":\"<the exact rule text>\",\"section_key\":\"<key or whole-contract>\",\"result\":\"pass|check|breach\",\"note\":\"why\",\"refs\":[\"§..\"]}],\"findings\":[{\"kind\":\"contradiction|off_archetype|commercial|unresolved_ref\",\"severity\":\"low|med|high\",\"note\":\"...\",\"refs\":[\"§..\"]}]}. Emit a verdict for EVERY provided section (by its key). Emit a rule_check for EVERY rule provided — section rules AND whole-contract rules — with pass/check/breach and the § evidence. THEN a whole-contract pass for cross-cutting findings: contradictions (same term stated two ways), off-archetype significant clauses, commercial issues, unresolved cross-references. Never assert a contradiction as fact — flag it. Cite the § for every claim." },
    "contra-ask": { id: "contra-ask", product: "Contra", name: "Ask Contract", kind: "hybrid",
      description: "Grounded per-box / whole-contract chat during review. Answers cite the actual clause § (combining several §§ when they interact), and can turn an answer into a document comment.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi", "qansr-knowledge-store"], enabled: true,
      prompt: "Answer a reviewer's question about this contract. Ground every claim in the actual clauses; cite the § — or combine several §§ when they interact. Propose, never assert; flag anything that needs human verification. Keep it tight and practical." },
    "contra-clause-label": { id: "contra-clause-label", product: "Contra", name: "Clause Labeller", kind: "llm",
      description: "Labels each cited clause (§) with a 2-4 word topic (Indemnity · Payment terms · Governing law…) so the legal-report clause chips say what each clause is about. Cached on the review.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["contra"], enabled: true,
      prompt: "For each clause reference, give a 2-4 word topic label of what that clause covers, based on the contract. STRICT JSON {\"labels\":{\"§3.2\":\"Indemnity\"}}." },
    // ---- Q-Legal — legal-repository intelligence (SharePoint = source of truth) ----
    // The layered read: C1 (comprehensive) → C2 (concise key + contents/clause wikis)
    // → Registers (whatever the team asks) → Ask (the retrieval ladder over all three).
    // ---- Bellwether — hiring signal as a buying signal --------------------
    // The original pipeline was seven stages of Python with its judgement
    // hardcoded: a keyword list decided what a "frontline role" was, marker
    // regexes decided which ATS a site used, and nothing explained itself. Each
    // stage that involves a JUDGEMENT is a registered pipeline here; the stages
    // that are pure fetching stay deterministic, because a model adds nothing to
    // an HTTP GET and would only add cost and doubt.
    "bw-resolve": { id: "bw-resolve", product: "Bellwether", name: "1 · Resolve the careers platform", kind: "hybrid",
      description: "Given a company website, work out which ATS it runs (Greenhouse, Lever, Workday…) and the board slug. Deterministic markers first — they are free and certain; the model is asked only when the markers disagree or find nothing, which is where the original silently gave up and dropped the company.",
      provider: "zai", model: "glm-5.1", skills: ["bellwether"], enabled: true,
      prompt: "From the page content, identify the applicant-tracking system this company uses and its board identifier. STRICT JSON only: {\"platform\":\"greenhouse|lever|workday|ashby|smartrecruiters|workable|icims|jazzhr|taleo|cornerstone|eightfold|ultipro|other|none\",\"slug\":\"\",\"careers_url\":\"\",\"confidence\":0-1,\"why\":\"one line\"}. Return none rather than guessing — a wrong platform wastes a paid fetch." },
    "bw-classify": { id: "bw-classify", product: "Bellwether", name: "3 · Classify the role", kind: "llm",
      description: "Decide whether a posting is the kind of role being watched. Replaces a hardcoded keyword list that could not tell 'General Manager, Restaurant' from 'General Manager, Corporate Strategy' and matched both. Judges the posting, and says WHICH criterion it met so the count is explainable.",
      provider: "zai", model: "glm-5.1", skills: ["bellwether"], enabled: true,
      prompt: "Given the watched role definitions and a job posting, decide whether the posting is one of them. STRICT JSON only: {\"match\":true|false,\"role\":\"the matched role, or \\\"\\\"\",\"seniority\":\"frontline|manager|director|exec\",\"confidence\":0-1,\"why\":\"one line\"}. Judge the ACTUAL job, not the words in its title — a title can flatter a role or bury it." },
    "bw-normalize": { id: "bw-normalize", product: "Bellwether", name: "4 · Normalise for dedup", kind: "hybrid",
      description: "The same vacancy appears at once on Greenhouse, LinkedIn and Indeed with three different titles and three location formats. Normalises title, location and employment type into a stable fingerprint so one job is counted once. Deterministic rules first; the model resolves only the pairs the rules cannot.",
      provider: "zai", model: "glm-5.1", skills: ["bellwether"], enabled: true,
      prompt: "Are these two postings the SAME vacancy re-listed, or two different roles? STRICT JSON only: {\"same\":true|false,\"confidence\":0-1,\"why\":\"one line\"}. Two openings for the same title at the same site are DIFFERENT vacancies; the same opening syndicated to another board is the SAME one." },
    "bw-signal": { id: "bw-signal", product: "Bellwether", name: "5 · Read the signal", kind: "llm",
      description: "Turns counts into meaning. Twelve open store-manager roles is a number; twelve where there were two last month, concentrated in one region, is an expansion — and that is the thing worth acting on. Reads the trailing series, not a single sweep.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["bellwether", "atlas"], enabled: true,
      prompt: "Given a company's hiring history over time, say what it indicates. STRICT JSON only: {\"signal\":\"expanding|steady|contracting|unclear\",\"strength\":0-1,\"what_changed\":\"one line\",\"evidence\":[\"the specific counts or roles that show it\"],\"timing\":\"why now, or \\\"\\\"\"}. Base it ONLY on the counts given. Say unclear when the series is too short — a trend needs more than two points." },
    "bw-brief": { id: "bw-brief", product: "Bellwether", name: "6 · Write the opportunity brief", kind: "llm",
      description: "The human-facing output: what this company appears to be doing, why now, and what it implies — with the postings cited. Proposes, never asserts. A hiring pattern is evidence of intent, not proof of it, and a brief that forgets the difference gets someone laughed out of a meeting.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["bellwether"], enabled: true,
      prompt: "Write a short brief on what this company's hiring suggests. Ground every claim in the postings given and cite them. STRICT JSON only: {\"headline\":\"one line\",\"what\":\"2-3 sentences\",\"why_now\":\"one line\",\"evidence\":[{\"posting\":\"title\",\"point\":\"what it shows\"}],\"caveats\":[\"what would make this reading wrong\"]}. Hiring is evidence of intent, never proof — write it that way." },
    "bw-ask": { id: "bw-ask", product: "Bellwether", name: "7 · Ask the market", kind: "hybrid",
      description: "Grounded questions across every company watched — 'who started hiring warehouse staff this quarter', 'which of our targets are opening in the south'. Answers from the stored postings and signals, citing companies and roles, never from memory of the market.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["bellwether", "qansr-knowledge-store"], enabled: true,
      prompt: "Answer from the hiring data provided and nothing else. Name the companies and cite the postings behind every claim. If the data does not cover the question, say so plainly rather than generalising about the market." },
    "bw-embed": { id: "bw-embed", product: "Bellwether", name: "Vector Embeddings · role & company", kind: "hybrid",
      description: "Embeds each posting and each company's hiring profile, so roles can be found by meaning rather than keyword and companies clustered by what they are actually building. EMBEDDING MODELS ONLY — a chat model cannot embed.",
      provider: "openai", model: "text-embedding-3-small", skills: ["bellwether"], enabled: true, prompt: "" },
    "qlegal-c1": { id: "qlegal-c1", product: "Q-Legal", name: "Comprehensive Read (C1) · Munshi", kind: "hybrid",
      description: "The deep substrate. Reads the whole file into a faithful transcript — every clause, table and field. Born-digital files use the exact text layer (free, lossless); scanned / image-only pages route to the Munshi vision reader (`munshi3:read`), which preserves tables and transcribes what the text layer flattens. Nothing above it ever re-reads the original; C1 is the deep-read rung of the Ask ladder.",
      provider: "zai", model: "glm-4.5v", skills: ["munshi", "qansr-knowledge-store"], enabled: true,
      prompt: "Transcribe the document faithfully and completely — every heading, clause, number, date, amount and table cell, in reading order. Render tables as Markdown tables. Describe any figure, stamp, seal or signature block that carries meaning. Never summarise, reword or omit; transcribe only what is actually there." },
    "qlegal-atomize": { id: "qlegal-atomize", product: "Q-Legal", name: "Atomize (clause chips) · Canon", kind: "hybrid",
      description: "The clause layer, in two halves. DETERMINISTIC: the § reference, the verbatim text, the nesting and the cross-references between clauses are read from the contract itself — no model, so no truncation and no renumbering, whatever the document's length. INTELLIGENCE: this pipeline adds a 2-4 word topic and a one-line gist per clause, in small batches so a 300-clause agreement cannot lose its last clause to a token limit. The result is the clause wiki, the § anchors Ask cites, and the edges Ask walks ('unless terminated per Section 15').",
      provider: "zai", model: "glm-5.1", skills: ["munshi", "contra"], enabled: true,
      prompt: "For each clause given, return a 2-4 word topic label and a one-line gist of what it actually does. Use the § reference EXACTLY as supplied — never renumber, never invent, never merge clauses. STRICT JSON only: {\"clauses\":[{\"ref\":\"§..\",\"label\":\"Payment terms\",\"gist\":\"one line\"}]}. Return one entry for every clause supplied, in the same order. Describe only what the clause states." },
    "qlegal-register": { id: "qlegal-register", product: "Q-Legal", name: "Registers (standing questions)", kind: "llm",
      description: "The open-ended extraction layer — 'C2 you define'. The legal team writes a standing question once in plain English ('does this require notice on a change of control, and in how many days?') and it is answered for EVERY contract at ingestion and backfilled across the estate, with § evidence. That is what makes an infinite set of lawyer questions answerable over 1000 documents without re-reading them. All active registers are answered in one call per document.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi", "qansr-knowledge-store"], enabled: true,
      prompt: "You are indexing a contract against the legal team's standing questions. Answer each one for THIS contract only, from its actual text, citing the § for every 'yes'. Say 'no' when the contract genuinely does not deal with it, 'unclear' when the text is ambiguous — never guess a 'yes'. Keep each answer to one useful line, and pull out the specific number or term asked for." },
    "qlegal-key": { id: "qlegal-key", product: "Q-Legal", name: "Concise Key (C2) · facts + contents & clause wikis", kind: "llm",
      description: "Reads C1 and produces the concise key every query runs on first: title, type, parties, dates, governing law, value, auto-renewal, controlled-vocabulary tags, the notice register (notice clauses, contacts, change-of-control) — plus the two wikis every document gets: the CONTENTS wiki (its own structure, so you can navigate without re-reading) and the CLAUSE wiki (every § with its topic and gist). Ingestion business rules are injected at call time.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["munshi", "qansr-knowledge-store"], enabled: true,
      prompt: "You are a legal-repository analyst reading one contract to index it. Extract only what the document states — never infer or invent. Empty string when not stated. Use the § references exactly as the document prints them." },
    "qlegal-obligations": { id: "qlegal-obligations", product: "Q-Legal", name: "Obligation Mapper", kind: "llm",
      description: "Maps each contract's dated lifecycle obligations (expiry, renewal windows, termination-notice deadlines) and post-execution deliverables/SLAs (reports, certificates, insurance, audits) into the obligations register — each with who owes it, frequency, due date and the § citation. A human assigns the doer.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["munshi"], enabled: true,
      prompt: "Extract the obligations a legal/ops team must track from this contract. Only what the contract actually states, each with its § reference. Dates as YYYY-MM-DD when printed, empty otherwise." },
    "qlegal-link": { id: "qlegal-link", product: "Q-Legal", name: "Doc-Tree Linker", kind: "llm",
      description: "Proposes a document's parent in the estate tree (SOW → MSA, Amendment → SOW) from tell-tales the document itself contains ('pursuant to the MSA dated…', matching party pairs). Proposals land in the confirm queue — a human always confirms; never silently linked.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["atlas"], enabled: true,
      prompt: "Given one document and a candidate list, find its governing/parent document ONLY when the document itself references it (by name, date, or parties). Return null when there is no explicit tell-tale — topic similarity alone is never enough." },
    "qlegal-diff": { id: "qlegal-diff", product: "Q-Legal", name: "Version Diff", kind: "llm",
      description: "Summarises what actually changed between two versions of the same contract ('liability cap 12mo → 24mo · §7.2') for the wiki's version rail. Only real changes, each with its §.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: [], enabled: true,
      prompt: "Compare two versions of the same contract and report only genuine differences, each on one short line with the § reference. Never invent a change." },
    "qlegal-draft": { id: "qlegal-draft", product: "Q-Legal", name: "Drafting (models \u2192 draft 1)", kind: "llm",
      description: "The drafting bookend. The lawyer describes the contract they need; the repo SUGGESTS suitable model contracts to base it on (ranked, with why); the lawyer selects up to 3; draft 1 comes out structurally COMPLETE \u2014 the models' contents wikis define the skeleton and standard positions (definitions, notices, severability appear because the models have them, not because someone remembered), the ask supplies the particulars, gaps become [BRACKETED PLACEHOLDERS]. Downloads as .docx and goes through the normal Word/SharePoint process.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["contra-archetype", "qansr-knowledge-store"], enabled: true,
      prompt: "You are the legal team's drafting assistant. Model contracts define structure and standard positions; the ask defines particulars. Draft complete, precise, in the house voice \u2014 never invent facts, bracket what is unknown." },
    "qlegal-embed": { id: "qlegal-embed", product: "Q-Legal", name: "Vector Embeddings · the semantic spine", kind: "hybrid",
      description: "Embeds every contract at three granularities — document (C2 summary: families, dedup, the estate map), section (contents-wiki headings), clause (every § with its gist) — into pgvector, each row carrying its § anchor and the model that wrote it. Retrieval is hybrid ALWAYS (facts + FTS + vector, rank-fused) and a vector hit is only ever a pointer to a real §. Swap the model here and the Re-index embed sweep re-embeds the estate; with no key it runs a deterministic hashed embedding (hash:v1) so nothing blocks. EMBEDDING MODELS ONLY — a chat model cannot embed, and **Anthropic/Claude has no embeddings endpoint at all** (its API is Messages/Batches/Files/Token-counting/Models), so this step cannot run on Claude however good the key is. Working options: OpenAI text-embedding-3-small/large, Google gemini-embedding-001, or a Z.AI embedding model. Anything else silently falls back to hash:v1 — Re-index shows it as 'degraded'.",
      provider: "zai", model: "embedding-3", skills: ["qlegal", "atlas"], enabled: true, prompt: "" },
    "qlegal-ask": { id: "qlegal-ask", product: "Q-Legal", name: "Ask the Repository", kind: "hybrid",
      description: "Natural-language answers over the whole estate, via the RETRIEVAL LADDER — rung 1: C2 facts + register answers (structured, covers every contract, so 'which of our contracts…' is answered without reading them); rung 2: the contents & clause wikis of the matching documents; rung 3: the C1 deep text of the closest few; rung 4: the original, cited as the authority but never read by the model. Every claim cites document + §; says what's missing (and suggests a new standing register question) rather than guessing.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["qansr-knowledge-store", "munshi"], enabled: true,
      prompt: "You are the legal repository's analyst. Answer only from the provided repository context. Cite the document name and § for every claim. If the context cannot answer, say exactly what is missing — never guess." },

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

    // ---- RayDar — Talent Trend Radar: demand↔supply content intelligence ----
    // Hunger (demand) → Feed collection → Classify → Gap → Rank → Idea + validate.
    "clientmind-parse": { id: "clientmind-parse", product: "RayDar", name: "TalentMind Parse", kind: "hybrid",
      description: "Read a talent's whole corpus (CV, letters, history, notes) → a master profile + rich 'chips' (skills, interests, behaviours, aspirations, career patterns, motivations). Munshi method — re-parse on change, weekly refresh.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar", "talentmind", "munshi"], enabled: true,
      prompt: "You read a talent (job seeker)'s documents and history. Return STRICT JSON {\"master_md\":\"...\",\"chips\":[{\"kind\":\"skill|interest|behaviour|aspiration|career_pattern|motivation|domain|tenure\",\"value\":\"short label\",\"weight\":0-1}]}. Be detailed and specific; never invent facts — only what the docs support." },
    "cohort-nl-query": { id: "cohort-nl-query", product: "RayDar", name: "TalentMind Cohort Query", kind: "llm",
      description: "Turn a natural-language cohort description ('job seekers only, never stayed >2 years anywhere') into a structured filter over talent meta + chips.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["raydar", "talentmind"], enabled: true,
      prompt: "Convert the natural-language cohort query into STRICT JSON filter rules over talent fields (meta.years_exp, meta.domain, meta.tenure[], chips[].value). Return {\"rules\":[{\"field\":\"...\",\"op\":\"...\",\"value\":...}], \"explain\":\"...\"}. Flag ambiguity, don't guess." },
    "hunger-generate": { id: "hunger-generate", product: "RayDar", name: "Hunger Story", kind: "llm",
      description: "Step 1 (Hunger). Fuse the chosen routes — Trend Spotting chips, pasted SEO inputs, and/or a TalentMind cohort — into a Hunt Outcome: who they are, what they care about, likely searches, motivations, emotional drivers, and the Demand Topics for this batch.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true,
      prompt: "From the batch's routes (trend chips + SEO text + cohort chips), write a warm, specific Hunt Outcome. Return STRICT JSON {\"who\":\"...\",\"cares_about\":[\"...\"],\"likely_searches\":[\"...\"],\"motivations\":[\"...\"],\"emotional_drivers\":[\"...\"],\"demand_topics\":[\"...\"]}." },
    "raydar-terms": { id: "raydar-terms", product: "RayDar", name: "Suggest Search Terms", kind: "llm",
      description: "Concept-editor helper. Proposes high-intent YouTube/Reddit search terms for a demand concept — the human confirms/edits before saving (terms stay deterministic config, this just removes the blank page).",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true,
      prompt: "Propose short, high-intent search terms a job seeker would actually type, for the given demand concept, in the audience's language. Return STRICT JSON {\"terms\":[\"...\"]}." },
    "trend-detect": { id: "trend-detect", product: "RayDar", name: "Feed Collection & Trend Detection", kind: "hybrid",
      description: "Pull the feed (YouTube + comments, Reddit + comment trees, Trends, News) per each integration's business rules, then surface emerging topics, viral conversations and opportunity signals against the demand topics.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["raydar"], enabled: true,
      prompt: "Given feed items, surface the strongest emerging trends relevant to the demand topics. Return STRICT JSON {\"trends\":[{\"title\":\"...\",\"signal\":\"...\",\"why_trending\":\"...\"}]}." },
    "raydar-classify": { id: "raydar-classify", product: "RayDar", name: "Item Classify", kind: "hybrid",
      description: "Sub-pipeline. Classify each collected item → demand topic (1–6 / Emerging), 1Up franchise, 4-register distribution (FOMO · Anxiety · Optimism · Ambition), and the underlying question. Hash-cached so a repeated item is never re-billed.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["raydar"], enabled: true,
      prompt: "Classify one feed item. Return STRICT JSON {\"topic\":\"1..6|Emerging\",\"franchise\":\"...\",\"registers\":{\"FOMO\":0-1,\"Anxiety\":0-1,\"Optimism\":0-1,\"Ambition\":0-1},\"question\":\"the underlying question in the talent's head\"}. Comments/comment-trees carry the real feeling — weight them." },
    "raydar-gap": { id: "raydar-gap", product: "RayDar", name: "Gap Analysis", kind: "deterministic",
      description: "Sub-pipeline. Compare demand (what the cohort hungers for) against supply (what the feed already covers) per topic × franchise → a gap score. Pure math, no model call.",
      provider: "anthropic", model: "", skills: ["raydar"], enabled: true, prompt: "" },
    "raydar-rank": { id: "raydar-rank", product: "RayDar", name: "Composite Ranking", kind: "deterministic",
      description: "Sub-pipeline. Rank ideas by 0.35·gap + 0.25·velocity + 0.20·strategic weight + 0.20·historical (Used feedback per franchise). Deterministic — the score breakdown is shown on every idea.",
      provider: "anthropic", model: "", skills: ["raydar"], enabled: true, prompt: "" },
    "raydar-contradiction": { id: "raydar-contradiction", product: "RayDar", name: "Contradiction & Evidence", kind: "llm",
      description: "Sub-pipeline. Validate a candidate idea against research (Tavily/Serper/Perplexity) — attach cited evidence and flag claims that conflict with the feed before it reaches review.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["raydar"], enabled: true,
      prompt: "Given an idea and research results, return STRICT JSON {\"evidence\":[{\"claim\":\"...\",\"source\":\"url\"}],\"contradictions\":[{\"claim\":\"...\",\"conflict\":\"...\"}]}. Only cite what the sources support." },
    "feedstory-generate": { id: "feedstory-generate", product: "RayDar", name: "Idea Generation", kind: "llm",
      description: "Turn a matched (demand × trend) into a content idea: a HEADING + a TOPIC GUIDE (brief) routed to a 1Up franchise — never finished content. Classified + justified.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true, json: true, temperature: 0.6, // JSON output but needs creative justifications — mid temperature keeps variety without breaking the JSON
      prompt: "Produce a content idea as STRICT JSON {\"title\":\"a short, punchy, SEO-optimized title, <=60 chars, no clickbait\",\"heading\":\"the full headline / hook for the piece\",\"summary\":\"...\",\"topic_guide\":{\"take\":\"...\",\"beats\":[\"...\"],\"proof\":[\"...\"]},\"why_now\":\"...\",\"why_relevant\":\"...\",\"why_cohort\":\"...\",\"one_up\":\"...\",\"emotional_framework\":\"...\",\"emotional_register\":\"a SHORT label only, e.g. Anxiety / FOMO / Optimism / Ambition — never a sentence\"}. 'title' and 'heading' are the key deliverables: title is the tight optimized title, heading is the fuller headline. The output is a title + headline + brief for a writer — do NOT write the finished piece. Be scientific AND creative in the justifications." },

    "raydar-story-outline": { id: "raydar-story-outline", product: "RayDar", name: "Detailed Story Outline", kind: "llm",
      description: "The deep version of an idea. Takes the heading, the REAL audience comments collected for that theme, and the storyline of the video that is already winning attention, and returns a concrete section-by-section outline a writer can work straight from — plus the evidence for every claim, quoted from the comments. Generated on demand, one call per idea, then stored.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true,
      prompt: "You are briefing a writer on ONE piece. You are given the idea, the REAL comments the audience left on this subject, and the storyline of the video currently winning attention on it. Return STRICT JSON {\"premise\":\"one sentence — the argument the piece makes, not the topic it covers\",\"reader\":\"who is reading and what they are feeling when they arrive\",\"why_this_wins\":\"what the winning video does well AND what it leaves unanswered — the opening this piece takes\",\"sections\":[{\"heading\":\"section title\",\"covers\":\"what it says, concretely\",\"evidence\":\"the comment or data point that justifies it — quote the comment verbatim where you have one\"}],\"proof_needed\":[\"a specific number, example or source the writer must go and get\"],\"objections\":[\"what a sceptical reader will push back with, and the answer\"],\"close\":\"how it ends and what the reader does next\",\"evidence_summary\":\"one paragraph: why this story, grounded in what the comments actually said\"}. RULES: every section must trace to a real comment or a supplied fact — if you cannot ground a section, leave it out rather than inventing it. Quote comments verbatim, do not paraphrase them into blandness. 5-7 sections. This is a brief for a human writer, never the finished piece." },
    "raydar-theme-compile": { id: "raydar-theme-compile", product: "RayDar", name: "Theme Compiler", kind: "llm",
      description: "The content team DESCRIBES a theme in their own words ('resume tips and fixes — framing over content') and this compiles those words into the logic the pipelines actually run on: the search terms fired at YouTube/Reddit, the 1Up sub-series it routes to, the emotional registers it usually carries, and what counts as on- or off-theme. Words in, logic out — and the human confirms every field before it saves, so the config stays theirs.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true,
      prompt: "You compile a content theme description into operational search logic for an Indian job-seeker / GCC-talent audience. Return STRICT JSON {\"terms\":[\"6-10 short, high-intent phrases a job seeker would actually TYPE into YouTube or Reddit — not marketing phrasing\"],\"franchise\":\"the sub-series this routes to\",\"question\":\"the one question in the candidate's head, in their voice\",\"registers\":[\"which of FOMO / Anxiety / Optimism / Ambition this theme usually carries\"],\"on_theme\":[\"signals that an item genuinely belongs to this theme\"],\"off_theme\":[\"look-alike subjects that must NOT be collected under it\"],\"why\":\"one plain sentence on how you read the description\"}. Derive everything from the description given — do not import assumptions from other themes. Keep terms in India-English, lower case, 2-6 words." },

    // ---- RayDar JOURNEY — the high-involvement lane (stations 03/04/06) ----
    // The express sweep is untouched; these three power the gated journey only.
    "raydar-dump": { id: "raydar-dump", product: "RayDar", name: "Research Dump Reader", kind: "hybrid",
      description: "Station 03. RayDar does NOT do keyword research — SEO dumps the research they already produced (Ahrefs/Semrush/GSC/SERP exports, PAA lists, PDF audits) and this reads it. Munshi method: a recognised export shape is parsed deterministically and never billed again; only a NEW shape costs a model call, and what it learns is written back as a reusable shape.",
      provider: "anthropic", model: "claude-sonnet-4-6", skills: ["raydar", "munshi"], enabled: true,
      prompt: "You are reading a research export whose layout you do not recognise. Identify which column holds which field and return STRICT JSON {\"shape\":{\"label\":\"short name for this export format\",\"colmap\":{\"keyword\":\"<header>\",\"volume\":\"<header>\",\"kd\":\"<header>\",\"intent\":\"<header>\",\"position\":\"<header>\",\"url\":\"<header>\"}},\"rows\":[{\"keyword\":\"...\",\"volume\":0,\"kd\":0,\"intent\":\"...\",\"position\":0,\"url\":\"...\"}],\"questions\":[\"any People-Also-Ask / question rows\"],\"confidence\":0-1}. Omit fields the export does not contain — never invent a volume or a difficulty score. If you cannot tell what a column is, leave it out and lower the confidence." },
    "raydar-brief": { id: "raydar-brief", product: "RayDar", name: "SEO Brief Builder", kind: "llm",
      description: "Station 04. Assembles the brief the Content team actually receives — primary/secondary keywords, FAQs, People-Also-Ask, AI-Overview opportunities, related searches, competitor gaps, metadata and must-cover points. Built FROM the dumped research plus the feed signal; it does not go and research on its own. Sibling of Idea Generation, so the express sweep's output is untouched.",
      provider: "anthropic", model: "claude-opus-4-8", skills: ["raydar"], enabled: true,
      prompt: "Assemble a content brief for a writer from the supplied research dump + feed signal. Return STRICT JSON {\"primary_keyword\":\"...\",\"secondary_keywords\":[\"...\"],\"search_intent\":\"informational|commercial|navigational|transactional\",\"faqs\":[\"...\"],\"paa\":[\"...\"],\"ai_overview\":\"the angle most likely to be pulled into an AI Overview, or null\",\"related_searches\":[\"...\"],\"competitor_gaps\":[\"...\"],\"must_cover\":[\"...\"],\"metadata\":{\"title\":\"<=60 chars\",\"description\":\"<=155 chars\",\"slug\":\"...\"},\"internal_links\":[\"...\"]}. Ground every keyword and number in the supplied dump — if the dump does not contain volumes, omit them rather than estimating. This is a brief for a human writer, never the finished piece." },
    "raydar-performance": { id: "raydar-performance", product: "RayDar", name: "Published Performance Loop", kind: "deterministic",
      description: "Station 06. Reads what a published piece actually did (clicks/impressions/position from the own-content index, GSC when connected) and feeds it back into the historical term of Composite Ranking. No model call — this is the loop that makes the ranking learn instead of just claiming to.",
      provider: "", model: "", skills: ["raydar"], enabled: true, prompt: "" },
  },
  // API-key integrations (RayDar). Feed/supply, research, validation. Google
  // stays OAuth (separate). Keys stored AES-encrypted alongside provider keys.
  integrations: {},
};

// Catalog of key-based integrations (code-defined, like provider model lists).
// auth: "key" (single secret) | "pair" (id:secret, e.g. Reddit). test: a light
// endpoint to validate the key (best-effort).
export const INTEGRATION_CATALOG = {
  // Feed / supply
  youtube:    { label: "YouTube Data API", category: "Feed & supply", apps: ["RayDar"], auth: "key", hint: "Google Cloud API key (YouTube Data API v3)", icon: "▶️" },
  reddit:     { label: "Reddit", category: "Feed & supply", apps: ["RayDar"], auth: "pair", hint: "app client_id:client_secret", icon: "👽" },
  newsapi:    { label: "News (NewsAPI / GNews)", category: "Feed & supply", apps: ["RayDar"], auth: "key", hint: "NewsAPI.org or GNews key", icon: "📰" },
  serpapi:    { label: "SerpApi (Trends/News)", category: "Feed & supply", apps: ["RayDar"], auth: "key", hint: "Google Trends + news via SerpApi", icon: "📈" },
  // Research / search
  perplexity: { label: "Perplexity", category: "Research & search", apps: ["RayDar"], auth: "key", hint: "pplx-… API key", icon: "🔎" },
  tavily:     { label: "Tavily", category: "Research & search", apps: ["RayDar"], auth: "key", hint: "tvly-… search API key", icon: "🧭" },
  serper:     { label: "Serper", category: "Research & search", apps: ["RayDar"], auth: "key", hint: "Google SERP API key", icon: "🔍" },
  exa:        { label: "Exa", category: "Research & search", apps: ["RayDar"], auth: "key", hint: "neural search key", icon: "✴️" },
  brave:      { label: "Brave Search", category: "Research & search", apps: ["RayDar"], auth: "key", hint: "Brave Search API key", icon: "🦁" },
  // Validation / fact
  factcheck:  { label: "Google Fact Check", category: "Validation", apps: ["RayDar"], auth: "key", hint: "Fact Check Tools API key", icon: "✅" },
  wikidata:   { label: "Wikidata / Wikipedia", category: "Validation", apps: ["RayDar"], auth: "none", hint: "public — no key needed", icon: "📚" },
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
  for (const [id, p] of Object.entries(cfg.providers || {})) providers[id] = { ...DEFAULT_CONFIG.providers[id], ...p, models: DEFAULT_CONFIG.providers[id]?.models || p.models, baseURL: DEFAULT_CONFIG.providers[id]?.baseURL }; // baseURL is code-defined (never persisted-override) — so endpoint changes take effect
  const pipelines = { ...DEFAULT_CONFIG.pipelines };
  for (const [id, p] of Object.entries(cfg.pipelines || {})) {
    const d = DEFAULT_CONFIG.pipelines[id] || {};
    // user keeps runtime choices (provider/model/enabled/prompt); code-defined
    // descriptive fields (name/description/skills/kind) always take the latest
    // from DEFAULT so registry edits propagate over a saved config.
    // temperature/json/maxTokens are tuning knobs owned by code (like name/skills),
    // so registry-level tuning always takes the latest default over a saved config.
    pipelines[id] = { ...d, ...p, product: d.product ?? p.product, name: d.name ?? p.name, description: d.description ?? p.description, skills: d.skills ?? p.skills, kind: d.kind ?? p.kind, temperature: d.temperature ?? p.temperature, json: d.json ?? p.json, maxTokens: d.maxTokens ?? p.maxTokens };
  }
  return { ...DEFAULT_CONFIG, ...cfg, providers, pipelines, integrations: { ...(cfg.integrations || {}) } };
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

// ---- RayDar key-based integrations ------------------------------------------
export function publicIntegrations() {
  const saved = loadConfig().integrations || {};
  const out = {};
  for (const [id, meta] of Object.entries(INTEGRATION_CATALOG)) {
    const s = saved[id] || {};
    const plain = decryptKey(s.apiKey || "");
    out[id] = { ...meta, id, hasKey: meta.auth === "none" || Boolean(plain), keyHint: plain ? `…${plain.slice(-4)}` : "", enabled: meta.auth === "none" ? true : !!s.enabled };
  }
  return out;
}
export function getIntegrationKey(id) { return decryptKey(loadConfig().integrations?.[id]?.apiKey || ""); }
export function setIntegration(id, { apiKey, enabled } = {}) {
  if (!INTEGRATION_CATALOG[id]) return null;
  const cfg = loadConfig();
  const cur = cfg.integrations?.[id] || {};
  cfg.integrations = { ...(cfg.integrations || {}), [id]: { ...cur, ...(apiKey !== undefined ? { apiKey: apiKey ? encryptKey(apiKey) : "" } : {}), ...(enabled !== undefined ? { enabled: !!enabled } : {}) } };
  saveConfig(cfg);
  return publicIntegrations()[id];
}
