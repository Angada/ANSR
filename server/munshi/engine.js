// Munshi-for-Mint orchestrator — the public API the routes call.
//   registerCorpusDoc  — add a doc (SOW / amendment / …) to the living corpus
//   intakeCorpus       — parse the whole corpus → chips (first build / rebuild)
//   reparse            — re-parse ONLY the docs whose content hash moved (delta),
//                        preserving human-confirmed chips (the Munshi invariant)
//   ruleBookFromChips  — assemble the executable rule book from confirmed chips
//   getChipGroups      — the UI view: 7 boxes as chip groups + corpus + conflicts
import { runPipeline } from "../ai.js";
import { getExtract, putExtract } from "../storage.js";
import { stubAnalysis } from "../stub.js";
import { compileRuleBook } from "../engine/rulebook.js";
import { chunkDoc, docHash, diffChunks } from "./chunk.js";
import { boxToChips, chipsToBoxes, chipsToContent } from "./atomize.js";
import * as store from "./mstore.js";

// The JSON-shape instruction layered on the contract-intake pipeline's own prompt.
// (Mirrors index.js BOX_PROMPT — the boxes are Mint's calc contract; we atomize
// them deterministically afterwards, so the model never sees "chips".)
export const BOX_PROMPT = `From the contract below, output STRICT JSON only — no prose, no code fences:
{"summary":{"title":"Contract summary","text":"<2-4 sentences>"},
 "findings":["<key billing fact>", ...],
 "boxes":[{"box_type_code":"company|legal|payment_terms|commercial_terms|billing_rules|caveats|flags",
   "title":"<short>","ai_explain":"<1-2 sentences>","content":{<key:value facts; arrays of objects for tables>},
   "confidence":0.0-1.0,"clause_ref":"§<n>"}]}
Always include a "billing_rules" box with the executable TA/OSS/milestone logic (ctc_definition, ta_rate_table, milestones, oss_slabs, currency). Cite the clause for every box.
This document may be an AMENDMENT — emit boxes ONLY for the terms it actually changes or adds; omit boxes it doesn't touch.`;

// ---- register a corpus doc ---------------------------------------------------
// docId is the docstore id from /api/upload. role orders the corpus (primary_sow
// first). Returns the contract_doc id.
export async function registerCorpusDoc(client, { doc_id, document_id, role = "primary_sow", title, effective_date, ord } = {}) {
  if (!doc_id) throw new Error("doc_id required");
  const existing = await store.listCorpus(client);
  // primary first; amendments/others after, ordered by insertion unless given
  const autoOrd = role === "primary_sow" ? 0 : (existing.length + 1);
  const id = await store.upsertCorpusDoc(client, {
    doc_id, document_id: document_id || null, role, title: title || null,
    effective_date: effective_date || null, ord: ord ?? autoOrd,
  });
  return { ok: !!id, contract_doc_id: id, role };
}

// ---- parse one doc's md → boxes (AI via contract-intake, stub fallback) -------
export async function parseBoxes(client, md) {
  try {
    const out = await runPipeline("contract-intake", { system: BOX_PROMPT, user: String(md).slice(0, 60000), maxTokens: 4000 });
    if (out.mode === "ai" && out.text) {
      const m = out.text.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        const boxes = (j.boxes || []).map((b) => ({
          box_type_code: b.box_type_code, title: b.title, ai_explain: b.ai_explain,
          content: b.content || {}, confidence: b.confidence ?? 0.8, clause_ref: b.clause_ref || "",
        }));
        if (boxes.length) return { boxes, summary: j.summary, findings: j.findings || [], source: `ai:${out.model}` };
      }
    }
    const a = stubAnalysis(client);
    return { boxes: a.boxes, summary: a.summary, findings: a.findings, source: out.mode === "ai" ? "ai-parse-failed" : `no-ai(${out.mode})` };
  } catch {
    const a = stubAnalysis(client);
    return { boxes: a.boxes, summary: a.summary, findings: a.findings, source: "error" };
  }
}

// match a box's clause_ref (e.g. "SOW §3.1 · §3.3") to this doc's chunks → the
// chunk hashes that back it (provenance + the re-parse change detector).
function chunksForBox(box, chunks) {
  const refs = (String(box.clause_ref || "").match(/§\s?\d+(?:\.\d+)*/g) || []).map((s) => s.replace(/\s/g, ""));
  return chunks.filter((c) => refs.includes(c.ref));
}

// chunk → save → parse → atomize (with provenance) → upsert. Shared by intake &
// reparse. Returns a per-doc result.
async function parseAndUpsertDoc(client, cd, { runId } = {}) {
  const md = await getExtract(client, cd.doc_id);
  if (!md) return { doc_id: cd.doc_id, skipped: "no extract" };
  const chunks = chunkDoc(md, { doc_id: cd.doc_id, contract_doc_id: cd.id, role: cd.role });
  const stored = await store.getChunks(client, cd.id);
  const diff = diffChunks(chunks, stored);
  const dh = docHash(chunks);
  await store.saveChunks(client, cd.id, chunks);
  await store.upsertCorpusDoc(client, { ...cd, source_hash: dh });

  const { boxes, source } = await parseBoxes(client, md);
  const chips = boxes.flatMap((box) => {
    const matched = chunksForBox(box, chunks);
    const prov = {
      doc_id: cd.doc_id, contract_doc_id: cd.id, role: cd.role,
      span: box.clause_ref || "", chunk_hashes: matched.map((m) => m.chunk_hash),
    };
    const src = matched[0]?.chunk_hash || dh;
    return boxToChips(box).map((ch) => ({ ...ch, provenance: prov, source_hash: src }));
  });
  const r = await store.upsertChips(client, chips, { runId, by: "ai" });
  return {
    doc_id: cd.doc_id, role: cd.role, source, boxes: boxes.length, chips: chips.length,
    changed_clauses: [...diff.changed, ...diff.added].map((c) => c.ref),
    removed_clauses: diff.removed.map((c) => c.ref),
    dirty: diff.dirty, doc_hash: dh, ...r, conflicts: r.conflicts,
  };
}

// ---- full corpus intake (build / rebuild all) --------------------------------
export async function intakeCorpus(client, { runId } = {}) {
  const corpus = await store.listCorpus(client);
  if (!corpus.length) return { ok: false, reason: "no corpus docs registered" };
  const docs = [];
  const totals = { inserted: 0, updated: 0, preserved: 0, conflicts: 0 };
  for (const cd of corpus) {
    const d = await parseAndUpsertDoc(client, cd, { runId });
    docs.push(d);
    totals.inserted += d.inserted || 0; totals.updated += d.updated || 0;
    totals.preserved += d.preserved || 0; totals.conflicts += (d.conflicts?.length || 0);
  }
  return { ok: true, client, docs, totals };
}

// ---- re-parse-on-change (delta only) -----------------------------------------
// Re-parse ONLY docs whose whole-doc hash moved; unchanged docs are skipped.
// Confirmed chips are preserved inside upsertChips. `force` re-parses everything.
export async function reparse(client, { force = false } = {}) {
  const corpus = await store.listCorpus(client);
  if (!corpus.length) return { ok: false, reason: "no corpus docs" };
  const docs = [];
  const totals = { inserted: 0, updated: 0, preserved: 0, conflicts: 0, reparsed: 0, skipped: 0 };
  for (const cd of corpus) {
    const md = await getExtract(client, cd.doc_id);
    if (!md) { docs.push({ doc_id: cd.doc_id, skipped: "no extract" }); totals.skipped++; continue; }
    const dh = docHash(chunkDoc(md, { doc_id: cd.doc_id, contract_doc_id: cd.id, role: cd.role }));
    if (!force && cd.source_hash && cd.source_hash === dh) {
      docs.push({ doc_id: cd.doc_id, role: cd.role, unchanged: true });
      totals.skipped++;
      continue;
    }
    const d = await parseAndUpsertDoc(client, cd, {});
    docs.push(d); totals.reparsed++;
    totals.inserted += d.inserted || 0; totals.updated += d.updated || 0;
    totals.preserved += d.preserved || 0; totals.conflicts += (d.conflicts?.length || 0);
  }
  return { ok: true, client, docs, totals };
}

// ---- calc read-path ----------------------------------------------------------
// The executable rule book assembled from the chip set (billing_rules group).
// Returns null when there are no chips → caller falls back to the stub path.
export async function ruleBookFromChips(client) {
  const chips = await store.getChips(client, { box_type: "billing_rules" });
  if (!chips.length) return null;
  const content = chipsToContent(chips);
  const rb = compileRuleBook({ content });
  rb._source = "chips";
  rb._provenance = chips.map((c) => ({ key: c.key, clause_ref: c.clause_ref, status: c.status, doc_id: c.provenance?.doc_id }));
  return rb;
}

// ---- UI view -----------------------------------------------------------------
const BOX_ORDER = ["billing_rules", "commercial_terms", "payment_terms", "company", "legal", "caveats", "flags"];
export async function getChipGroups(client) {
  const chips = await store.getChips(client);
  const boxes = chipsToBoxes(chips);
  const corpus = await store.listCorpus(client);
  // conflicts = confirmed chips an amendment wants to change (parked in provenance.pending)
  const conflicts = chips
    .filter((c) => c.provenance?.pending)
    .map((c) => ({ id: c.id, box_type: c.box_type, key: c.key, clause_ref: c.clause_ref, confirmed: c.value, proposed: c.provenance.pending }));
  // raw atomic chips grouped by box_type (for the Mint Reconciler / Rule book tabs)
  const g = {}; for (const c of chips) (g[c.box_type] ||= []).push(c);
  const chipGroups = BOX_ORDER.filter((b) => g[b]).map((b) => ({ box_type: b, chips: g[b] }))
    .concat(Object.keys(g).filter((b) => !BOX_ORDER.includes(b)).map((b) => ({ box_type: b, chips: g[b] })));
  return { client, boxes, corpus, conflicts, chip_count: chips.length, chips: chipGroups };
}

// Demo seed — when a client has no corpus doc (no upload), register a stub SOW so
// intake produces chips (parseBoxes falls back to stubAnalysis). Real uploads
// via /api/upload → registerCorpusDoc supersede this.
export async function seedStubCorpus(client) {
  if ((await store.getChips(client)).length) return { seeded: false };   // already has chips
  const docId = "sow-stub";
  try {
    await putExtract(client, docId, `# ${client} — SOW (stub)\nPlaceholder contract. Upload a real SOW to replace.`);
    const corpus = await store.listCorpus(client);
    if (!corpus.find((c) => c.doc_id === docId)) await registerCorpusDoc(client, { doc_id: docId, role: "primary_sow", title: "SOW (stub)" });
    return { seeded: true };
  } catch { return { seeded: false }; }
}

export { store as mstore };
