// Q-Legal — legal-repository intelligence. SharePoint (or upload) is the source
// of truth; this module builds the derived layer: per-version C1 (full transcript)
// + C2 (concise key), the registry, doc tree, obligations, global search + Ask,
// the confirm queue, editable business rules, and the learning-loop feedback store.
// Every AI step is a named gated pipeline (qlegal-*) with scope-matched business
// rules injected at call time; every call is logged append-only to ql_log.
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { q } from "./db/client.js";
import { extractFile, toMarkdown } from "./extract.js";
import { putOriginal, putExtract, getExtract, getOriginal, removeOriginal } from "./storage.js";
import { runPipeline } from "./ai.js";
import { loadConfig, getApiKey } from "./store.js";
import { getSyncRow, saveSyncConfig, publicSyncConfig, testSharePoint, scanSharePoint, scheduleNightlyScan, listSharePoint, ingestSharePointItem } from "./qlegal-sync.js";
import { embedVersion, searchVectors, nearestDocs, embedStatus, embedSweep, clauseLibrary, estateMap, docCoverage, embedHealth } from "./qlegal-vectors.js";
import { mountJobs } from "./jobs.js";
import { atomize, clauseWiki, clauseEdges, clausesWithRefs, clauseIndex, estateWiki, verifyCitations } from "./qlegal-clauses.js";

const TENANT = "Q-LEGAL"; // ring-fenced storage namespace (vault + docstore)
// business-rule scopes → which pipeline step each rule set is injected into
const SCOPES = ["global", "ingestion", "registers", "search", "obligations", "drafting", "vectors", "sync"];

// The identity of a proposal: kind + the value proposed. A rejection is remembered
// against this, so the same suggestion is never re-made — while a DIFFERENT parent
// or a different category stays a fair question to ask.
const proposalKey = (kind, p = {}) =>
  kind === "classification" ? `classification:${String(p.doc_type || "").toLowerCase()}`
  : kind === "link" ? `link:${p.parent_id}`
  : kind === "lineage" ? `lineage:${p.other_id}`
  : kind === "removal" ? "removal"
  : kind;
// Has a human already said no to this exact proposal for this document?
async function alreadyRejected(docId, kind, proposal) {
  const r = await q(
    `select 1 from ql_confirm where document_id=$1 and kind=$2 and status='rejected' and proposal_key=$3 limit 1`,
    [docId, kind, proposalKey(kind, proposal)]
  ).catch(() => ({ rows: [] }));
  return !!r.rows.length;
}

// pull the first JSON object out of an LLM reply (tolerates prose / code fences)
function jparse(text) {
  const raw = String(text || "");
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through to salvage */ } }
  // SALVAGE. A reply cut off by max_tokens is valid JSON missing its closers —
  // discarding it lost the ENTIRE concise key (no type, no dates, no clauses) on
  // every long contract. Rewind to the last COMPLETE value, then close what's
  // open: a partial clause wiki beats an empty document.
  const i = raw.indexOf("{");
  if (i < 0) return null;
  const b = raw.slice(i);
  let depth = 0, inStr = false, esc = false, safe = -1;
  const stack = [];
  for (let k = 0; k < b.length; k++) {
    const c = b[k];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; if (!inStr && depth > 0) safe = k; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") { stack.push(c); depth++; }
    else if (c === "}" || c === "]") { stack.pop(); depth--; if (depth > 0) safe = k; }
  }
  if (safe < 0) return null;
  let out = b.slice(0, safe + 1);
  // recompute what is still open at the cut point, then close it
  const open = [];
  inStr = false; esc = false;
  for (const c of out) {
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  out = out.replace(/,\s*$/, "");
  while (open.length) out += open.pop() === "{" ? "}" : "]";
  try { return JSON.parse(out); } catch { return null; }
}
const clip = (s, n) => String(s || "").slice(0, n);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s : null;

// ---- business rules = the OPERATING CONTROLS of each step -------------------
// Each rule carries `params` (the numbers the code below actually reads) and
// `body` (the prompt guidance injected into that step's call). Architectural
// invariants — SharePoint is never written to, proposals always go through the
// confirm queue — are NOT rules: they are how the code is built, so they carry
// no toggle. Defaults here are the fallback when a rule row is missing.
const RULE_PARAMS = {
  "c1-read":     { max_transcript_chars: 400000, ocr_fallback: true, ocr_when_text_under_chars: 60 },
  "c2-key":      { read_chars: 60000, max_tokens: 24000, classify_confidence_min: 0.7, max_clauses: 400, max_contents: 300 },
  obligations:   { read_chars: 50000, max_tokens: 2500, max_per_contract: 60, default_lead_days: 30 },
  registers:     { read_chars: 50000, max_tokens: 8000, questions_per_call: 8, sweep_batch: 25, keep_corrected: true },
  families:      { candidates_considered: 200, lineage_similarity_min: 0.85, require_explicit_reference: true },
  ask:           { documents_read: 4, semantic_candidates: 12, deep_text_chars: 10000, register_answers: 400, history_turns: 4, obligations_horizon_days: 120, max_tokens: 4000 },
  vectors:       { granularities: ["document", "section", "clause"], max_clause_vectors: 240, max_section_vectors: 80, nearest_in_estate: 5, embed_batch: 48 },
  drafting:      { candidates_ranked: 15, max_models: 3, model_read_chars: 20000, max_tokens: 8000 },
  "sharepoint-scan": { nightly_hour_ist: 2, file_types: [".pdf", ".docx", ".doc", ".txt", ".md"], removal_detection: true, max_files_per_scan: 200 },
};
// one rule's live dials (DB override on top of the defaults)
export async function ruleParams(code) {
  const row = (await q(`select params, status from ql_rule where code=$1`, [code]).catch(() => ({ rows: [] }))).rows[0];
  if (!row || row.status !== "active") return { ...(RULE_PARAMS[code] || {}) };
  return { ...(RULE_PARAMS[code] || {}), ...(row.params || {}) };
}
// the prompt guidance of the rules that govern a scope (+ their codes, logged per call)
async function rulesFor(scope) {
  const { rows } = await q(
    `select code, title, body from ql_rule where status='active' and (scope='global' or scope=$1) and coalesce(body,'')<>'' order by id`, [scope]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return { text: "", codes: [] };
  const text = "HOUSE RULES for this step (set by the legal team — follow them):\n" + rows.map((r) => `- ${r.title}: ${r.body}`).join("\n");
  return { text, codes: rows.map((r) => r.code) };
}

// ---- append-only AI log (best-effort, never blocks) --------------------------
async function logRun(out, { ref_type, ref_id, rules, input, output } = {}) {
  try {
    await q(
      `insert into ql_log(pipeline,provider,model,ref_type,ref_id,rules_applied,input_summary,output_summary,status)
       values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [out.pipeline || null, out.provider || null, out.model || null, ref_type || null, ref_id || null,
       JSON.stringify(rules || []), clip(input, 300), clip(output, 500), out.mode || null]
    );
  } catch { /* logging never blocks the work */ }
}

// ---- caller-side output contracts (immune to stored-prompt drift) ------------
// C2 — the concise key, built from C1. Carries BOTH wikis every document gets:
// the CONTENTS wiki (the document's own structure, so you can navigate it without
// re-reading) and the CLAUSE wiki (every clause, its topic and gist, with § anchors).
// Those two are what make an estate queryable fast; C1 is the deep read behind them.
// The Legal Setting: classification runs against the CURRENT category list (a
// growing taxonomy the team owns), returns a confidence, and may propose a new
// category when nothing fits — the human always gets confirm/override.
const keyContract = (categories) => `Return STRICT JSON only, no prose:
{"meta":{"title":"the contract's own title",
 "doc_type":"the best-fitting category from: ${categories.join(" | ")} — or, ONLY if none genuinely fits, propose a NEW short category name",
 "doc_type_confidence":0-1,
 "party1":"","party2":"","counterparty":"the non-us party (or party2)",
 "ansr_party":"which contracting party is the ANSR-side/our entity, if identifiable, else \\"\\"",
 "jurisdiction":"country/nationality of the counterparty or of the contract, if stated",
 "effective_date":"YYYY-MM-DD or \\"\\"","expiry_date":"YYYY-MM-DD or \\"\\"",
 "governing_law":"","value":"contract value as printed or \\"\\"","auto_renewal":true|false,"notice_period":"as printed or \\"\\"","executed":true|false},
 "summary":"2-4 plain sentences on what this contract is",
 "tags":["lowercase tags from the controlled vocabulary where possible"],
 "contents":[{"ref":"§ as printed","heading":"the heading as printed","page":"if shown, else \\"\\""}],
 "clauses":[{"ref":"§ as printed","label":"2-4 word topic","gist":"one line of what it actually says"}],
 "exhibits":[{"ref":"","title":"schedules, annexures, exhibits as printed"}],
 "notice":{"notice_clauses":[{"ref":"","what":"","method":"","days":""}],"notice_contacts":[""],"change_of_control":[{"ref":"","requires":"notice|consent"}]}}
"contents" = the document's table of contents (its own structure, in order). "clauses" = every substantive clause with its topic.
Use ONLY what the document states — empty string when not stated. Never invent § references; use what the document prints.`;

const OBLIG_CONTRACT = `Return STRICT JSON only, no prose:
{"obligations":[{"kind":"expiry|renewal|termination_notice|deliverable|sla|notice","what":"one line","who_owes":"us|counterparty|unknown",
 "due_date":"YYYY-MM-DD or \\"\\"","frequency":"one_time|monthly|quarterly|annual","ref":"§ as printed"}]}
Extract the dated lifecycle obligations (expiry, renewal window, termination-notice deadline) AND the post-execution deliverables/SLAs
(reports, certificates, insurance, audits). Cite the § for every one. Only what the contract actually states.`;

// Registers = "C2 you define". C1/C2 are the fixed universal layers; a register
// is a standing question the legal team writes once and has answered for EVERY
// contract, with § evidence — so "which of our contracts…" is one query, not a
// re-read of the estate. All active registers are answered in ONE call per doc.
const REGISTER_CONTRACT = `Return STRICT JSON only, no prose:
{"answers":[{"code":"<the register code, exactly as given>","present":"yes|no|unclear",
 "answer":"one plain-English line answering the question for THIS contract",
 "value":"the key number/term asked for, or \\"\\"","refs":["§ as printed"],"confidence":0-1}]}
Answer EVERY register in the list, in order. "present":"no" when the contract genuinely does not deal with it
(say so in the answer); "unclear" when the text is ambiguous — never guess a "yes". Cite the § for every "yes".`;

const LINK_CONTRACT = `Return STRICT JSON only, no prose:
{"parent_id": <id of the governing/parent document from the candidate list, or null>,
 "relation_kind": "amends|governed_by|supersedes|references|null", "confidence": 0-1, "why": "one line citing the tell-tale (e.g. 'pursuant to the MSA dated…')"}
Only propose a parent when the document itself references it (by name/date/parties) — never guess from topic similarity alone.`;

// Is this transcript in a script we can actually extract contract facts from?
// A Kannada lease deed came back with an EMPTY C2 and no explanation — the
// extractor silently produced blanks, which reads exactly like "this contract
// says nothing". Say so instead. Detects by script, not by guessing a language:
// if most letters are outside the Latin range, English extraction will not work.
const NON_LATIN = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/g;
const SCRIPTS = [[/[\u0C80-\u0CFF]/, "Kannada"], [/[\u0900-\u097F]/, "Hindi/Devanagari"], [/[\u0B80-\u0BFF]/, "Tamil"],
  [/[\u0C00-\u0C7F]/, "Telugu"], [/[\u0D00-\u0D7F]/, "Malayalam"], [/[\u0980-\u09FF]/, "Bengali"],
  [/[\u0A80-\u0AFF]/, "Gujarati"], [/[\u0A00-\u0A7F]/, "Punjabi"], [/[\u0600-\u06FF]/, "Arabic/Urdu"],
  [/[\u4E00-\u9FFF]/, "Chinese"], [/[\u0400-\u04FF]/, "Cyrillic"]];
function scriptCheck(c1) {
  const t = String(c1 || "");
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const other = (t.match(NON_LATIN) || []).length;
  if (other < 200 || other < latin) return null;      // English-dominant → fine
  const name = (SCRIPTS.find(([re]) => re.test(t)) || [null, "a non-Latin script"])[1];
  return { language: name, latin, other };
}

// ---- derive: everything downstream of C1 --------------------------------------
// C2 key (facts · tags · contents & clause wikis · notice) → classification vs the
// LIVE Legal Setting taxonomy → obligations → registers. Called by ingestFile on
// every new version AND by the re-index sweep on stored C1 — one pipeline, two doors.
async function deriveFromC1({ docId, verId, versionNo, c1, filename, ocr = false }) {
  // Refuse honestly rather than returning blanks that look like "says nothing".
  // Also saves a pointless model call on a document it cannot read.
  const script = scriptCheck(c1);
  if (script) {
    const note = `This contract is in ${script.language}. The transcript (C1) is stored and searchable, but the key, wikis, dates and standing-question answers could not be extracted — the extractor reads English. Nothing here is missing from the contract; it simply has not been read.`;
    await q(`update ql_version set c2=$2::jsonb, status='done', error=$3 where id=$1`,
      [verId, JSON.stringify({ meta: {}, summary: "", tags: ["not-english", `lang:${script.language.toLowerCase()}`],
        contents: [], clauses: [], exhibits: [], notice: {}, mode: "unsupported-language", unsupported_language: script.language, note }), clip(note, 300)]);
    await q(`update ql_document set summary=$2, tags=$3::jsonb,
              facts = coalesce(facts,'{}'::jsonb) || $4::jsonb, updated_at=now() where id=$1`,
      [docId, note, JSON.stringify(["not-english"]), JSON.stringify({ unsupported_language: script.language })]);
    await logRun({ pipeline: "qlegal-key", mode: "unsupported-language" },
      { ref_type: "version", ref_id: verId, input: filename, output: `not read — ${script.language}` });
    return { mode: "unsupported-language", docType: null, language: script.language };
  }
  const cats = (await q(`select name from ql_category where status='active' order by name`)).rows.map((r) => r.name);
  const P = await ruleParams("c2-key");                    // the C2 dials (Settings → Business Rules)
  // STEP · the Canon clause layer, BEFORE the key. The contract's own structure
  // is read deterministically (§ refs, verbatim bodies, nesting, cross-refs) and
  // labelled in small batches. Doing this first means the clause wiki no longer
  // depends on one model call surviving intact — the layer that truncated.
  let atom = { clauses: 0, edges: 0, structured: false };
  try {
    atom = await atomize(docId, verId, c1);
    await logRun({ pipeline: "qlegal-atomize", mode: atom.structured ? "hybrid" : "no-structure" },
      { ref_type: "version", ref_id: verId, input: filename,
        output: atom.structured
          ? `${atom.clauses} clauses · ${atom.labelled} labelled · ${atom.edges} cross-refs (${atom.unresolved} unresolved)`
          : "no clause structure found — the document is prose or a scan transcript" });
  } catch (e) {
    // the clause layer failing must never cost the document its key
    await logRun({ pipeline: "qlegal-atomize", mode: "error" },
      { ref_type: "version", ref_id: verId, input: filename, output: `failed — ${String(e.message || e).slice(0, 200)}` });
  }

  const rules = await rulesFor("ingestion");
  const out = await runPipeline("qlegal-key", {
    system: [rules.text, keyContract(cats.length ? cats : ["MSA", "SOW", "NDA", "Other"])].filter(Boolean).join("\n\n"),
    user: `Document filename: ${filename}\n\nContract:\n${clip(c1, P.read_chars)}`,
    maxTokens: P.max_tokens,
  });
  await logRun(out, { ref_type: "version", ref_id: verId, rules: rules.codes, input: filename, output: "concise key (C2)" });
  let kp = jparse(out.text) || {};

  // C2 IS MANDATORY. A document with a clause layer but no title, parties, type
  // or dates is not "mostly ingested" — it is unfindable, and worse, it looks
  // ingested. Two contracts sat in the estate that way (FEBI, TJX Principal):
  // 110 and 69 clauses each, and nothing to identify them by.
  //
  // So: judge the result, retry once, and if it still comes back empty, FAIL the
  // version loudly instead of filing a shell.
  const emptyKey = (k) => {
    const m = (k && k.meta) || {};
    return !m.title && !m.doc_type && !m.party1 && !m.party2 && !m.effective_date;
  };
  let keyOut = out;
  if (emptyKey(kp)) {
    // a second attempt at a lower ceiling: the commonest cause is a response that
    // ran past max_tokens and truncated mid-JSON, which a shorter read survives
    const retry = await runPipeline("qlegal-key", {
      system: [rules.text, keyContract(cats.length ? cats : ["MSA", "SOW", "NDA", "Other"])].filter(Boolean).join("\n\n"),
      user: `Document filename: ${filename}\n\nContract:\n${clip(c1, Math.floor(P.read_chars * 0.6))}`,
      maxTokens: P.max_tokens,
    }).catch(() => null);
    const rp = retry ? (jparse(retry.text) || {}) : {};
    await logRun(retry || { pipeline: "qlegal-key", mode: "error" },
      { ref_type: "version", ref_id: verId, input: filename,
        output: emptyKey(rp) ? "C2 retry FAILED — no key extracted" : "C2 recovered on retry (shorter read)" });
    if (!emptyKey(rp)) { kp = rp; keyOut = retry; }
    else {
      const why = "The concise key (C2) could not be extracted — twice. The transcript and clause layer are stored, but this contract has no title, parties, type or dates, so it cannot be identified or filtered. Re-index it, or check the qlegal-key pipeline.";
      await q(`update ql_version set status='failed', error=$2 where id=$1`, [verId, clip(why, 500)]);
      return { mode: "key-failed", docType: null, atom, keyFailed: why };
    }
  }
  const meta = kp.meta || {};
  const tags = [...new Set([...(Array.isArray(kp.tags) ? kp.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
    ...(ocr ? ["scanned-source"] : []), ...(meta.executed ? ["executed"] : [])])].slice(0, 12);
  // The clause wiki now comes from the CLAUSE TABLE when the document had real
  // structure — every clause, not the model's recollection of some of them, and
  // not capped: "which clauses mention indemnity" is only true if all were seen.
  // The model's list stays the fallback for prose documents with no § at all.
  const wiki = atom.structured
    ? (await clauseWiki(docId)).map((c) => ({ ref: c.ref, topic: c.label || c.title || "", gist: c.gist || "" }))
    : (kp.clauses || []).slice(0, P.max_clauses);
  const c2 = { meta, summary: kp.summary || "", tags,
    contents: (kp.contents || []).slice(0, P.max_contents),   // the contents wiki (navigate without re-reading)
    clauses: wiki,                                            // the clause wiki (what each § actually says)
    clause_source: atom.structured ? "canon" : "model",       // say which, so a thin wiki is explainable
    clause_stats: atom.structured ? { clauses: atom.clauses, labelled: atom.labelled, edges: atom.edges, unresolved: atom.unresolved } : null,
    exhibits: (kp.exhibits || []).slice(0, 60),
    notice: kp.notice || {}, mode: keyOut.mode };
  await q(`update ql_version set c2=$2::jsonb, is_executed=$3, status='done', error=null where id=$1`,
    [verId, JSON.stringify(c2), !!meta.executed]);
  // a human-confirmed category is never clobbered by a re-run (confirm-don't-guess)
  const confirmed = (await q(`select (facts->>'doc_type_confirmed')='true' as c from ql_document where id=$1`, [docId])).rows[0]?.c;
  await q(
    `update ql_document set title=coalesce(nullif($2,''), title), doc_type=case when $11 then doc_type else coalesce(nullif($3,''), doc_type) end,
      party1=coalesce(nullif($4,''), party1), party2=coalesce(nullif($5,''), party2),
      counterparty=coalesce(nullif($6,''), counterparty), summary=coalesce(nullif($7,''), summary),
      facts=coalesce(facts,'{}'::jsonb) || $8::jsonb, tags=$9::jsonb, latest_version=greatest(coalesce(latest_version,0),$10), updated_at=now() where id=$1`,
    [docId, clip(meta.title, 200), clip(meta.doc_type, 40), clip(meta.party1, 160), clip(meta.party2, 160),
     clip(meta.counterparty || meta.party2, 160), clip(kp.summary, 1200), JSON.stringify(meta), JSON.stringify(tags), versionNo, !!confirmed]
  );
  // grow the tag vocabulary with new free tags (suggest-first lives in the UI)
  for (const t of tags) await q(`insert into ql_tag_vocab(tag, kind) values($1,'free') on conflict (tag) do nothing`, [t]).catch(() => {});

  // Classification governance: an AI-proposed NEW category joins the taxonomy
  // (marked source 'ai'); low confidence or no model → the confirm queue (no dups).
  if (out.mode === "ai" && meta.doc_type && !cats.some((c) => c.toLowerCase() === String(meta.doc_type).toLowerCase())) {
    await q(`insert into ql_category(name, source) values($1,'ai') on conflict (name) do nothing`, [clip(meta.doc_type, 40)]).catch(() => {});
  }
  const typeConf = Number(meta.doc_type_confidence);
  if (!confirmed && (out.mode !== "ai" || !meta.doc_type || (typeConf && typeConf < P.classify_confidence_min))) {
    const open = (await q(`select 1 from ql_confirm where document_id=$1 and kind='classification' and status='open' limit 1`, [docId])).rows[0];
    // a type this human already rejected here is never proposed again
    const said_no = await alreadyRejected(docId, "classification", { doc_type: meta.doc_type });
    // no keyed model = the pipeline could not run. That is a SYSTEM FAILURE, not a
    // proposal — flag it so it sits in Blocked instead of faking a 0%-confidence
    // decision in the queue.
    const isBlocked = out.mode !== "ai";
    if (!open && !said_no) await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why, proposal_key, blocked) values('classification',$1,$2::jsonb,$3,$4,$5,$6)`,
      [docId, JSON.stringify({ doc_type: meta.doc_type || null }), out.mode === "ai" ? (typeConf || 0.4) : 0,
       out.mode !== "ai" ? "no keyed model — classify this document manually"
         : !meta.doc_type ? "the model could not classify this document"
         : `low-confidence classification (${Math.round(typeConf * 100)}%) — confirm or change it`,
       proposalKey("classification", { doc_type: meta.doc_type }), isBlocked]);
  }

  // obligations — gated qlegal-obligations + obligations business rules
  try {
    const OP = await ruleParams("obligations");
    const orules = await rulesFor("obligations");
    const oout = await runPipeline("qlegal-obligations", {
      system: [orules.text, OBLIG_CONTRACT].filter(Boolean).join("\n\n"),
      user: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nContract:\n${clip(c1, OP.read_chars)}`,
      maxTokens: OP.max_tokens,
    });
    await logRun(oout, { ref_type: "document", ref_id: docId, rules: orules.codes, input: filename, output: "obligations" });
    const op = jparse(oout.text) || {};
    await q(`delete from ql_obligation where document_id=$1 and status='proposed'`, [docId]); // re-propose on re-run; confirmed rows kept
    for (const o of (op.obligations || []).slice(0, OP.max_per_contract)) {
      if (!o || !o.what) continue;
      await q(`insert into ql_obligation(document_id, kind, what, who_owes, due_date, frequency, ref, lead_days) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [docId, clip(o.kind, 30) || "deliverable", clip(o.what, 300), clip(o.who_owes, 20) || "unknown",
         validDate(o.due_date), clip(o.frequency, 20) || "one_time", clip(o.ref, 60), OP.default_lead_days]).catch(() => {});
    }
  } catch { /* obligations are best-effort — the document still lands */ }

  // registers — every standing question, answered for this contract
  try { await runRegisters(docId, { c1, docType: meta.doc_type }); }
  catch { /* registers are best-effort */ }

  // vector spine — embed document/section/clause (best-effort; the re-index
  // embed sweep catches anything this misses, and FTS covers the meantime)
  try { await embedVersion({ docId, verId, c2, filename }); }
  catch { /* vectors are best-effort */ }

  return { mode: out.mode, docType: meta.doc_type || null, atom };
}

// re-index one document from its stored C1 (no re-download, no re-OCR)
async function refreshDoc(docId) {
  const v = (await q(
    `select v.id, v.version_no, v.c1_text, v.ocr, d.filename from ql_version v
      join ql_document d on d.id=v.document_id and v.version_no=d.latest_version where d.id=$1`, [docId])).rows[0];
  if (!v?.c1_text) return null;
  return deriveFromC1({ docId, verId: v.id, versionNo: v.version_no, c1: v.c1_text, filename: v.filename, ocr: v.ocr });
}

// ---- shared per-file ingestion (upload path + SharePoint scan) ---------------
// Writes per step as it completes (resumable spirit): version row first, then C1,
// then the derive chain — a crash never loses finished work.
export async function ingestFile(f, { source = "upload", spItemId = null, spMeta = null, origin = null, actor = null, supersede = false } = {}) {
  const buf = readFileSync(f.path);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ext = extname(f.originalname).toLowerCase();

  // duplicate: this exact file is already in the repository → skip, point at it
  // The duplicate check is on BYTES, which is right by default and wrong when a
  // document was ingested badly and you want to file it again. `supersede` says
  // exactly that: same bytes, deliberately, as a new version that replaces the
  // earlier reading — so the bad one becomes history instead of blocking the fix.
  const dup = (await q(`select v.document_id, v.version_no, d.filename from ql_version v join ql_document d on d.id=v.document_id where v.sha256=$1 limit 1`, [sha256])).rows[0];
  if (dup && !supersede) return { filename: f.originalname, skipped: "duplicate", of: dup };

  // one document, many versions. Identity: the SharePoint item id when we have it
  // (stable across renames/moves), else the filename.
  let doc = spItemId ? (await q(`select * from ql_document where sp_item_id=$1 limit 1`, [spItemId])).rows[0] : null;
  if (!doc) doc = (await q(`select * from ql_document where lower(filename)=lower($1) limit 1`, [f.originalname])).rows[0];
  if (!doc) {
    // Provenance, recorded at the moment it lands — it cannot be recovered later.
    // A device file has no governed home to re-fetch from, so where it came from
    // and who put it there IS the record.
    const loc = source === "sharepoint" ? (spMeta?.sp_web_url || null) : (origin || f.originalname);
    const detail = source === "sharepoint"
      ? { via: "sharepoint-scan" }
      : { via: "upload", by: actor || "you", at: new Date().toISOString(),
          bytes: buf.length, ext, device_path: origin || null };
    doc = (await q(`insert into ql_document(filename, source, sp_item_id, source_location, source_detail)
                    values($1,$2,$3,$4,$5::jsonb) returning *`,
      [f.originalname, source, spItemId, loc, JSON.stringify(detail)])).rows[0];
  } else if (spItemId && !doc.sp_item_id) {
    await q(`update ql_document set sp_item_id=$2, source=$3 where id=$1`, [doc.id, spItemId, source]).catch(() => {});
  }
  if (spMeta) {
    await q(`update ql_document set facts = coalesce(facts,'{}'::jsonb) || $2::jsonb, filename=$3, updated_at=now() where id=$1`,
      [doc.id, JSON.stringify(spMeta), f.originalname]).catch(() => {});   // keep the SP name current on renames
  }
  const versionNo = (doc.latest_version || 0) + 1;
  const ver = (await q(
    `insert into ql_version(document_id, version_no, sha256, status) values($1,$2,$3,'processing')
     on conflict (document_id, version_no) do update set sha256=excluded.sha256, status='processing'
     returning id`, [doc.id, versionNo, sha256]
  )).rows[0];

  try {
    // STEP · C1 — the comprehensive read (Munshi): text, tables and, for scanned /
    // image-only pages, the vision transcription (gated `munshi3:read`, which
    // preserves tables and describes what the text layer flattens). This is the
    // deep substrate every later layer is built from and falls back to.
    const extract = await extractFile(f.path, f.originalname);
    const c1 = clip(extract.text, (await ruleParams("c1-read")).max_transcript_chars);
    if (!c1.trim()) throw new Error("could not read any text from that file");
    const storagePath = await putOriginal(TENANT, sha256, ext, buf);
    const c1DocId = `ql-${doc.id}-v${versionNo}`;
    await putExtract(TENANT, c1DocId, toMarkdown({ docType: "contract", originalName: f.originalname, sha256, extract }));
    // the read report: what the reader actually managed, page by page — stored on
    // the version and surfaced loudly when pages could not be read
    const readReport = { pages: extract.pages || null, ocr_pages: extract.ocr_pages || [],
      figure_pages: extract.figure_pages || [], unread_pages: extract.unread_pages || [] };
    await q(`update ql_version set storage_path=$2, c1_doc_id=$3, c1_text=$4, ocr=$5, read_report=$6::jsonb where id=$1`,
      [ver.id, storagePath, c1DocId, c1, !!extract.ocr, JSON.stringify(readReport)]);
    // the C1 step is owned + traceable like every other step
    await logRun({ pipeline: "qlegal-c1", mode: extract.ocr ? "vision-ocr" : "deterministic", model: extract.ocr ? "munshi3:read" : null },
      { ref_type: "version", ref_id: ver.id, input: f.originalname, output: `C1 · ${c1.length} chars${extract.pages ? ` · ${extract.pages}p` : ""}${(readReport.ocr_pages || []).length ? ` · OCR ${readReport.ocr_pages.length}p` : ""}${(readReport.unread_pages || []).length ? ` · UNREAD ${readReport.unread_pages.join(",")}` : ""}` });
    // pages nothing could read → a loud confirm, never a silent gap (the client's
    // scanned-document complaint was exactly this failure mode)
    if ((readReport.unread_pages || []).length || (readReport.figure_pages || []).length) {
      const ps = [...(readReport.unread_pages || []), ...(readReport.figure_pages || [])].sort((a, b) => a - b);
      const open = (await q(`select 1 from ql_confirm where document_id=$1 and kind='unread' and status='open' limit 1`, [doc.id])).rows[0];
      if (!open) await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why) values('unread',$1,$2::jsonb,1,$3)`,
        [doc.id, JSON.stringify({ pages: ps }),
         `page${ps.length === 1 ? "" : "s"} ${ps.join(", ")} could not be fully read (scan/image quality) — review the original for these pages`]).catch(() => {});
    }

    // STEP · derive everything downstream of C1 (C2 key → classification →
    // obligations → registers). Shared with the re-index sweep, so a refresh is
    // EXACTLY the ingestion pipeline re-run — never a diverging copy.
    var derived = await deriveFromC1({ docId: doc.id, verId: ver.id, versionNo, c1, filename: f.originalname, ocr: !!extract.ocr });

    // STEP · version diff — only when there is a previous version (lazy-versioning rule)
    if (versionNo > 1) {
      try {
        const prev = (await q(`select c1_text from ql_version where document_id=$1 and version_no=$2`, [doc.id, versionNo - 1])).rows[0];
        if (prev?.c1_text) {
          const dout = await runPipeline("qlegal-diff", {
            system: `Compare the two versions of this contract. Return STRICT JSON only: {"diff_summary":"3-6 short bullet lines, each naming what changed and the § (e.g. 'liability cap 12mo → 24mo · §7.2')"}. Only real changes — never invent.`,
            user: `PREVIOUS (v${versionNo - 1}):\n${clip(prev.c1_text, 25000)}\n\nCURRENT (v${versionNo}):\n${clip(c1, 25000)}`,
            maxTokens: 1000,
          });
          await logRun(dout, { ref_type: "version", ref_id: ver.id, input: `v${versionNo - 1}→v${versionNo}`, output: "diff" });
          const dp = jparse(dout.text);
          if (dp?.diff_summary) await q(`update ql_version set diff_summary=$2 where id=$1`, [ver.id, clip(dp.diff_summary, 2000)]);
        }
      } catch { /* diff is best-effort */ }
    }

    // THE GATE, reported per file at upload — not discovered later on the page.
    // POC scope is explicit: non-English and hard scans are not wired up yet, so
    // say so at the door rather than filing a document that looks indexed.
    const pg = (a) => (a || []).length ? `page${a.length === 1 ? "" : "s"} ${a.join(", ")}` : "";
    let gate = null;
    if (derived.mode === "unsupported-language") {
      gate = { blocked: true, why: `Not read — this contract is in ${derived.language}. Non-English contracts are not wired up yet in this POC. The transcript and the original are stored, but there is no key, no wikis, no dates and no standing-question answers.` };
    } else if (derived.mode === "key-failed") {
      gate = { blocked: true, why: derived.keyFailed };
    } else if (extract.ocr && derived.mode !== "ai") {
      gate = { blocked: true, why: "Not read — this is a hard scan and the key could not be extracted. Scanned contracts are not fully wired up yet in this POC. The transcript and the original are stored." };
    }
    // Notes fire even on a document that passed. A contract can be perfectly
    // readable and still have a clause that is a picture — that page reads as
    // complete to every downstream layer, which is the quiet way to be wrong.
    const notes = [];
    if ((extract.unread_pages || []).length)
      notes.push(`${extract.unread_pages.length} of ${extract.pages} pages could not be read (${pg(extract.unread_pages)}) — scanned, and OCR did not recover them.`);
    if ((extract.figure_pages || []).length)
      notes.push(`Image OCR — skipped in this phase. ${extract.figure_pages.length} page${extract.figure_pages.length === 1 ? " carries" : "s carry"} their substance as an image (${pg(extract.figure_pages)}); the heading is indexed, the figure is not. Tables, flowcharts and scoped annexures on these pages are NOT searchable and will not appear in answers.`);
    if (extract.ocr && !gate) notes.push("Read by vision-OCR — spot-check the key before relying on it.");
    // COMPLETENESS · the contract points at something it does not contain. This was
    // already computed when the cross-references were read and then discarded — a
    // contract citing a schedule nobody attached is exactly the doubt a gate exists
    // to raise, and the reader is the only party who can say whether it matters.
    // No clause structure at all. Usually a scan: the OCR read the words but the
    // layout that carries § numbering did not survive, so there is nothing to
    // index. Saying so is the point — the contract IS searchable through its
    // transcript, it simply has no clause anchors, and an answer about it cannot
    // cite one.
    if (derived.atom && derived.atom.structured === false && derived.mode === "ai")
      notes.push("No clause structure could be read — the § numbering did not survive (typically a scan). The full text is stored and searchable, but there is no clause index, no § anchors and no cross-references, so answers about this contract cannot cite a clause.");
    const miss = (derived.atom && derived.atom.missing) || [];
    if (miss.length)
      notes.push(`Incomplete — this contract cites ${miss.length === 1 ? "a document" : "documents"} it does not contain: ${miss.join(", ")}. Answers about ${miss.length === 1 ? "it" : "them"} will be wrong by omission until the missing ${miss.length === 1 ? "part is" : "parts are"} uploaded.`);
    if (notes.length) gate = gate || { blocked: false, why: notes[0] };
    if (gate) gate.notes = notes;
    return { filename: f.originalname, document_id: doc.id, version_no: versionNo, ocr: !!extract.ocr,
      mode: derived.mode, doc_type: derived.docType, language: derived.language || null,
      pages: extract.pages || null, figure_pages: extract.figure_pages || [], unread_pages: extract.unread_pages || [], gate };
  } catch (e) {
    await q(`update ql_version set status='error', error=$2 where id=$1`, [ver.id, clip(e.message, 300)]).catch(() => {});
    return { filename: f.originalname, error: clip(e.message, 200) };
  }
}

// ---- registers: answer every active standing question for one document ------
// One gated call per document covering all registers (cheap + consistent).
// Persisted per document, so a sweep over the estate is resumable.
async function runRegisters(docId, { c1, docType, setName = null, ignoreScope = false } = {}) {
  const regs = (await q(`select id, code, name, question, extract_hint, doc_types, set_name from ql_register where status='active' order by id`)).rows;
  // Scope: a question runs when it is estate-wide, or its doc_types match this
  // contract. A reviewer who explicitly picks a SET overrides that — asking a
  // lease's questions of an unclassified scan is a legitimate thing to want.
  const inSet = (r) => !setName || String(r.set_name || "Estate-wide") === setName;
  const applicable = regs.filter((r) => inSet(r) && (
    (setName && ignoreScope) || !(r.doc_types || []).length ||
    (docType && (r.doc_types || []).map(String).some((t) => t.toLowerCase() === String(docType).toLowerCase()))));
  if (!applicable.length) return 0;
  // read from the NEWEST version that actually has a transcript — a later errored
  // upload must not leave the document permanently unanswerable
  let text = c1, verId = null;
  {
    const v = (await q(`select id, c1_text from ql_version where document_id=$1 and c1_text is not null order by version_no desc limit 1`, [docId])).rows[0];
    if (!text) text = v?.c1_text;
    verId = v?.id || null;
  }
  if (!text) return 0;

  const RP = await ruleParams("registers");
  const rules = await rulesFor("registers");
  // The register list GROWS (the team keeps asking — 17 already). One call for
  // all of them overflows any budget on a long contract and a truncated JSON
  // used to fail the WHOLE document silently. So: batches of a few questions per
  // call — bounded output forever — plus a salvage parse per batch.
  const perCall = Math.max(1, Number(RP.questions_per_call) || 8);
  const answers = [];
  for (let i = 0; i < applicable.length; i += perCall) {
    const batch = applicable.slice(i, i + perCall);
    let out;
    try {
      out = await runPipeline("qlegal-register", {
        system: [rules.text, REGISTER_CONTRACT].filter(Boolean).join("\n\n"),
        user: `Standing questions to answer about this contract:\n${JSON.stringify(batch.map((r) => ({ code: r.code, question: r.question, value_wanted: r.extract_hint || "" })))}\n\nContract:\n${clip(text, RP.read_chars)}`,
        maxTokens: RP.max_tokens,
      });
    } catch { continue; }   // one failed batch never fails the document
    await logRun(out, { ref_type: "document", ref_id: docId, rules: rules.codes, input: `${batch.length} registers (batch ${1 + i / perCall})`, output: clip(out.text, 160) });
    const salvage = (t) => {
      const j = jparse(t);
      if (j?.answers?.length) return j.answers;
      return [...String(t || "").matchAll(/\{\s*"code"[\s\S]*?\}(?=\s*[,\]])/g)]
        .map((m) => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(Boolean);
    };
    let got = salvage(out.text);
    if (!got.length) {
      // some contracts (odd OCR glyphs, instruction-like text) make the model echo
      // the DOCUMENT instead of answering. Retry once with the questions AFTER the
      // contract — recency wins — and an explicit JSON-only reminder.
      try {
        const retry = await runPipeline("qlegal-register", {
          system: [rules.text, REGISTER_CONTRACT].filter(Boolean).join("\n\n"),
          user: `Contract:\n${clip(text, RP.read_chars)}\n\n---\nNow answer these standing questions about the contract above:\n${JSON.stringify(batch.map((r) => ({ code: r.code, question: r.question, value_wanted: r.extract_hint || "" })))}\n\nReturn ONLY the JSON object — no contract text, no prose.`,
          maxTokens: RP.max_tokens,
        });
        await logRun(retry, { ref_type: "document", ref_id: docId, rules: rules.codes, input: `${batch.length} registers (batch ${1 + i / perCall} RETRY)`, output: clip(retry.text, 160) });
        got = salvage(retry.text);
      } catch { /* still nothing — this batch is skipped, others proceed */ }
    }
    answers.push(...got);
  }
  if (!answers.length) return 0;
  const parsed = { answers };
  // tolerant code matching — models garble long codes; normalize both sides
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byCode = Object.fromEntries(applicable.flatMap((r) => [[r.code, r], [norm(r.code), r], [norm(r.name), r]]));
  let n = 0;
  for (const a of parsed.answers) {
    const reg = byCode[a?.code] || byCode[String(a?.code || "").toLowerCase().replace(/[^a-z0-9]+/g, "")];
    if (!reg) continue;
    const present = ["yes", "no", "unclear"].includes(a.present) ? a.present : "unclear";
    // never clobber a human-confirmed/corrected answer (the confirm-don't-guess rule)
    await q(
      `insert into ql_register_hit(register_id, document_id, version_id, present, answer, value, refs, confidence)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       on conflict (register_id, document_id) do update set
         present=excluded.present, answer=excluded.answer, value=excluded.value, refs=excluded.refs,
         confidence=excluded.confidence, version_id=excluded.version_id, updated_at=now()
       where ql_register_hit.status='auto'`,
      [reg.id, docId, verId, present, clip(a.answer, 600), clip(a.value, 200),
       JSON.stringify(Array.isArray(a.refs) ? a.refs.slice(0, 8) : []), Number(a.confidence) || null]
    ).catch(() => {});
    n++;
  }
  return n;
}

// ---- doc tree: propose a parent for one document (gated qlegal-link) ---------
async function proposeLinks(docId) {
  const doc = (await q(`select id, filename, title, doc_type, party1, party2, summary from ql_document where id=$1`, [docId])).rows[0];
  if (!doc) return;
  const FP = await ruleParams("families");
  const cands = (await q(
    `select id, filename, title, doc_type, party1, party2 from ql_document where id<>$1 order by updated_at desc limit $2`, [docId, FP.candidates_considered]
  )).rows;
  if (!cands.length) return;
  const c1 = (await q(`select c1_text from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version where d.id=$1`, [docId])).rows[0];
  const rules = await rulesFor("ingestion");
  const out = await runPipeline("qlegal-link", {
    system: [rules.text, LINK_CONTRACT].filter(Boolean).join("\n\n"),
    user: `Document: ${doc.title || doc.filename} (type ${doc.doc_type || "?"}; parties ${doc.party1 || "?"} / ${doc.party2 || "?"})\nOpening text:\n${clip(c1?.c1_text, 4000)}\n\nCandidate parents:\n${JSON.stringify(cands.map((c) => ({ id: c.id, name: c.title || c.filename, type: c.doc_type, parties: [c.party1, c.party2].filter(Boolean) })))}`,
    maxTokens: 400,
  });
  await logRun(out, { ref_type: "document", ref_id: docId, rules: rules.codes, input: doc.filename, output: "link proposal" });
  const lp = jparse(out.text);
  // NB: Postgres returns bigint ids as STRINGS — compare numerically, never strictly.
  if (!lp || !lp.parent_id || !cands.some((c) => Number(c.id) === Number(lp.parent_id))) return;
  const prop = { parent_id: Number(lp.parent_id), relation_kind: clip(lp.relation_kind, 20) || "references" };
  if (await alreadyRejected(docId, "link", prop)) return;   // asked and answered
  await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why, proposal_key) values('link',$1,$2::jsonb,$3,$4,$5)`,
    [docId, JSON.stringify(prop), Number(lp.confidence) || 0, clip(lp.why, 240), proposalKey("link", prop)]);
}

// deterministic lineage sweep: near-identical text across two different documents
// (e.g. the executed PDF of a final Word doc) → propose an executed_of link.
function wordSet(s) { return new Set(clip(s, 40000).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)); }
function jaccard(a, b) { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); }
async function proposeLineage(docId) {
  const FP = await ruleParams("families");
  const mine = (await q(`select v.c1_text from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version where d.id=$1`, [docId])).rows[0];
  if (!mine?.c1_text) return;
  const my = wordSet(mine.c1_text);
  const others = (await q(
    `select d.id, d.filename, v.c1_text from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version where d.id<>$1 limit $2`, [docId, Math.max(FP.candidates_considered, 100)]
  )).rows;
  for (const o of others) {
    if (!o.c1_text) continue;
    const sim = jaccard(my, wordSet(o.c1_text));
    if (sim >= FP.lineage_similarity_min) {
      const lprop = { other_id: o.id, relation_kind: "executed_of" };
      if (await alreadyRejected(docId, "lineage", lprop)) continue;   // asked and answered
      await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why, proposal_key) values('lineage',$1,$2::jsonb,$3,$4,$5)`,
        [docId, JSON.stringify(lprop), Math.round(sim * 100) / 100,
         `near-identical text (${Math.round(sim * 100)}%) to “${o.filename}” — likely the same contract (draft ↔ executed)`,
         proposalKey("lineage", lprop)]);
      break;
    }
  }
}

// Can we actually ingest? C1 is only the transcript — the KEY (C2), the contents
// and clause wikis, the standing questions and the estate map are all model work.
// Ingesting without a model produces documents that LOOK indexed but carry a
// generic key: worse than refusing, because nobody can tell them apart later.
// So we refuse, and say exactly why.
function ingestReadiness() {
  const cfg = loadConfig();
  const p = cfg.pipelines["qlegal-key"];
  if (!p) return { ready: false, reason: "The Concise Key pipeline (qlegal-key) is missing from the registry." };
  if (!p.enabled) return { ready: false, reason: `The Concise Key pipeline is switched OFF in Settings → AI Pipelines. Without it a contract gets no key, no contents or clause wiki, and no place on the estate map.` };
  const key = getApiKey(p.provider);
  if (!key) return { ready: false, provider: p.provider, model: p.model,
    reason: `No API key for ${p.provider}. C1 (the transcript) can be read without one, but the key, the contents and clause wikis, the standing questions and the estate map are all AI work — so a contract ingested now would land half-built.`,
    fix: `Add a ${p.provider} key in Admin → Vault, or point qlegal-key at a provider that already has one in Settings → AI Pipelines.` };
  return { ready: true, provider: p.provider, model: p.model };
}

export function mountQLegal(app, upload) {
  // the dropzone asks this before it will accept files
  app.get("/api/qlegal/readiness", (_req, res) => res.json(ingestReadiness()));
  // ---- ingestion: manual sync (SharePoint Graph delta sync lands here later) --
  app.post("/api/qlegal/upload", upload.array("files", 50), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files" });
    // POC batch ceiling. Each document is a full derive chain — transcript,
    // clause layer, key, obligations, registers, vectors — and the request drives
    // it, so a long batch runs at the mercy of the Cloud Run request timeout.
    // Three at a time finishes well inside it. Enforced here, not just in the
    // page, because a limit the browser owns is not a limit.
    const POC_MAX = 3;
    if (files.length > POC_MAX) {
      for (const f of files) { try { rmSync(f.path); } catch { /* ignore */ } }
      return res.status(400).json({
        error: `Please upload up to ${POC_MAX} documents at a time for this POC. You sent ${files.length}.`,
        why: "Each contract runs a full read, clause layer, key, obligations, registers and vectors. Three at a time completes reliably; a larger batch can outrun the request timeout and leave documents half-processed.",
        poc_max: POC_MAX,
      });
    }
    // refuse BEFORE storing anything — a half-built contract in the repository is
    // worse than no contract, because it looks the same as a real one
    const ready = ingestReadiness();
    if (!ready.ready) {
      for (const f of files) { try { rmSync(f.path); } catch { /* ignore */ } }
      return res.status(503).json({ error: `Can't ingest — ${ready.reason}${ready.fix ? " " + ready.fix : ""}`, readiness: ready });
    }
    // The browser exposes a relative path only for folder drops (webkitRelativePath);
    // an absolute path on the user's machine is never available, by design. We send
    // whatever exists, per file, and record exactly that — no more.
    const paths = (() => { try { return JSON.parse(req.body?.paths || "[]"); } catch { return []; } })();

    // The batch is recorded BEFORE any work starts, and each file's state is
    // written as it changes. A reload, a second tab or a phone can then watch the
    // same run — the list is the progress meter, naming the document being read
    // rather than a percentage that explains nothing when it stalls.
    // Cloud Run throttles CPU once a response is sent, so the request still drives
    // the loop; what the database buys is visibility and an honest record, not a
    // daemon. A request that dies leaves its remaining files 'queued' and says so.
    const batch = (await q(
      `insert into ql_batch(label, total) values ($1,$2) returning id`,
      [files.length === 1 ? files[0].originalname : `${files.length} documents`, files.length])).rows[0];
    for (const [i, f] of files.entries())
      await q(`insert into ql_batch_item(batch_id, filename, ord) values ($1,$2,$3)`, [batch.id, f.originalname, i]);

    const setItem = (i, patch) => q(
      `update ql_batch_item set stage=coalesce($3,stage), status=coalesce($4,status),
         document_id=coalesce($5,document_id), gate=coalesce($6::jsonb,gate), note=coalesce($7,note), updated_at=now()
        where batch_id=$1 and ord=$2`,
      [batch.id, i, patch.stage || null, patch.status || null, patch.document_id || null,
       patch.gate ? JSON.stringify(patch.gate) : null, patch.note || null]).catch(() => {});

    const results = [];
    for (const [i, f] of files.entries()) {
      await setItem(i, { stage: "reading" });
      try {
        const r = await ingestFile(f, { origin: paths[i] || null, actor: req.body?.by || "you",
          supersede: String(req.body?.supersede || "") === "1" });
        results.push(r);
        await setItem(i, {
          stage: "done",
          status: r.skipped ? "duplicate" : (r.gate && r.gate.blocked ? "blocked" : "ok"),
          document_id: r.document_id || null,
          gate: r.gate || null,
          note: r.skipped ? "already in the repository" : null,
        });
      } catch (e) {
        const msg = String(e.message || e);
        results.push({ filename: f.originalname, error: msg });
        await setItem(i, { stage: "done", status: "failed", note: msg.slice(0, 400) });
      }
      try { rmSync(f.path); } catch { /* ignore */ }
    }
    await q(`update ql_batch set status='done', updated_at=now() where id=$1`, [batch.id]).catch(() => {});
    // Tree-link + lineage proposals must finish BEFORE we respond: Cloud Run
    // throttles CPU once the response is sent, so fire-and-forget work after
    // res.json() silently never runs. Best-effort per doc — a failure here
    // never loses the ingested document.
    for (const r of results) {
      if (!r.document_id) continue;
      await proposeLinks(r.document_id).catch(() => {});
      await proposeLineage(r.document_id).catch(() => {});
    }
    res.json({ batch_id: batch.id, results });
  });

  // ---- registry (the estate table) -------------------------------------------
  app.get("/api/qlegal/registry", async (_req, res) => {
    const docs = (await q(
      `select d.*, (select count(*) from ql_obligation o where o.document_id=d.id and o.status in ('proposed','confirmed')
         and (o.due_date is null or o.due_date >= current_date)) as open_obligations,
        (select count(*) from ql_version v where v.document_id=d.id) as versions,
        exists(select 1 from ql_version v where v.document_id=d.id and v.ocr) as scanned,
        -- index status, per layer. Each is a thing that either happened or did
        -- not; a percentage that averages them tells you HOW ingested a contract
        -- is, and which rung is missing when the answer is "not fully".
        (select count(*) from ql_clause c where c.document_id=d.id) as clauses,
        (select count(*) from ql_embedding e where e.document_id=d.id) as vectors,
        (select count(*) from ql_register_hit rh where rh.document_id=d.id) as register_hits,
        (select v.status from ql_version v where v.document_id=d.id and v.version_no=d.latest_version) as ver_status,
        (select v.error from ql_version v where v.document_id=d.id and v.version_no=d.latest_version) as ver_error,
        (select length(v.c1_text) from ql_version v where v.document_id=d.id and v.version_no=d.latest_version) as c1_chars,
        (select (v.c2->'meta'->>'title') is not null and (v.c2->'meta'->>'title') <> ''
           from ql_version v where v.document_id=d.id and v.version_no=d.latest_version) as has_c2
       from ql_document d order by d.updated_at desc limit 1000`
    )).rows;
    const counts = (await q(`select coalesce(doc_type,'unclassified') t, count(*) c from ql_document group by 1 order by c desc`)).rows;
    res.json({ documents: docs, by_type: counts });
  });

  // Re-index ONE contract from its stored C1 — the same derive chain ingestion
  // runs, so a refresh is never a diverging copy of the pipeline.
  app.post("/api/qlegal/document/:id/reindex", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // The NEWEST version that actually holds a transcript — not the one
      // latest_version points at. When the key step failed, latest_version was
      // never promoted off 0, so this lookup found nothing and re-index answered
      // "not found": the one document that most needed rebuilding was the one
      // document that could not be rebuilt.
      const row = (await q(
        `select v.id ver_id, v.version_no, v.c1_text, v.ocr, d.filename
           from ql_version v join ql_document d on d.id=v.document_id
          where d.id=$1 and v.c1_text is not null
          order by v.version_no desc limit 1`, [id])).rows[0];
      if (!row) return res.status(404).json({ error: "not found" });
      if (!row.c1_text) return res.status(400).json({ error: "no transcript stored — re-upload the file" });

      // RE-READ when the transcript is incomplete. A re-index used to rebuild only
      // what sits DOWNSTREAM of C1, so a contract whose pages never OCR'd (an empty
      // provider balance, a timeout) could be re-indexed forever and never gain the
      // missing pages — the text simply was not there. If the read report shows
      // unread or figure pages, fetch the original back out of the vault and read
      // it again first; OCR now fails over across providers and runs concurrently.
      const rr = (await q(`select read_report, storage_path from ql_version where id=$1`, [row.ver_id])).rows[0] || {};
      const gaps = [...((rr.read_report || {}).unread_pages || []), ...((rr.read_report || {}).figure_pages || [])];
      let reread = null;
      if (gaps.length && rr.storage_path) {
        const buf = await getOriginal(rr.storage_path).catch(() => null);
        if (buf) {
          const tmpDir = mkdtempSync(join(tmpdir(), "qlre-"));
          const tmpFile = join(tmpDir, row.filename.replace(/[^\w.-]/g, "_"));
          try {
            writeFileSync(tmpFile, buf);
            const ex = await extractFile(tmpFile, row.filename);
            const text = clip(ex.text, 400000);
            if (text.trim() && text.length > (row.c1_text || "").length) {
              const report = { pages: ex.pages || null, ocr_pages: ex.ocr_pages || [],
                figure_pages: ex.figure_pages || [], unread_pages: ex.unread_pages || [] };
              await q(`update ql_version set c1_text=$2, ocr=$3, read_report=$4::jsonb where id=$1`,
                [row.ver_id, text, !!ex.ocr, JSON.stringify(report)]);
              row.c1_text = text;
              reread = { before: gaps.length, after: (report.unread_pages || []).length + (report.figure_pages || []).length, pages: report.pages };
              await logRun({ pipeline: "qlegal-c1", mode: ex.ocr ? "vision-ocr" : "deterministic" },
                { ref_type: "version", ref_id: row.ver_id, input: `re-read ${row.filename}`,
                  output: `${text.length} chars · ${report.pages || "?"}p · recovered ${gaps.length - reread.after} of ${gaps.length} unread pages` });
              // the old "could not read" flag is stale once the pages come back
              if (!reread.after) await q(`update ql_confirm set status='accepted', resolved_by='re-index', resolved_at=now() where document_id=$1 and kind='unread' and status='open'`, [id]).catch(() => {});
            }
          } catch { /* re-read is best-effort — the rebuild below still runs */ }
          finally { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
        }
      }

      // A re-index takes a couple of minutes and used to report nothing at all
      // until it finished, which is indistinguishable from not running. It is a
      // batch of one, so it is recorded as one — the panel already on this page
      // then shows its stage, and a closed tab no longer hides the work.
      const b = (await q(`insert into ql_batch(label, total) values ($1,1) returning id`,
        [`Re-index · ${row.filename}`])).rows[0];
      await q(`insert into ql_batch_item(batch_id, filename, document_id, ord, stage) values ($1,$2,$3,0,'rebuilding')`,
        [b.id, row.filename, id]);
      const stage = (st) => q(`update ql_batch_item set stage=$2, updated_at=now() where batch_id=$1`, [b.id, st]).catch(() => {});

      const out = await deriveFromC1({ docId: id, verId: row.ver_id, versionNo: row.version_no,
        c1: row.c1_text, filename: row.filename, ocr: !!row.ocr });
      // deriveFromC1 has ALREADY embedded this version, with the real C2 in hand.
      // Embedding a second time here with c2:null found no clause bodies and wrote
      // a single document vector OVER the 107 just built — the index read 0 clauses
      // immediately after a successful re-index, every time.
      await stage("embedding");

      const failed = out.mode === "key-failed";
      await q(`update ql_batch_item set stage='done', status=$2, note=$3, updated_at=now() where batch_id=$1`,
        [b.id, failed ? "blocked" : "ok",
         failed ? out.keyFailed : `${out.atom?.clauses || 0} clauses · key, obligations, registers and vectors rebuilt`]).catch(() => {});
      await q(`update ql_batch set status='done', updated_at=now() where id=$1`, [b.id]).catch(() => {});
      res.json({ ok: true, batch_id: b.id, mode: out.mode, clauses: out.atom?.clauses || 0, failed, why: out.keyFailed || null, reread });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // the transcript itself — read it, rather than trusting that it read
  app.get("/api/qlegal/document/:id/c1", async (req, res) => {
    try {
      const r = (await q(
        `select v.c1_text, v.ocr, d.filename from ql_version v
           join ql_document d on d.id=v.document_id and v.version_no=d.latest_version where d.id=$1`,
        [Number(req.params.id)])).rows[0];
      if (!r) return res.status(404).json({ error: "not found" });
      res.json({ filename: r.filename, ocr: !!r.ocr, chars: (r.c1_text || "").length, text: r.c1_text || "" });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // ---- one contract's wiki page ----------------------------------------------
  app.get("/api/qlegal/document/:id", async (req, res) => {
    const id = Number(req.params.id);
    const doc = (await q(`select * from ql_document where id=$1`, [id])).rows[0];
    if (!doc) return res.status(404).json({ error: "not found" });
    const versions = (await q(
      `select id, version_no, status, ocr, is_executed, diff_summary, c1_doc_id, sha256, error, created_at
       from ql_version where document_id=$1 order by version_no desc`, [id])).rows;
    const c2 = (await q(`select c2 from ql_version where document_id=$1 and version_no=$2`, [id, doc.latest_version])).rows[0]?.c2 || {};
    const obligations = (await q(`select * from ql_obligation where document_id=$1 order by due_date nulls last, id`, [id])).rows;
    const children = (await q(`select id, filename, title, doc_type, relation_kind, relation_status from ql_document where parent_id=$1 order by id`, [id])).rows;
    const parent = doc.parent_id ? (await q(`select id, filename, title, doc_type from ql_document where id=$1`, [doc.parent_id])).rows[0] : null;
    const confirms = (await q(`select * from ql_confirm where document_id=$1 and status='open' order by id`, [id])).rows;
    // this document's answer to every standing question the team has defined
    const registers = (await q(
      `select h.id, h.present, h.answer, h.value, h.refs, h.status, r.id as register_id, r.name, r.question, coalesce(r.set_name,'Estate-wide') as set_name
         from ql_register_hit h join ql_register r on r.id=h.register_id
        where h.document_id=$1 and r.status='active' order by r.builtin desc, r.id`, [id]
    )).rows;
    // the vector wiki's computed panel — semantically nearest contracts in the estate
    const nearest = await nearestDocs(id, 5).catch(() => []);
    res.json({ document: doc, versions, c2, obligations, children, parent, confirms, registers, nearest });
  });
  // Delete is a PURGE and says so. The cascade takes versions (C1/C2), vectors,
  // register answers, obligations, clauses and confirms; the vault original is
  // removed explicitly, because a cascade cannot reach a file. What went is
  // counted and returned rather than assumed.
  app.delete("/api/qlegal/document/:id", async (req, res) => {
    const id = Number(req.params.id);
    const vers = (await q(`select id, storage_path from ql_version where document_id=$1`, [id])).rows;
    let files = 0;
    for (const v of vers) { if (v.storage_path && await removeOriginal(v.storage_path).catch(() => false)) files++; }
    const counts = {};
    for (const [k, t] of [["versions", "ql_version"], ["vectors", "ql_vector"], ["register_answers", "ql_register_hit"],
                          ["obligations", "ql_obligation"], ["confirmations", "ql_confirm"]]) {
      counts[k] = Number((await q("select count(*) c from " + t + " where document_id=$1", [id]).catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c);
    }
    await q(`delete from ql_document where id=$1`, [id]);   // cascades every child table
    res.json({ ok: true, purged: { ...counts, vault_files: files } });
  });

  // The three ways into a document, from any screen:
  //   C1 — the comprehensive transcript (the deep read)
  //   C2 — the concise key + the contents & clause wikis (what queries run on)
  //   original — our vault snapshot of the file itself (the authority)
  app.get("/api/qlegal/c1/:versionId", async (req, res) => {
    const v = (await q(`select c1_doc_id, c1_text from ql_version where id=$1`, [Number(req.params.versionId)])).rows[0];
    if (!v) return res.status(404).send("not found");
    const md = (v.c1_doc_id && await getExtract(TENANT, v.c1_doc_id)) || v.c1_text || "";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(md);
  });
  app.get("/api/qlegal/c2/:versionId", async (req, res) => {
    const v = (await q(`select c2 from ql_version where id=$1`, [Number(req.params.versionId)])).rows[0];
    if (!v) return res.status(404).json({ error: "not found" });
    res.json(v.c2 || {});
  });
  app.get("/api/qlegal/original/:versionId", async (req, res) => {
    const v = (await q(
      `select v.storage_path, v.version_no, d.filename from ql_version v join ql_document d on d.id=v.document_id where v.id=$1`,
      [Number(req.params.versionId)]
    )).rows[0];
    if (!v) return res.status(404).send("not found");
    const buf = await getOriginal(v.storage_path);
    if (!buf) return res.status(404).send("the original snapshot is no longer in the vault");
    const base = String(v.filename || "document").replace(/\.[^.]+$/, "");
    const e = extname(v.filename || "") || "";
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${base}-v${v.version_no}${e}"`);
    res.send(buf);
  });

  // ---- global search: HYBRID, ALWAYS — facts + full-text + vector, rank-fused --
  // FTS is OR-ranked: a doc matching ANY term hits; matching more terms ranks
  // higher. (AND semantics silently drop "liability cap" when only "liability"
  // is printed.) Vectors catch the paraphrase FTS can't ("terminate for
  // convenience" ≈ "without cause"); a vector hit is only ever a pointer to a
  // real § — the fused list still opens the actual document.
  const orQuery = (term) => clip(term, 200).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, "")).filter((w) => w.length > 1).join(" OR ") || "";

  // ---- the concept layer (legal thesaurus) -------------------------------------
  // One legal idea → every phrasing contracts use for it. A query touching any
  // phrasing of a concept expands to ALL of them, so "venue" also finds
  // "exclusive jurisdiction", "seat of arbitration", "construed in accordance
  // with"… Editable in Taxonomy; cached 60s.
  let _concepts = { at: 0, rows: [] };
  async function activeConcepts() {
    if (Date.now() - _concepts.at > 60000) {
      _concepts = { at: Date.now(), rows: (await q(`select id, name, terms from ql_concept where status='active'`).catch(() => ({ rows: [] }))).rows };
    }
    return _concepts.rows;
  }
  const _words = (s) => new Set(String(s || "").toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 3));
  async function matchedConcepts(term) {
    const qw = _words(term);
    if (!qw.size) return [];
    return (await activeConcepts()).filter((c) =>
      [...qw].some((w) => c.name.toLowerCase().includes(w)) ||
      (c.terms || []).some((t) => [..._words(t)].some((w) => qw.has(w))));
  }
  // the FTS query string, concept-expanded (vectors keep the raw phrasing —
  // they're already semantic; this widens the DETERMINISTIC rung)
  async function expandForFts(term) {
    const hits = await matchedConcepts(term);
    if (!hits.length) return term;
    const extra = [...new Set(hits.flatMap((c) => c.terms || []).flatMap((t) => [..._words(t)]))].slice(0, 40);
    return `${term} ${extra.join(" ")}`;
  }
  // reciprocal-rank fusion over per-document ranked lists (k=60, the classic)
  const rrfFuse = (lists) => {
    const score = new Map();
    for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) || 0) + 1 / (60 + rank)));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };
  async function hybridSearch(term, { ftsLimit = 25, semLimit = 12 } = {}) {
    const tsq = orQuery(await expandForFts(term));
    const [fts, sem] = await Promise.all([
      tsq ? q(
        `select d.id, d.filename, d.title, d.doc_type, d.party1, d.party2, d.tags, v.version_no,
                ts_headline('english', v.c1_text, websearch_to_tsquery('english', $1),
                  'MaxFragments=2, MaxWords=22, MinWords=8, FragmentDelimiter= … ') as snippet,
                ts_rank(to_tsvector('english', coalesce(v.c1_text,'')), websearch_to_tsquery('english', $1)) as rank
           from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version
          where to_tsvector('english', coalesce(v.c1_text,'')) @@ websearch_to_tsquery('english', $1)
          order by rank desc limit ${ftsLimit}`, [tsq]
      ).then((r) => r.rows) : [],
      searchVectors(term, { limit: semLimit }).catch(() => []),
    ]);
    // best semantic hit per document (a § pointer: ref + gist + similarity)
    const semByDoc = new Map();
    for (const s of sem) if (!semByDoc.has(Number(s.document_id))) semByDoc.set(Number(s.document_id), s);
    const order = rrfFuse([fts.map((h) => Number(h.id)), [...semByDoc.keys()]]);
    const ftsById = new Map(fts.map((h) => [Number(h.id), h]));
    const hits = order.map((id) => {
      const f = ftsById.get(id), s = semByDoc.get(id);
      return {
        ...(f || { id, filename: s.filename, title: s.doc_title, doc_type: s.doc_type }),
        via: f && s ? "text+semantic" : f ? "text" : "semantic",
        ...(s ? { sem_ref: s.ref, sem_snippet: s.content, sem_similarity: Math.round(s.similarity * 100) / 100 } : {}),
      };
    });
    return { hits, semUsed: semByDoc.size > 0, semClauses: sem.filter((s) => s.granularity === "clause").slice(0, 8) };
  }
  app.get("/api/qlegal/search", async (req, res) => {
    const term = clip(req.query.q, 200).trim();
    if (!term) return res.json({ hits: [] });
    const { hits } = await hybridSearch(term);
    const facts = (await q(
      `select id, filename, title, doc_type, party1, party2, tags from ql_document
        where filename ilike $1 or title ilike $1 or party1 ilike $1 or party2 ilike $1 or counterparty ilike $1 or tags::text ilike $1
        limit 10`, [`%${term}%`]
    )).rows;
    // the CLAUSE WIKI: concept-labelled clauses match even when the § never uses
    // the query's words (the model already labelled "Dispute resolution" etc.)
    let clauseHits = [];
    try {
      const cons = await matchedConcepts(term);
      const pats = [...new Set([term, ...cons.flatMap((c) => [c.name, ...(c.terms || [])])])].slice(0, 30).map((t) => `%${t}%`);
      if (pats.length) clauseHits = (await q(
        `select d.id, d.filename, d.title, d.doc_type, d.party1, d.party2,
                c->>'ref' as cref, c->>'label' as clabel, c->>'gist' as cgist
           from ql_document d
           join ql_version v on v.document_id=d.id and v.version_no=d.latest_version,
                jsonb_array_elements(coalesce(v.c2->'clauses','[]'::jsonb)) c
          where coalesce(d.status,'active')<>'inactive'
            and (c->>'label' ilike any($1) or c->>'gist' ilike any($1))
          limit 12`, [pats])).rows;
    } catch { /* clause hits are best-effort */ }
    const seen = new Set(hits.map((h) => Number(h.id)));
    const clauseByDoc = new Map();
    for (const c of clauseHits) if (!clauseByDoc.has(Number(c.id))) clauseByDoc.set(Number(c.id), c);
    const extra = [...clauseByDoc.values()].filter((c) => !seen.has(Number(c.id)))
      .map((c) => ({ id: c.id, filename: c.filename, title: c.title, doc_type: c.doc_type, party1: c.party1, party2: c.party2,
        via: "clause wiki", snippet: `<b>${c.cref || ""} ${c.clabel || ""}</b> — ${c.cgist || ""}` }));
    extra.forEach((c) => seen.add(Number(c.id)));
    res.json({ hits: [...hits, ...extra, ...facts.filter((f) => !seen.has(Number(f.id))).map((f) => ({ ...f, via: "facts" }))] });
  });

  // ---- Ask the repository — the RETRIEVAL LADDER --------------------------------
  // A lawyer's questions are infinite, so retrieval is layered, cheapest first:
  //   rung 1 · C2 + registers  — structured, whole-estate, instant (answers "which
  //            of our contracts…" across 1000 docs without reading one of them)
  //   rung 2 · the CLAUSE + CONTENTS wikis of the documents that look relevant
  //   rung 3 · C1 deep text of the few best-matching documents
  //   rung 4 · the original file — never read by the model; cited as the authority
  // Only the rungs a question needs are climbed, so cost tracks difficulty.
  app.post("/api/qlegal/ask", async (req, res) => {
    const question = clip(req.body?.question, 500).trim();
    if (!question) return res.status(400).json({ error: "no question" });
    // conversation: the last few turns travel with the question so follow-ups
    // ("and the SOW?", "what about the cap there?") keep their context.
    const AP = await ruleParams("ask");                    // the Ask dials (Settings → Business Rules)
    const history = (Array.isArray(req.body?.history) ? req.body.history : []).slice(-AP.history_turns)
      .map((t) => ({ q: clip(t?.q, 400), a: clip(t?.a, 1200) })).filter((t) => t.q);
    try {
      const rungs = [];
      // rung 1 — the structured estate: shape, facts, register answers, obligations
      const estate = (await q(`select coalesce(doc_type,'unclassified') t, count(*) c from ql_document group by 1`)).rows;
      const regAnswers = (await q(
        `select r.name, r.question, d.id, coalesce(d.title, d.filename) as doc, h.present, h.answer, h.value, h.refs
           from ql_register_hit h join ql_register r on r.id=h.register_id join ql_document d on d.id=h.document_id
          where r.status='active' order by r.id, d.id limit $1`, [AP.register_answers]
      )).rows;
      const soon = (await q(
        `select d.filename, o.kind, o.what, o.due_date from ql_obligation o join ql_document d on d.id=o.document_id
          where o.status in ('proposed','confirmed')
            and o.due_date between current_date and current_date + ($1::int)
          order by o.due_date limit 15`, [AP.obligations_horizon_days]
      )).rows;
      rungs.push("C2/REGISTERS (structured, whole estate)");

      // rung 2/3 — the documents that actually match the question, HYBRID:
      // FTS (literal words) + vectors (the paraphrase FTS can't see), rank-fused.
      // A follow-up ("and the cap there?") carries little signal on its own, so
      // search on the conversation's words too.
      const searchText = [history.map((t) => t.q).join(" "), question].join(" ").trim();
      const { hits: fused, semUsed, semClauses } = await hybridSearch(searchText, { ftsLimit: 10, semLimit: AP.semantic_candidates });
      const topIds = fused.slice(0, AP.documents_read).map((h) => Number(h.id));
      const hits = topIds.length ? (await q(
        `select d.id, d.filename, d.title, d.doc_type, v.c1_text, v.c2
           from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version
          where d.id = any($1)`, [topIds]
      )).rows.sort((a, b) => topIds.indexOf(Number(a.id)) - topIds.indexOf(Number(b.id))) : [];
      if (semUsed) rungs.push("VECTORS (semantic match)");
      if (hits.length) rungs.push("CLAUSE+CONTENTS WIKIS", "C1 deep text");

      const regBlock = regAnswers.length
        ? "REGISTER ANSWERS (a standing question, already answered for every contract — use these for “which of our contracts…” questions):\n"
          + regAnswers.map((r) => `- [${r.id}] ${r.doc} · ${r.name}: ${r.present}${r.value ? ` (${r.value})` : ""} — ${r.answer || ""} ${(r.refs || []).join(" ")}`).join("\n")
        : "";
      // The clause block is an INDEX, not a dump. Every clause in document order,
      // indented by nesting, with the contract's own cross-references inlined —
      // so the model can see where to go rather than hunting through 112 clauses
      // pasted in full. Falls back to the model's own list for prose documents.
      const wikiBlock = (await Promise.all(hits.map(async (h) => {
        const c2 = h.c2 || {};
        const contents = (c2.contents || []).map((x) => `${x.ref || ""} ${x.heading || ""}`).join(" · ");
        let index = "";
        try { index = await clauseIndex(h.id); } catch { /* fall through to C2 */ }
        if (!index) index = (c2.clauses || []).map((x) => `${x.ref || ""} ${x.label || ""} — ${x.gist || ""}`).join("\n  ");
        return `DOCUMENT [${h.id}] ${h.title || h.filename} (${h.doc_type || "?"})\n CONTENTS: ${contents || "—"}\n CLAUSE INDEX (navigate by this — "[see also §x]" means that clause governs this one; quote from the deep text, never from this index):\n${index || "  —"}`;
      }))).join("\n\n");
      const deepBlock = hits.map((h) => `DEEP TEXT (C1) — [${h.id}] ${h.title || h.filename}:\n${clip(h.c1_text, AP.deep_text_chars)}`).join("\n\n");

      // RUNG · follow the contract's own cross-references. Asked how long an
      // agreement runs, ranking returns the term clause — and the term clause
      // says "continue indefinitely unless terminated per Section 15". Section
      // 15 ranks nowhere near the question, because a cross-reference reads
      // nothing like its target. So walk the edge and put BOTH in front of the
      // model, with the linking phrase, verbatim.
      let linkBlock = "";
      try {
        const parts = [];
        for (const h of hits.slice(0, AP.documents_read)) {
          const seeds = [
            ...(semClauses || []).filter((s) => Number(s.document_id) === Number(h.id)).map((s) => s.ref),
            ...((h.c2 || {}).clauses || []).map((c) => c.ref),
          ].filter(Boolean).slice(0, 12);
          if (!seeds.length) continue;
          const edges = (await clauseEdges(h.id)).filter((e) => e.resolved && seeds.includes(e.from_ref));
          if (!edges.length) continue;
          const pulled = await clausesWithRefs(h.id, edges.map((e) => e.to_ref), { hops: 1 });
          if (!pulled.length) continue;
          parts.push(`[${h.id}] ${h.title || h.filename}\n`
            + edges.slice(0, 12).map((e) => `  ${e.from_ref} → ${e.to_ref}  ("${e.phrase}")`).join("\n")
            + "\n  REFERENCED CLAUSES, VERBATIM:\n"
            + pulled.map((c) => `  ${c.ref} ${c.label || c.title || ""}: ${clip(c.body, 900)}`).join("\n"));
        }
        if (parts.length) {
          linkBlock = "CROSS-REFERENCES THE CONTRACT ITSELF MAKES (follow these before answering — a clause that defers to another is NOT answered until the other is read):\n"
            + parts.join("\n\n");
          rungs.push("CLAUSE CROSS-REFERENCES");
        }
      } catch { /* the graph is an enrichment; Ask still answers without it */ }

      // vector hits are POINTERS to real §§ — the model still cites the document
      const semBlock = (semClauses || []).length
        ? "SEMANTICALLY CLOSEST CLAUSES (found by meaning, not words — each is a real § in the named contract):\n"
          + semClauses.map((s) => `- [${s.document_id}] ${s.doc_title || s.filename} ${s.ref || ""} — ${s.content}`).join("\n")
        : "";
      // RUNG 0 · the parent routing map. Every contract in the estate on one
      // line — parties, dates, law, version, and the § to jump to for the usual
      // questions. The model picks the RIGHT contracts from the whole estate
      // instead of answering from whichever five happened to rank.
      let estateBlock = "";
      try {
        const ew = await estateWiki({ limit: AP.estate_map_docs || 1000 });
        if (ew.lines.length) {
          estateBlock = `ESTATE META-WIKI — every contract held, one line each. Use this to decide WHICH contracts answer the question; open them below for the words. "NOT ATOMIZED" means that contract has no clause index yet, so do not claim its clauses were checked:\n`
            + ew.lines.join("\n");
          rungs.unshift("ESTATE META-WIKI");
        }
      } catch { /* the map is an enrichment; the register answers still cover the estate */ }

      const ctx = [
        `REPOSITORY SHAPE: ${estate.map((e) => `${e.t}: ${e.c}`).join(" · ") || "empty"}`,
        estateBlock,
        regBlock,
        soon.length ? `UPCOMING OBLIGATIONS (120 days): ${soon.map((s) => `${s.filename} — ${s.what} (${s.due_date ? String(s.due_date).slice(0, 10) : "?"})`).join(" | ")}` : "",
        semBlock, wikiBlock, linkBlock, deepBlock,
      ].filter(Boolean).join("\n\n");

      const rules = await rulesFor("search");
      const out = await runPipeline("qlegal-ask", {
        system: [rules.text, `Answer ONLY from the repository context below, which is layered: the structured estate (register answers + facts) covers EVERY contract, then the clause/contents wikis, then the deep text of the closest documents.
Write like a colleague who has read the file, not like a database report.

- LEAD WITH THE ANSWER. First sentence answers the question. Detail after.
- Prose, not a form. No "What's missing:" headings, no "(I checked all N contracts)"
  parentheticals, no bracketed ids like [2] — name the contract as a person would
  ("the Platform Support SOW"), and put the § beside the claim it supports.
- Dates as a person writes them: "28 February 2026", not "2026-02-28".
- Say what you could not find in one plain sentence, at the END, not as a section.
  If a standing question would fix it for the whole estate, suggest it in a line —
  don't lecture.
- Never pad. If the answer is one sentence, give one sentence.
- For "which of our contracts…", answer from the register answers (they already
  cover every contract) and say plainly how many you looked at.
- Cite the contract and the § for every claim. If the context cannot answer, say so
  — never guess.

${ctx}${history.length ? `\n\nTHE CONVERSATION SO FAR (the question may be a follow-up to it):\n${history.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n\n")}` : ""}`].filter(Boolean).join("\n\n"),
        user: question,
        maxTokens: 1500,
      });
      await logRun(out, { ref_type: "ask", rules: rules.codes, input: question, output: clip(out.text, 400) });
      // Every § the answer cites is checked against the stored clause — does that
      // reference exist, and does that clause actually discuss what the sentence
      // claims? Measured on the live estate this catches real errors: an answer
      // about governing law cited Insulet §4.5, which is "Disputed Amount". The
      // clause exists, so existence alone would have passed it — the check has to
      // be about content, and it can be, because every body is stored verbatim.
      let citations = null;
      try { citations = await verifyCitations(out.text, hits.map((h) => Number(h.id))); }
      catch { /* verification is a safety net, never a reason to withhold an answer */ }

      res.json({
        answer: out.mode === "ai" ? out.text : (out.mode === "error" ? out.text : "(no answer — point the Q-Legal pipelines at a keyed model in AI Skills & Pipelines)"),
        citations,
        mode: out.mode, rungs, sources: hits.map((h) => ({ id: h.id, name: h.title || h.filename })),
      });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // ---- Ask ONE contract (conversational) — grounded solely in this document -----
  app.post("/api/qlegal/document/:id/ask", async (req, res) => {
    const id = Number(req.params.id);
    const question = clip(req.body?.question, 500).trim();
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-4).map((t) => ({ q: clip(t.q, 400), a: clip(t.a, 1500) })) : [];
    if (!question) return res.status(400).json({ error: "no question" });
    try {
      const d = (await q(
        `select d.id, d.filename, d.title, d.doc_type, v.c1_text, v.c2 from ql_document d
          join ql_version v on v.document_id=d.id and v.version_no=d.latest_version where d.id=$1`, [id])).rows[0];
      if (!d) return res.status(404).json({ error: "not found" });
      const regs = (await q(
        `select r.name, h.present, h.answer, h.refs from ql_register_hit h join ql_register r on r.id=h.register_id
          where h.document_id=$1 and r.status='active'`, [id])).rows;
      const rules = await rulesFor("search");
      const out = await runPipeline("qlegal-ask", {
        system: [rules.text, `Answer ONLY from THIS contract. Cite the § for every claim; combine §§ when they interact. If the contract doesn't address it, say so plainly — never guess. Be concise and practical.

CONTRACT [${d.id}] ${d.title || d.filename} (${d.doc_type || "?"})
ALREADY-EXTRACTED ANSWERS (standing questions): ${regs.map((r) => `${r.name}: ${r.present}${r.answer ? ` — ${r.answer}` : ""} ${(r.refs || []).join(" ")}`).join(" | ") || "none"}

FULL TEXT (C1):
${clip(d.c1_text, 55000)}${history.length ? `\n\nTHE CONVERSATION SO FAR (the question may be a follow-up):\n${history.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n\n")}` : ""}`].filter(Boolean).join("\n\n"),
        user: question,
        maxTokens: 4000,
      });
      await logRun(out, { ref_type: "document", ref_id: id, rules: rules.codes, input: question, output: clip(out.text, 400) });
      res.json({ answer: out.mode === "ai" ? out.text : (out.mode === "error" ? out.text : "(no answer — point the Q-Legal pipelines at a keyed model in AI Skills & Pipelines)"), mode: out.mode });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // ---- Drafting: ask → suggest model contracts → select → draft 1 ----------------
  // The estate IS the standards library: structure and standard positions come
  // from the contracts the lawyer picks as models, particulars from the ask.
  app.post("/api/qlegal/draft/suggest", async (req, res) => {
    const ask = clip(req.body?.ask, 600).trim();
    if (!ask) return res.status(400).json({ error: "describe the contract you need" });
    try {
      // Prefilter is HYBRID, like every other retrieval path: word-match alone
      // misses the model you want whenever the ask and the contract use different
      // vocabulary ("data-processing angle" vs a contract that says "processor
      // obligations"). Semantic candidates come first, then recency fills the list,
      // then the LLM ranks the shortlist for fit.
      const DP = await ruleParams("drafting");
      const cap = Number(DP.candidates_ranked) || 15;
      const { hits: fused } = await hybridSearch(ask, { ftsLimit: cap, semLimit: cap });
      const ranked = fused.slice(0, cap).map((h) => Number(h.id));
      const cands = (await q(
        `select d.id, coalesce(d.title, d.filename) as name, d.doc_type, d.party1, d.party2, d.summary, d.tags
           from ql_document d
          where coalesce(d.status,'active')<>'inactive'
          order by (d.id = any($1)) desc, d.updated_at desc
          limit ${cap}`, [ranked]
      )).rows.sort((a, b) => {
        const i = ranked.indexOf(Number(a.id)), j = ranked.indexOf(Number(b.id));
        return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);   // keep the fused order
      });
      if (!cands.length) return res.json({ suggestions: [] });
      const viaSem = new Set(fused.filter((h) => String(h.via || "").includes("semantic")).map((h) => Number(h.id)));
      const rules = await rulesFor("drafting");
      const out = await runPipeline("qlegal-draft", {
        system: [rules.text, `A lawyer wants to draft a new contract. From the candidate contracts in the repository, pick the 2-5 BEST models to base the draft on (right type, right structure, closest subject). Return STRICT JSON only: {"suggestions":[{"id":<candidate id>,"fit":0-1,"why":"one line — why this is a good model"}]} ranked best first. Only ids from the list.`].filter(Boolean).join("\n\n"),
        user: `The ask: ${ask}\n\nCandidates (listed closest-first; "semantic_match" means it matched the ask by MEANING rather than shared words — often the better model):\n${JSON.stringify(cands.map((c) => ({ id: Number(c.id), name: c.name, type: c.doc_type, parties: [c.party1, c.party2].filter(Boolean), summary: clip(c.summary, 200), tags: c.tags, semantic_match: viaSem.has(Number(c.id)) || undefined })))}`,
        maxTokens: 800,
      });
      await logRun(out, { ref_type: "draft", rules: rules.codes, input: ask, output: "suggest models" });
      const sp = jparse(out.text) || {};
      const byId = Object.fromEntries(cands.map((c) => [Number(c.id), c]));
      const suggestions = (Array.isArray(sp.suggestions) ? sp.suggestions : [])
        .filter((x) => byId[Number(x.id)]).slice(0, 6)
        .map((x) => ({ ...byId[Number(x.id)], fit: Number(x.fit) || 0, why: clip(x.why, 200) }));
      // no model / parse miss → fall back to the prefilter order so the flow never dead-ends
      res.json({ suggestions: suggestions.length ? suggestions : cands.slice(0, 4).map((c) => ({ ...c, fit: 0, why: "closest match in the repository (no keyed model to rank)" })), mode: out.mode });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  app.post("/api/qlegal/draft/run", async (req, res) => {
    const ask = clip(req.body?.ask, 600).trim();
    const DP = await ruleParams("drafting");
    const ids = (req.body?.model_ids || []).slice(0, DP.max_models).map(Number).filter(Boolean);
    if (!ask || !ids.length) return res.status(400).json({ error: "the ask + at least one model contract" });
    try {
      const models = (await q(
        `select d.id, coalesce(d.title, d.filename) as name, d.doc_type, v.c1_text, v.c2
           from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
          where d.id = any($1)`, [ids]
      )).rows;
      const rules = await rulesFor("drafting");
      const modelBlock = models.map((m) => {
        const c2 = m.c2 || {};
        const contents = (c2.contents || []).map((x) => `${x.ref || ""} ${x.heading || ""}`).join(" · ");
        return `MODEL [${m.id}] ${m.name} (${m.doc_type || "?"})\n STRUCTURE: ${contents || "—"}\n TEXT (for standard positions & voice):\n${clip(m.c1_text, DP.model_read_chars)}`;
      }).join("\n\n");
      const out = await runPipeline("qlegal-draft", {
        system: [rules.text, `Draft a COMPLETE first-draft contract in proper legal voice, as clean Markdown (# title, ## clause headings, numbered clauses).
The MODELS define the skeleton and the house's standard positions: include EVERY section the models consider standard (definitions, notices, severability, entire agreement, governing law…) even if the ask doesn't mention them — completeness comes from the models, not the prompt. Take particulars (parties, subject, term, commercials) from the ask; where the ask is silent, use the models' standard position; where nothing exists, insert [BRACKETED PLACEHOLDERS]. Never copy party names from the models. End with a signature block.`].filter(Boolean).join("\n\n"),
        user: `The ask: ${ask}\n\n${modelBlock}`,
        maxTokens: DP.max_tokens,
      });
      await logRun(out, { ref_type: "draft", rules: rules.codes, input: ask, output: `draft from models ${ids.join(",")}` });
      if (out.mode !== "ai") return res.json({ error: "no keyed model — point qlegal-draft at one in AI Skills & Pipelines" });
      const md = clip(out.text, 200000).replace(/^```(markdown)?\n?/i, "").replace(/\n?```$/, "");
      const row = (await q(`insert into ql_draft(ask, model_ids, draft_md) values($1,$2::jsonb,$3) returning id, created_at`,
        [ask, JSON.stringify(ids), md])).rows[0];
      res.json({ draft: { id: row.id, ask, model_ids: ids, draft_md: md, created_at: row.created_at, models: models.map((m) => ({ id: m.id, name: m.name })) } });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  app.get("/api/qlegal/drafts", async (_req, res) => {
    res.json({ drafts: (await q(`select id, ask, model_ids, status, created_at from ql_draft order by id desc limit 50`)).rows });
  });
  app.get("/api/qlegal/draft/:id", async (req, res) => {
    const d = (await q(`select * from ql_draft where id=$1`, [Number(req.params.id)])).rows[0];
    if (!d) return res.status(404).json({ error: "not found" });
    res.json({ draft: d });
  });
  // .docx download — the draft opens in Word and goes through the normal
  // SharePoint process (Q-Legal never writes to SharePoint)
  app.get("/api/qlegal/draft/:id/docx", async (req, res) => {
    const d = (await q(`select * from ql_draft where id=$1`, [Number(req.params.id)])).rows[0];
    if (!d) return res.status(404).send("not found");
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
      const paras = [];
      for (const raw of String(d.draft_md || "").split("\n")) {
        const line = raw.trimEnd();
        if (!line.trim()) { paras.push(new Paragraph({ text: "" })); continue; }
        const h1 = line.match(/^#\s+(.*)/), h2 = line.match(/^##+\s+(.*)/);
        if (h1) paras.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1 }));
        else if (h2) paras.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2 }));
        else {
          // **bold** runs; plain text otherwise
          const runs = []; let rest = line.replace(/^[-•]\s+/, "• ");
          while (rest.length) {
            const m = rest.match(/\*\*([^*]+)\*\*/);
            if (!m) { runs.push(new TextRun(rest)); break; }
            if (m.index > 0) runs.push(new TextRun(rest.slice(0, m.index)));
            runs.push(new TextRun({ text: m[1], bold: true }));
            rest = rest.slice(m.index + m[0].length);
          }
          paras.push(new Paragraph({ children: runs }));
        }
      }
      const doc = new Document({ sections: [{ children: paras }] });
      const buf = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="Draft-${d.id}.docx"`);
      res.send(buf);
    } catch (e) { res.status(500).send(clip(e.message, 200)); }
  });

  // ---- Registers — the open-ended layer: whatever the legal team asks ----------
  // The SETS a reviewer can run: which contract types each targets, how many
  // questions it holds, and — for one document — whether it fits that contract.
  app.get("/api/qlegal/register-sets", async (req, res) => {
    const docId = req.query.document_id ? Number(req.query.document_id) : null;
    const docType = docId
      ? (await q(`select doc_type from ql_document where id=$1`, [docId])).rows[0]?.doc_type || null
      : null;
    const rows = (await q(
      // count(DISTINCT r.id), not count(*). The LATERAL over doc_types fans each
      // question out to one row per document type, so a question tagged for 5 types
      // was counted 5 times: the picker offered "MSA & Services 27" against 7 real
      // questions, and running the set then read "7/27" — telling the reviewer that
      // 20 questions had failed when none had.
      `select coalesce(set_name,'Estate-wide') as set_name, count(distinct r.id)::int as questions,
              coalesce(jsonb_agg(distinct t) filter (where t is not null), '[]'::jsonb) as doc_types
         from ql_register r left join lateral jsonb_array_elements_text(coalesce(r.doc_types,'[]'::jsonb)) t on true
        where r.status='active' group by 1 order by (coalesce(set_name,'Estate-wide')='Estate-wide') desc, 1`
    )).rows;
    const sets = rows.map((r) => {
      const types = (r.doc_types || []).map(String);
      const fits = !types.length || (docType && types.some((t) => t.toLowerCase() === String(docType).toLowerCase()));
      return { ...r, doc_types: types, recommended: !!(docType && fits && types.length), fits };
    });
    let answered = {};
    if (docId) {
      const a = (await q(
        `select coalesce(r.set_name,'Estate-wide') s, count(*)::int c
           from ql_register_hit h join ql_register r on r.id=h.register_id
          where h.document_id=$1 group by 1`, [docId])).rows;
      answered = Object.fromEntries(a.map((x) => [x.s, x.c]));
    }
    res.json({ sets: sets.map((x) => ({ ...x, answered: answered[x.set_name] || 0 })), doc_type: docType });
  });

  // Run ONE set against ONE contract — the reviewer's "answer these for this
  // contract" action, rather than sweeping the estate.
  app.post("/api/qlegal/document/:id/registers/run", async (req, res) => {
    const id = Number(req.params.id);
    const set = clip(req.body?.set, 80).trim();
    try {
      const d = (await q(`select doc_type from ql_document where id=$1`, [id])).rows[0];
      if (!d) return res.status(404).json({ error: "not found" });
      const n = await runRegisters(id, { docType: d.doc_type, setName: set || null, ignoreScope: true });
      res.json({ ok: true, answered: n, set: set || "all applicable" });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  app.get("/api/qlegal/registers", async (_req, res) => {
    const registers = (await q(
      `select r.*,
              (select count(*) from ql_register_hit h where h.register_id=r.id) as answered,
              (select count(*) from ql_register_hit h where h.register_id=r.id and h.present='yes') as yes_count,
              (select count(*) from ql_register_hit h where h.register_id=r.id and h.present='unclear') as unclear_count
         from ql_register r order by r.builtin desc, r.id`
    )).rows;
    const total = Number((await q(`select count(*) c from ql_document`)).rows[0]?.c || 0);
    res.json({ registers, total_documents: total });
  });
  app.post("/api/qlegal/registers", async (req, res) => {
    const { name, question, extract_hint, doc_types } = req.body || {};
    if (!name || !question) return res.status(400).json({ error: "name + question required" });
    const code = clip(String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), 50) + "-" + Date.now().toString(36).slice(-4);
    const rows = (await q(
      `insert into ql_register(code, name, question, extract_hint, doc_types) values($1,$2,$3,$4,$5::jsonb) returning *`,
      [code, clip(name, 80), clip(question, 600), clip(extract_hint, 200), JSON.stringify(Array.isArray(doc_types) ? doc_types : [])]
    )).rows;
    res.json({ register: rows[0] });   // client then calls /registers/run to backfill the estate
  });
  app.post("/api/qlegal/register/:id", async (req, res) => {
    const { name, question, extract_hint, status } = req.body || {};
    const rows = (await q(
      `update ql_register set name=coalesce($2,name), question=coalesce($3,question),
        extract_hint=coalesce($4,extract_hint), status=coalesce($5,status), updated_at=now() where id=$1 returning *`,
      [Number(req.params.id), name ? clip(name, 80) : null, question ? clip(question, 600) : null,
       extract_hint !== undefined ? clip(extract_hint, 200) : null, ["active", "off"].includes(status) ? status : null]
    )).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ register: rows[0] });
  });
  app.delete("/api/qlegal/register/:id", async (req, res) => {
    await q(`delete from ql_register where id=$1`, [Number(req.params.id)]);   // cascades hits
    res.json({ ok: true });
  });

  // The estate-wide answer table for one standing question.
  app.get("/api/qlegal/register/:id/hits", async (req, res) => {
    const id = Number(req.params.id);
    const register = (await q(`select * from ql_register where id=$1`, [id])).rows[0];
    if (!register) return res.status(404).json({ error: "not found" });
    const hits = (await q(
      `select h.*, d.filename, d.title, d.doc_type, d.party1, d.party2
         from ql_register_hit h join ql_document d on d.id=h.document_id
        where h.register_id=$1
        order by (h.present='yes') desc, (h.present='unclear') desc, d.id`, [id]
    )).rows;
    const missing = Number((await q(
      `select count(*) c from ql_document d where not exists(select 1 from ql_register_hit h where h.register_id=$1 and h.document_id=d.id)`, [id]
    )).rows[0]?.c || 0);
    res.json({ register, hits, not_yet_answered: missing });
  });

  // Backfill sweep: answer the active registers for documents that don't have them
  // yet (a new question asked today gets answered across the whole estate).
  // Per-document persisted → resumable; capped per call so the request returns.
  app.post("/api/qlegal/registers/run", async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 25, 100);
    const registerId = req.body?.register_id ? Number(req.body.register_id) : null;
    try {
      const docs = (await q(
        `select d.id, d.doc_type from ql_document d
          where exists(select 1 from ql_version v where v.document_id=d.id and v.c1_text is not null)
            and exists(
              select 1 from ql_register r
               where r.status='active' and ($1::bigint is null or r.id=$1)
                 and (coalesce(jsonb_array_length(r.doc_types),0) = 0
                      or exists (select 1 from jsonb_array_elements_text(r.doc_types) t
                                  where lower(t) = lower(coalesce(d.doc_type,''))))
                 and not exists(select 1 from ql_register_hit h where h.register_id=r.id and h.document_id=d.id))
          order by d.id limit $2`, [registerId, limit]
      )).rows;
      let done = 0;
      for (const d of docs) { const n = await runRegisters(d.id, { docType: d.doc_type }).catch(() => 0); if (n) done++; }
      const remaining = Number((await q(
        `select count(*) c from ql_document d
          where exists(select 1 from ql_version v where v.document_id=d.id and v.c1_text is not null)
            and exists(select 1 from ql_register r where r.status='active' and ($1::bigint is null or r.id=$1)
                 and (coalesce(jsonb_array_length(r.doc_types),0) = 0
                      or exists (select 1 from jsonb_array_elements_text(r.doc_types) t
                                  where lower(t) = lower(coalesce(d.doc_type,''))))
              and not exists(select 1 from ql_register_hit h where h.register_id=r.id and h.document_id=d.id))`, [registerId]
      )).rows[0]?.c || 0);
      res.json({ processed: done, remaining });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // Correct a register answer — instantly authoritative + banked as a learning label.
  app.post("/api/qlegal/register-hit/:id", async (req, res) => {
    const { present, answer, value } = req.body || {};
    const cur = (await q(`select * from ql_register_hit where id=$1`, [Number(req.params.id)])).rows[0];
    if (!cur) return res.status(404).json({ error: "not found" });
    const rows = (await q(
      `update ql_register_hit set present=coalesce($2,present), answer=coalesce($3,answer), value=coalesce($4,value),
        status='corrected', updated_at=now() where id=$1 returning *`,
      [cur.id, ["yes", "no", "unclear"].includes(present) ? present : null,
       answer !== undefined ? clip(answer, 600) : null, value !== undefined ? clip(value, 200) : null]
    )).rows;
    await q(`insert into ql_feedback(surface, document_id, field, was, corrected, actor) values('register',$1,$2,$3,$4,'you')`,
      [cur.document_id, `register:${cur.register_id}`, clip(`${cur.present} — ${cur.answer}`, 400), clip(`${present || cur.present} — ${answer ?? cur.answer}`, 400)]).catch(() => {});
    res.json({ hit: rows[0] });
  });

  // ---- obligations (the task engine) ------------------------------------------
  app.get("/api/qlegal/obligations", async (_req, res) => {
    const rows = (await q(
      `select o.*, d.filename, d.title, d.doc_type from ql_obligation o join ql_document d on d.id=o.document_id
        where o.status <> 'dismissed' order by o.due_date nulls last, o.id limit 500`
    )).rows;
    res.json({ obligations: rows });
  });
  app.post("/api/qlegal/obligation/:id", async (req, res) => {
    const { status, owner } = req.body || {};
    const allowed = ["proposed", "confirmed", "done", "dismissed"];
    const rows = (await q(
      `update ql_obligation set status=coalesce($2,status), owner=coalesce($3,owner), updated_at=now() where id=$1 returning *`,
      [Number(req.params.id), allowed.includes(status) ? status : null, owner !== undefined ? clip(owner, 80) : null]
    )).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ obligation: rows[0] });
  });

  // ---- confirm queue (one queue for every AI proposal) -------------------------
  app.get("/api/qlegal/confirms", async (_req, res) => {
    const rows = (await q(
      `select c.*, d.filename, d.title, d.party1, d.party2, d.doc_type,
              p.title as parent_title, p.filename as parent_filename
         from ql_confirm c
         left join ql_document d on d.id=c.document_id
         left join ql_document p on p.id = nullif(c.proposal->>'parent_id','')::bigint
        where c.status='open' and not c.blocked
        order by (c.kind='removal') desc, c.confidence asc nulls first, c.id desc limit 200`
    )).rows;
    res.json({ confirms: rows });
  });
  // ---- batch confirm: the only way classification survives 1000 contracts ----
  // Evidence is homogeneous within a kind, so answering 12 identical questions
  // one at a time is a UI failure, not diligence. Each row still resolves through
  // the SAME path as a single decision — same accept logic, same feedback label,
  // same suppression on reject — so a batch can never take a shortcut a single
  // decision wouldn't.
  app.post("/api/qlegal/confirms/batch", async (req, res) => {
    // ids may be plain numbers OR {id, doc_type} — because "Accept all" used to send
    // ids only and one shared doc_type, so a classification the reviewer CORRECTED
    // on a card was thrown away and the AI's original guess was filed instead, then
    // marked doc_type_confirmed. The dialog explicitly told them to change any they
    // disagreed with first.
    const raw = (req.body?.ids || []).slice(0, 200);
    const items = raw.map((x) => (typeof x === "object" && x
      ? { id: Number(x.id), doc_type: x.doc_type || null }
      : { id: Number(x), doc_type: null })).filter((x) => x.id);
    const action = req.body?.action;
    if (!items.length || !["accept", "reject"].includes(action)) return res.status(400).json({ error: "ids + action required" });
    const ids = items.map((x) => x.id);
    let done = 0; const errors = [];
    for (const it of items) {
      try {
        await resolveConfirm(it.id, { action,
          doc_type: it.doc_type || req.body?.doc_type,   // the card's own pick wins
          reason: req.body?.reason,
          by: req.acct?.user || "unknown" });            // never req.body.by
        done++;
      } catch (e) { errors.push({ id: it.id, error: clip(e.message, 120) }); }
    }
    res.json({ resolved: done, errors });
  });

  // ---- the learning ledger: proof the queue is shrinking ---------------------
  // Without this the queue is data entry. With it you can see last month's
  // answers making this month's list shorter — which is the whole promise.
  app.get("/api/qlegal/confirms/ledger", async (_req, res) => {
    const one = async (sql, p = []) => Number((await q(sql, p)).rows[0]?.c || 0);
    const [d30, d7, open, blocked, suppressed] = await Promise.all([
      one(`select count(*) c from ql_confirm where status<>'open' and resolved_at > now() - interval '30 days'`),
      one(`select count(*) c from ql_confirm where status<>'open' and resolved_at > now() - interval '7 days'`),
      one(`select count(*) c from ql_confirm where status='open' and not blocked`),
      one(`select count(*) c from ql_confirm where status='open' and blocked`),
      one(`select count(*) c from ql_confirm where status='rejected' and proposal_key is not null`),
    ]);
    // classification confidence now vs before the oldest decision in the window
    const conf = (await q(
      `select round(avg((facts->>'doc_type_confidence')::numeric) * 100) as pct,
              count(*) filter (where (facts->>'doc_type_confirmed')='true') as confirmed,
              count(*) as total
         from ql_document where coalesce(status,'active')<>'inactive' and facts ? 'doc_type_confidence'`
    ).catch(() => ({ rows: [] }))).rows[0] || {};
    // the reasons people gave — a reason recurring across documents is a rule
    const reasons = (await q(
      `select reason, count(*) c from ql_confirm
        where status='rejected' and reason is not null and reason <> ''
        group by reason order by c desc limit 6`
    ).catch(() => ({ rows: [] }))).rows;
    res.json({ decided_30d: d30, decided_7d: d7, open, blocked, suppressed,
      confidence_pct: conf.pct != null ? Number(conf.pct) : null,
      confirmed: Number(conf.confirmed || 0), classified: Number(conf.total || 0), reasons });
  });

  // ONE resolve path, used by both the single decision and the batch — so a
  // batch can never take a shortcut a single confirm wouldn't (same accept
  // effects, same feedback label, same rejection suppression).
  async function resolveConfirm(id, { action, doc_type, reason, by } = {}) {
    const c = (await q(`select * from ql_confirm where id=$1 and status='open'`, [id])).rows[0];
    if (!c) throw new Error("not found or already resolved");
    if (action === "accept") {
      const p = c.proposal || {};
      if (c.kind === "link" && p.parent_id) {
        await q(`update ql_document set parent_id=$2, relation_kind=$3, relation_status='confirmed', updated_at=now() where id=$1`,
          [c.document_id, p.parent_id, p.relation_kind || "references"]);
      } else if (c.kind === "lineage" && p.other_id) {
        await q(`update ql_document set parent_id=$2, relation_kind='executed_of', relation_status='confirmed', updated_at=now() where id=$1`,
          [c.document_id, p.other_id]);
      } else if (c.kind === "classification") {
        const t = clip(doc_type || p.doc_type, 40);
        if (t) await q(`update ql_document set doc_type=$2,
            facts = jsonb_set(coalesce(facts,'{}'::jsonb), '{doc_type_confirmed}', 'true'::jsonb, true),
            updated_at=now() where id=$1`, [c.document_id, t]);
      } else if (c.kind === "removal") {
        // gone from SharePoint → INACTIVE, never deleted: the derived layer keeps
        // the full record (facts, obligations, timeline) for the paper trail
        await q(`update ql_document set status='inactive', updated_at=now() where id=$1`, [c.document_id]);
        await q(`update ql_obligation set status='dismissed' where document_id=$1 and status in ('proposed','confirmed')`, [c.document_id]).catch(() => {});
      }
    }
    // a rejection records WHY and pins the proposal key, so this exact suggestion
    // is never re-made and the reason becomes a learning label
    await q(`update ql_confirm set status=$2, resolved_by=$3, reason=$4,
              proposal_key=coalesce(proposal_key,$5), resolved_at=now() where id=$1`,
      [id, action === "accept" ? "accepted" : "rejected", clip(by, 40) || "you",
       action === "reject" ? clip(reason, 200) || null : null,
       proposalKey(c.kind, c.proposal || {})]);
    // every confirmation is a learning label (append-only)
    await q(`insert into ql_feedback(surface, document_id, field, was, corrected, note, actor) values('confirm',$1,$2,$3,$4,$5,$6)`,
      [c.document_id, c.kind, JSON.stringify(c.proposal), action, clip(c.why, 240), clip(by, 40) || "you"]).catch(() => {});
    return c;
  }

  app.post("/api/qlegal/confirm/:id", async (req, res) => {
    const { action } = req.body || {};
    if (!["accept", "reject"].includes(action)) return res.status(400).json({ error: "action must be accept|reject" });
    try { await resolveConfirm(Number(req.params.id), req.body || {}); res.json({ ok: true }); }
    catch (e) { res.status(404).json({ error: clip(e.message, 120) }); }
  });

  // ---- Legal Setting: the growing category taxonomy -----------------------------
  app.get("/api/qlegal/categories", async (_req, res) => {
    const rows = (await q(
      `select c.*, (select count(*) from ql_document d where lower(d.doc_type)=lower(c.name)) as docs
         from ql_category c where c.status='active' order by docs desc, c.name`
    )).rows;
    res.json({ categories: rows });
  });
  app.post("/api/qlegal/categories", async (req, res) => {
    const name = clip(req.body?.name, 40).trim();
    if (!name) return res.status(400).json({ error: "name required" });
    const rows = (await q(`insert into ql_category(name, source) values($1,'human') on conflict (name) do update set status='active' returning *`, [name])).rows;
    res.json({ category: rows[0] });
  });
  // set/override a document's category (human decision — authoritative + learned)
  app.post("/api/qlegal/document/:id/category", async (req, res) => {
    const id = Number(req.params.id);
    const name = clip(req.body?.doc_type, 40).trim();
    if (!name) return res.status(400).json({ error: "doc_type required" });
    const was = (await q(`select doc_type from ql_document where id=$1`, [id])).rows[0]?.doc_type;
    await q(`insert into ql_category(name, source) values($1,'human') on conflict (name) do nothing`, [name]).catch(() => {});
    await q(`update ql_document set doc_type=$2, facts = jsonb_set(coalesce(facts,'{}'::jsonb), '{doc_type_confirmed}', 'true'::jsonb, true), updated_at=now() where id=$1`, [id, name]);
    await q(`update ql_confirm set status='accepted', resolved_by='you', resolved_at=now() where document_id=$1 and kind='classification' and status='open'`, [id]).catch(() => {});
    await q(`insert into ql_feedback(surface, document_id, field, was, corrected, actor) values('classification',$1,'doc_type',$2,$3,'you')`, [id, was || "", name]).catch(() => {});
    res.json({ ok: true, doc_type: name });
  });

  // category controls: rename shown in UI as off/on (off = hidden from the
  // classifier + pickers; existing docs keep their label)
  app.post("/api/qlegal/category/:id", async (req, res) => {
    const status = ["active", "off"].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: "status must be active|off" });
    const rows = (await q(`update ql_category set status=$2 where id=$1 returning *`, [Number(req.params.id), status])).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ category: rows[0] });
  });
  // the tag vocabulary (with usage counts) + hygiene
  app.get("/api/qlegal/tags", async (_req, res) => {
    const rows = (await q(
      `select v.tag, v.kind, (select count(*) from ql_document d where d.tags ? v.tag) as docs
         from ql_tag_vocab v order by docs desc, v.tag`
    )).rows;
    res.json({ tags: rows });
  });
  app.delete("/api/qlegal/tag/:tag", async (req, res) => {
    const tag = clip(decodeURIComponent(req.params.tag), 60);
    await q(`delete from ql_tag_vocab where tag=$1`, [tag]);
    await q(`update ql_document set tags = tags - $1 where tags ? $1`, [tag]).catch(() => {});  // strip from docs too
    res.json({ ok: true });
  });

  // ---- legal concepts (the search thesaurus) ------------------------------------
  app.get("/api/qlegal/concepts", async (_req, res) => {
    res.json({ concepts: (await q(`select * from ql_concept order by builtin desc, name`)).rows });
  });
  app.post("/api/qlegal/concepts", async (req, res) => {
    const name = clip(req.body?.name, 80).trim();
    const terms = (Array.isArray(req.body?.terms) ? req.body.terms : String(req.body?.terms || "").split(","))
      .map((t) => clip(String(t).trim().toLowerCase(), 60)).filter(Boolean).slice(0, 60);
    if (!name || !terms.length) return res.status(400).json({ error: "name + at least one phrasing" });
    const rows = (await q(
      `insert into ql_concept(name, terms) values($1,$2::jsonb)
       on conflict (name) do update set terms=excluded.terms, status='active' returning *`,
      [name, JSON.stringify(terms)])).rows;
    _concepts.at = 0;   // bust the cache
    res.json({ concept: rows[0] });
  });
  app.post("/api/qlegal/concept/:id", async (req, res) => {
    const terms = req.body?.terms !== undefined
      ? (Array.isArray(req.body.terms) ? req.body.terms : String(req.body.terms).split(",")).map((t) => clip(String(t).trim().toLowerCase(), 60)).filter(Boolean).slice(0, 60)
      : null;
    const status = ["active", "off"].includes(req.body?.status) ? req.body.status : null;
    const rows = (await q(`update ql_concept set terms=coalesce($2::jsonb, terms), status=coalesce($3, status) where id=$1 returning *`,
      [Number(req.params.id), terms ? JSON.stringify(terms) : null, status])).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    _concepts.at = 0;
    res.json({ concept: rows[0] });
  });
  app.delete("/api/qlegal/concept/:id", async (req, res) => {
    await q(`delete from ql_concept where id=$1 and not builtin`, [Number(req.params.id)]);
    _concepts.at = 0;
    res.json({ ok: true });
  });

  // ---- business rules (editable; injected into the pipelines by scope) ---------
  app.get("/api/qlegal/rules", async (_req, res) => {
    res.json({ rules: (await q(`select * from ql_rule order by scope, id`)).rows });
  });
  app.post("/api/qlegal/rules", async (req, res) => {
    const { title, body, scope } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title + body required" });
    const code = clip(String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), 60) + "-" + Date.now().toString(36).slice(-4);
    const rows = (await q(`insert into ql_rule(code, title, body, scope) values($1,$2,$3,$4) returning *`,
      [code, clip(title, 160), clip(body, 2000), SCOPES.includes(scope) ? scope : "global"])).rows;
    res.json({ rule: rows[0] });
  });
  app.post("/api/qlegal/rule/:id", async (req, res) => {
    const { title, body, scope, status, params } = req.body || {};
    const rows = (await q(
      `update ql_rule set title=coalesce($2,title), body=coalesce($3,body), scope=coalesce($4,scope),
        status=coalesce($5,status), params=coalesce($6::jsonb, params), version=version+1, updated_at=now() where id=$1 returning *`,
      [Number(req.params.id), title ? clip(title, 160) : null, body !== undefined ? clip(body, 2000) : null,
       SCOPES.includes(scope) ? scope : null,
       ["active", "off"].includes(status) ? status : null,
       params && typeof params === "object" ? JSON.stringify(params) : null]
    )).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ rule: rows[0] });
  });
  // the engine defaults behind each lever (so the UI can show "default: 60000")
  app.get("/api/qlegal/rule-defaults", (_req, res) => res.json({ defaults: RULE_PARAMS }));

  // ---- learning loop: corrections (Level 0 applies instantly) ------------------
  app.post("/api/qlegal/feedback", async (req, res) => {
    const { surface, document_id, field, was, corrected, note } = req.body || {};
    if (!surface) return res.status(400).json({ error: "surface required" });
    await q(`insert into ql_feedback(surface, document_id, field, was, corrected, note, actor) values($1,$2,$3,$4,$5,$6,'you')`,
      [clip(surface, 30), document_id || null, clip(field, 60), clip(was, 400), clip(corrected, 400), clip(note, 400)]);
    // Level 0: a fact correction fixes the registry at source, instantly
    if (surface === "fact" && document_id && field && corrected !== undefined) {
      const COLS = new Set(["title", "doc_type", "counterparty", "party1", "party2", "status"]);
      if (COLS.has(field)) await q(`update ql_document set ${field}=$2, updated_at=now() where id=$1`, [document_id, clip(corrected, 200)]);
      await q(`update ql_document set facts = jsonb_set(coalesce(facts,'{}'::jsonb), array[$2], to_jsonb($3::text), true), updated_at=now() where id=$1`,
        [document_id, clip(field, 60), clip(corrected, 400)]).catch(() => {});
    }
    res.json({ ok: true, learned: true });
  });

  // ---- activity log -------------------------------------------------------------
  app.get("/api/qlegal/log", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ log: (await q(`select * from ql_log order by id desc limit $1`, [limit])).rows });
  });

  // ---- purge: empty the repository and start again --------------------------
  // Deliberately explicit: requires {confirm:"PURGE"} in the body, reports exactly
  // what it removed, and never touches the SOURCE. SharePoint documents are not
  // deleted anywhere but here — the next scan will simply re-ingest them, which is
  // the point: the derived layer is rebuildable, so emptying it is safe.
  // Device uploads are the exception worth knowing: their vault snapshot is the
  // ONLY copy, so purging one is permanent. That count is reported before the fact.
  app.get("/api/qlegal/purge", async (_req, res) => {
    const one = async (sql) => Number((await q(sql)).rows[0]?.c || 0);
    const [docs, sp, dev, versions, vectors] = await Promise.all([
      one(`select count(*) c from ql_document`),
      one(`select count(*) c from ql_document where source='sharepoint'`),
      one(`select count(*) c from ql_document where source<>'sharepoint'`),
      one(`select count(*) c from ql_version`),
      one(`select count(*) c from ql_embedding`).catch(() => 0),
    ]);
    res.json({ documents: docs, from_sharepoint: sp, from_device: dev, versions, vectors,
      note: dev ? `${dev} device upload${dev === 1 ? "" : "s"} would be lost permanently — there is no source to re-fetch them from.` : null });
  });
  app.post("/api/qlegal/purge", async (req, res) => {
    if (req.body?.confirm !== "PURGE") return res.status(400).json({ error: 'send {"confirm":"PURGE"} to proceed' });
    const before = Number((await q(`select count(*) c from ql_document`)).rows[0]?.c || 0);
    // ql_document cascades to version, obligation, confirm, register_hit, embedding
    await q(`delete from ql_document`);
    // the derived layer only — learning labels and the AI log are append-only history
    await q(`delete from ql_confirm`).catch(() => {});
    // reset the SharePoint delta cursor, or the next scan sees "no changes" and
    // re-ingests nothing — the single most confusing way to purge (looks broken)
    await q(`update ql_sync set delta_link=null where id=1`).catch(() => {});
    res.json({ ok: true, purged: before,
      note: "Derived layer emptied and the SharePoint delta cursor reset, so the next scan re-ingests the whole library from scratch. Business rules, standing questions, categories, tags and the AI activity log were kept." });
  });

  // ---- Re-index & sweep: the repo's maintenance console -------------------------
  // Everything here is capped + resumable (call again to continue) and reuses the
  // ingestion pipeline itself — a sweep can never diverge from ingestion.
  app.get("/api/qlegal/sweep/status", async (_req, res) => {
    const one = async (sql, params = []) => Number((await q(sql, params)).rows[0]?.c || 0);
    const [total, inactive, unclassified, stubKeyed, errors, unlinked, regPending, sp] = await Promise.all([
      one(`select count(*) c from ql_document where coalesce(status,'active')<>'inactive'`),
      one(`select count(*) c from ql_document where status='inactive'`),
      one(`select count(*) c from ql_document where doc_type is null and coalesce(status,'active')<>'inactive'`),
      one(`select count(*) c from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
            where coalesce(d.status,'active')<>'inactive' and (v.c2 is null or v.c2->>'mode' is distinct from 'ai')`),
      one(`select count(*) c from ql_version where status='error'`),
      one(`select count(*) c from ql_document d where coalesce(d.status,'active')<>'inactive' and d.parent_id is null
            and not exists(select 1 from ql_document k where k.parent_id=d.id)
            and not exists(select 1 from ql_confirm c where c.document_id=d.id and c.kind in ('link','lineage') and c.status='open')`),
      one(`select count(*) c from ql_document d
            where coalesce(d.status,'active')<>'inactive'
              and exists(select 1 from ql_version v where v.document_id=d.id and v.c1_text is not null)
              and exists(select 1 from ql_register r where r.status='active'
                and not exists(select 1 from ql_register_hit h where h.register_id=r.id and h.document_id=d.id))`),
      q(`select last_run, last_result, delta_link is not null as delta, config<>'{}'::jsonb as configured from ql_sync where id=1`).then((r) => r.rows[0]),
    ]);
    const vectors = await embedStatus().catch(() => ({ available: false }));
    res.json({ total, inactive, unclassified, stub_keyed: stubKeyed, error_versions: errors, unlinked, registers_pending: regPending, sharepoint: sp || {}, vectors });
  });

  // embed sweep: vectors for documents missing them under the CURRENT model —
  // a model swap in Admin makes the estate pending again; sweep = the re-embed
  // migration (both generations coexist until cutover; retrieval never mixes them)
  app.post("/api/qlegal/sweep/embed", async (req, res) => {
    try { res.json(await embedSweep(Math.min(Number(req.body?.limit) || 10, 50))); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // ---- the vector wiki: estate map + emergent clause library --------------------
  app.get("/api/qlegal/estate-map", async (_req, res) => {
    try { res.json(await estateMap()); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });
  // what the semantic index actually holds for one document (the coverage panel)
  // The clause wiki + the contract's own reference graph. Served from the clause
  // table, so it is the whole document — not whatever survived a model call.
  app.get("/api/qlegal/clauses/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [clauses, edges] = await Promise.all([clauseWiki(id), clauseEdges(id)]);
      res.json({
        clauses, edges,
        stats: { clauses: clauses.length, labelled: clauses.filter((c) => c.label).length,
          edges: edges.length, unresolved: edges.filter((e) => !e.resolved).length },
      });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // the parent routing map — the estate meta-wiki
  // The persistent batch: what is running, what each document did, and what is
  // waiting on a human. Poll-able from anywhere, because it lives in the database
  // and not in the tab that started it.
  app.get("/api/qlegal/batch/:id", async (req, res) => {
    try {
      const id = req.params.id === "latest"
        ? (await q(`select id from ql_batch order by id desc limit 1`)).rows[0]?.id
        : Number(req.params.id);
      if (!id) return res.json({ batch: null, items: [] });
      const batch = (await q(`select * from ql_batch where id=$1`, [id])).rows[0] || null;
      const items = (await q(`select * from ql_batch_item where batch_id=$1 order by ord`, [id])).rows;
      // a batch whose request died leaves items queued — say so rather than
      // showing a spinner that will never resolve
      const stalled = batch && batch.status === "done" && items.some((x) => x.stage === "queued" || x.stage === "reading");
      res.json({ batch, items, stalled });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // Accept or reject a blocked document. Rejecting is a real decision, recorded
  // against the item — not a dialog the user dismissed and cannot revisit.
  app.post("/api/qlegal/batch/item/:id/decide", async (req, res) => {
    const d = String(req.body?.decision || "");
    if (!["accept", "reject"].includes(d)) return res.status(400).json({ error: "decision must be accept or reject" });
    try {
      const row = (await q(
        `update ql_batch_item set decision=$2, decided_at=now(), updated_at=now() where id=$1 returning *`,
        [Number(req.params.id), d])).rows[0];
      // rejecting removes the half-read document from the repository, which is the
      // whole point of a gate: a contract nobody vouched for should not be answerable
      if (row && d === "reject" && row.document_id)
        await q(`update ql_document set status='inactive', updated_at=now() where id=$1`, [row.document_id]).catch(() => {});
      res.json({ ok: true, item: row });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  // Is the semantic spine healthy? Reported separately from ingest-readiness
  // because it warns rather than blocks — a contract with hash vectors is still
  // read, keyed, atomized, searchable and citable; only ranking suffers.
  app.get("/api/qlegal/embed-health", async (_req, res) => {
    try { res.json(await embedHealth()); }
    catch (e) { res.json({ ok: false, degraded: true, reason: String(e.message || e) }); }
  });

  mountJobs("qlegal", app);

  app.get("/api/qlegal/estate-wiki", async (_req, res) => {
    try { res.json(await estateWiki({})); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.get("/api/qlegal/coverage/:id", async (req, res) => {
    try { res.json(await docCoverage(Number(req.params.id))); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });
  app.get("/api/qlegal/clause-library", async (req, res) => {
    try { res.json(await clauseLibrary({ k: req.query.k ? Number(req.query.k) : undefined })); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // refresh C2/derived for documents whose key is a no-model stub — or everything
  app.post("/api/qlegal/sweep/refresh", async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 10, 50);
    const all = req.body?.scope === "all";
    try {
      const docs = (await q(
        `select d.id from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
          where coalesce(d.status,'active')<>'inactive' and v.c1_text is not null
            ${all ? "" : "and (v.c2 is null or v.c2->>'mode' is distinct from 'ai')"}
          order by d.id limit $1`, [limit]
      )).rows;
      let done = 0;
      for (const d of docs) { const r = await refreshDoc(d.id).catch(() => null); if (r) done++; }
      const remaining = Math.max(0, (await q(
        `select count(*) c from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
          where coalesce(d.status,'active')<>'inactive' and v.c1_text is not null
            ${all ? "" : "and (v.c2 is null or v.c2->>'mode' is distinct from 'ai')"}`
      )).rows[0].c - (all ? done : 0));
      res.json({ processed: done, remaining: all ? remaining : Number((await q(
        `select count(*) c from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version
          where coalesce(d.status,'active')<>'inactive' and v.c1_text is not null and (v.c2 is null or v.c2->>'mode' is distinct from 'ai')`
      )).rows[0].c) });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // build families & dependencies for documents that have neither links nor proposals
  app.post("/api/qlegal/sweep/families", async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 15, 50);
    try {
      const cand = (await q(
        `select d.id from ql_document d
          where coalesce(d.status,'active')<>'inactive' and d.parent_id is null
            and exists(select 1 from ql_version v where v.document_id=d.id and v.c1_text is not null)
            and not exists(select 1 from ql_confirm c where c.document_id=d.id and c.kind in ('link','lineage') and c.status<>'rejected')
          order by d.id limit $1`, [limit]
      )).rows;
      for (const d of cand) { await proposeLinks(d.id).catch(() => {}); await proposeLineage(d.id).catch(() => {}); }
      const proposals = Number((await q(`select count(*) c from ql_confirm where kind in ('link','lineage') and status='open'`)).rows[0].c);
      res.json({ examined: cand.length, open_proposals: proposals });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  // ---- SharePoint scanner: settings · test · scan now · nightly 02:00 IST -------
  app.get("/api/qlegal/sharepoint", async (_req, res) => {
    res.json(publicSyncConfig(await getSyncRow()));   // secret never leaves the server
  });
  app.post("/api/qlegal/sharepoint", async (req, res) => {
    try { res.json(await saveSyncConfig(req.body || {})); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });
  app.post("/api/qlegal/sharepoint/test", async (_req, res) => res.json(await testSharePoint()));
  // live read-only browse of the library (folders + files + indexed cross-refs)
  app.get("/api/qlegal/sharepoint/files", async (req, res) => {
    try { res.json(await listSharePoint({ folder: clip(req.query.folder, 300), search: clip(req.query.q, 100) })); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });
  app.post("/api/qlegal/sharepoint/ingest", async (req, res) => {
    if (!req.body?.item_id) return res.status(400).json({ error: "item_id required" });
    try { res.json(await ingestSharePointItem(ingestFile, String(req.body.item_id))); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });
  app.post("/api/qlegal/sharepoint/scan", async (req, res) => {
    try { res.json(await scanSharePoint(ingestFile, { full: !!req.body?.full })); }
    catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
  });

  scheduleNightlyScan(ingestFile);   // the 02:00 IST nightly scan (in-process)
}
