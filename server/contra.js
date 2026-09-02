// Contra — contract review app. Phase 1: the Archetype Maker.
// Upload a sample → Munshi/OCR extract → contra-archetype proposes the review
// SECTIONS → reviewer confirms/amends + tags Required → save as an archetype.
// Everything persists (draft rows) so you can leave and come back.
import { readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { q } from "./db/client.js";
import { extractFile } from "./extract.js";
import { runPipeline } from "./ai.js";
import { mountJobs, startJob, setItem, finishJob } from "./jobs.js";
import { buildReviewDocx } from "./contra-docx.js";
import { markupDocx } from "./contra-redline.js";

// Every column of contra_review EXCEPT the heavy/raw blobs (original_file bytea,
// contract_doc) — used for reads that don't need the original bytes, so we never
// serialise the uploaded file into a JSON response. The /docx route still SELECT *s.
const REVIEW_COLS = "id, batch_id, contract_name, archetype_id, archetype_ids, status, verdicts, findings, rule_checks, report, issue_count, run_mode, run_note, coverage, detect_confidence, detected, marked_doc_path, extract_md, original_ext, party1, party2, created_at, updated_at";

// snap LLM verdict keys onto the archetype's section keys (model-adherence safety)
// ---- canonical section vocabulary -----------------------------------------
// Section keys used to be whatever the model happened to emit, slugified. Two MSAs
// produced "commercial_terms" and "fees_and_payment" for the same theme, and
// "liability_and_liability_limits" and "liability_and_indemnity" for another.
// dedupOutlines keys on an EXACT string, so those did NOT merge: the same concept
// was verdicted twice under two names, both rule sets were sent to the model, and
// both counted toward issue_count — one contract inflating its own issue count.
// The archetype prompt now names a fixed vocabulary; this maps what earlier
// archetypes already stored onto the same keys, so old and new merge together.
const CANON_KEY = {
  fees: "commercial_terms", fees_and_payment: "commercial_terms", fees_and_charges: "commercial_terms",
  pricing: "commercial_terms", charges: "commercial_terms", commercials: "commercial_terms",
  rates: "commercial_terms", rate_card: "commercial_terms", consideration: "commercial_terms",
  payment: "payment_terms", invoicing: "payment_terms", invoicing_and_payment: "payment_terms", billing: "payment_terms",
  limitation_of_liability: "liability", liability_cap: "liability", limits_of_liability: "liability",
  liability_and_liability_limits: "liability", liability_and_indemnity: "liability", liability_limits: "liability",
  indemnities: "indemnity", indemnification: "indemnity",
  term: "term_termination", termination: "term_termination", term_and_termination: "term_termination",
  duration: "term_termination", renewal: "term_termination",
  confidential_information: "confidentiality", nda: "confidentiality",
  data_privacy: "data_protection", privacy: "data_protection", gdpr: "data_protection", data: "data_protection",
  intellectual_property: "ip", ip_rights: "ip", ipr: "ip",
  governing_law_and_jurisdiction: "governing_law", jurisdiction: "governing_law", applicable_law: "governing_law",
  disputes: "dispute_resolution", dispute: "dispute_resolution", arbitration: "dispute_resolution",
  sla: "service_levels", service_level_agreement: "service_levels", service_levels_and_credits: "service_levels",
  warranty: "warranties", representations: "warranties", representations_and_warranties: "warranties",
  parties_and_particulars: "particulars", key_particulars: "particulars",
};
const canonKey = (k) => { const n = String(k || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, ""); return CANON_KEY[n] || n; };

function snapKeys(verdicts, keys, labels) {
  const set = new Set(keys);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byNorm = {}; keys.forEach((k, i) => { byNorm[norm(k)] = k; byNorm[norm(labels[i])] = k; });
  const out = (verdicts || []).map((v) => {
    if (set.has(v.key)) return v;
    const n = norm(canonKey(v.key));
    if (byNorm[n]) return { ...v, key: byNorm[n] };
    // A MISSING KEY MUST NOT MATCH EVERYTHING. norm("") is "", and
    // "particulars".includes("") is true — so every verdict the model failed to
    // key was snapped onto whichever section happened to be first, which was then
    // reported risky/missing several times over and inflated issue_count by one
    // per unkeyed verdict, while the sections actually at risk showed nothing.
    // A 1-2 character key matched almost as promiscuously.
    if (n.length < 3) return { ...v, key: null, unmatched: true };
    const hit = keys.find((k, i) => norm(k).includes(n) || n.includes(norm(k)) || norm(labels[i]).includes(n) || n.includes(norm(labels[i])));
    return hit ? { ...v, key: hit } : { ...v, key: v.key || null, unmatched: true };
  });
  // one verdict per section, worst wins — duplicates were counted repeatedly
  const rank = { missing: 3, risky: 2, non_standard: 1, present: 0 };
  const best = new Map();
  const loose = [];
  for (const v of out) {
    if (!v.key || v.unmatched) { loose.push(v); continue; }
    const prev = best.get(v.key);
    if (!prev || (rank[v.verdict] ?? -1) > (rank[prev.verdict] ?? -1)) best.set(v.key, v);
  }
  return [...best.values(), ...loose];
}
const nextSeq = async (id) => Number((await q(`select coalesce(max(seq),-1)+1 s from contra_change where review_id=$1`, [id])).rows[0].s);

const slugify = (s) => String(s || "archetype").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
// India time (IST) — server runs UTC on Cloud Run
// India format IST — "31-07-2026 14:30" (platform standard)
const istStamp = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {}); return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`; };
const stamp = () => istStamp().replace(" ", "·").replace(":", "");

// pull the first JSON object out of an LLM reply (tolerates prose / code fences)
function jparse(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// A sane starter outline when there's no LLM key (or a parse miss) — so the
// Archetype Maker is never a dead end; the reviewer edits from here.
const GENERIC_OUTLINE = [
  { key: "particulars", label: "Particulars", what_to_check: "Effective date, term dates, contract value, key identifiers.", required: true },
  { key: "parties", label: "Parties", what_to_check: "Legal names, roles, signatories, authority to sign.", required: true },
  { key: "commercial_terms", label: "Commercial terms", what_to_check: "Fees, rate card, rebates, escalators, caps.", required: true },
  { key: "payment_terms", label: "Payment terms", what_to_check: "Currency, due days, invoicing, late-payment terms.", required: true },
  { key: "liability", label: "Liability", what_to_check: "Liability cap and any carve-outs that undercut it.", required: true },
  { key: "indemnity", label: "Indemnity", what_to_check: "Who indemnifies whom; carve-outs; sub-caps.", required: true },
  { key: "term_termination", label: "Term & termination", what_to_check: "Duration, renewal, termination rights and notice.", required: true },
  { key: "governing_law", label: "Governing law", what_to_check: "Governing law and dispute-resolution forum.", required: true },
];

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// normalise a plain-English review-rule list [{id,text,created_at}]
function normRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((r) => r && String(r.text || "").trim())
    .map((r) => ({ id: r.id || rid(), text: String(r.text).slice(0, 300), created_at: r.created_at || new Date().toISOString() }));
}

// normalise proposed sections → the review_outline shape (rules preserved)
function toOutline(sections) {
  return (Array.isArray(sections) ? sections : []).map((s, i) => ({
    key: canonKey(slugify(s.key || s.label || `section_${i + 1}`).replace(/-/g, "_")),
    label: String(s.label || s.key || `Section ${i + 1}`).slice(0, 80),
    what_to_check: String(s.what_to_check || "").slice(0, 400),
    required: s.required !== false,
    order: i,
    rules: normRules(s.rules),
  }));
}

// full-app AI log: every gated pipeline call is recorded (best-effort).
async function logRun(out, { ref_type, ref_id, rules_applied, input, output } = {}) {
  try {
    await q(
      `insert into contra_log(pipeline,provider,model,ref_type,ref_id,rules_applied,input_summary,output_summary,status)
       values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [out.pipeline || null, out.provider || null, out.model || null, ref_type || null, ref_id || null,
       JSON.stringify(rules_applied || []), String(input || "").slice(0, 300), String(output || "").slice(0, 500), out.mode || null]
    );
  } catch { /* logging is best-effort — never blocks the review */ }
}

export function mountContra(app, upload) {
  // Archetype creation and contract review both run for minutes behind a held
  // connection. Recorded as jobs so a reload stops losing them.
  mountJobs("contra", app);
  // Upload a sample contract → propose the review sections → persist a draft.
  app.post("/api/contra/archetype/propose", upload.single("file"), async (req, res) => {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "no file" });
    try {
      const extract = await extractFile(f.path, f.originalname);       // Munshi + OCR path
      const text = String(extract.text || "").slice(0, 60000);
      if (!text.trim()) return res.status(422).json({ error: "could not read any text from that file" });

      // STEP · propose the review sections (gated pipeline)
      const out = await runPipeline("contra-archetype", { user: text, maxTokens: 4000 });
      await logRun(out, { ref_type: "archetype", input: f.originalname, output: "propose sections" });
      const parsed = jparse(out.text) || {};
      let outline = toOutline(parsed.sections);
      if (!outline.length) outline = toOutline(GENERIC_OUTLINE);   // no key / parse miss → starter
      const name = (parsed.name || req.body.name || f.originalname.replace(/\.[^.]+$/, "")).slice(0, 80);

      // STEP · suggest rules + required flags from the sample's actual terms (gated)
      try {
        const rout = await runPipeline("contra-rules", {
          user: `Contract:\n${text.slice(0, 40000)}\n\nProposed sections: ${JSON.stringify(outline.map((s) => ({ key: s.key, label: s.label })))}`,
          maxTokens: 4000,
        });
        await logRun(rout, { ref_type: "archetype", input: `${outline.length} sections`, output: "suggest rules" });
        const rparsed = jparse(rout.text);
        if (rparsed?.sections?.length) {
          const bykey = Object.fromEntries(rparsed.sections.map((s) => [s.key, s]));
          outline = outline.map((s) => {
            const r = bykey[s.key];
            if (!r) return s;
            return {
              ...s,
              required: r.required !== undefined ? r.required !== false : s.required,
              rules: normRules((r.rules || []).map((t) => ({ text: t }))),
            };
          });
        }
      } catch { /* rules are best-effort — the outline still saves */ }

      const { rows } = await q(
        `insert into contra_archetype(name, status, review_outline, source_doc)
         values($1,'draft',$2::jsonb,$3) returning id, name, status, review_outline, created_at`,
        [name, JSON.stringify(outline), f.originalname]
      );
      const row = rows[0];
      res.json({ id: row.id, name: row.name, status: row.status, sections: row.review_outline, ocr: !!extract.ocr, mode: out.mode });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e).slice(0, 200) });
    } finally {
      try { rmSync(f.path); } catch { /* ignore */ }
    }
  });

  // List archetypes (saved first, then drafts) — for the library + detect.
  app.get("/api/contra/archetypes", async (_req, res) => {
    const { rows } = await q(
      `select id, name, slug, status, description, version, jsonb_array_length(review_outline) as sections,
              coalesce((select sum(jsonb_array_length(coalesce(s->'rules','[]'::jsonb))) from jsonb_array_elements(review_outline) s), 0)
                + jsonb_array_length(coalesce(global_rules,'[]'::jsonb)) as rules,
              source_doc, created_at, updated_at
         from contra_archetype order by updated_at desc`
    );
    res.json({ archetypes: rows });
  });

  app.get("/api/contra/archetype/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await q(`select * from contra_archetype where id=$1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    const versions = (await q(`select version, name, created_at from contra_archetype_version where archetype_id=$1 order by version desc`, [id])).rows;
    res.json({ archetype: rows[0], versions });
  });

  // A specific past version snapshot (for the v1 · v2 · v3 dropdown).
  app.get("/api/contra/archetype/:id/version/:v", async (req, res) => {
    const { rows } = await q(`select * from contra_archetype_version where archetype_id=$1 and version=$2`, [Number(req.params.id), Number(req.params.v)]);
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ version: rows[0] });
  });

  // Save/confirm an archetype: persist the edited outline + Required flags, name
  // it, and (on save) stamp the slug with a timestamp suffix + build the signature.
  app.post("/api/contra/archetype/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { name, description, review_outline, global_rules, save } = req.body || {};
    const outline = review_outline ? toOutline(review_outline) : null;
    const gRules = global_rules ? normRules(global_rules) : null;
    const signature = outline
      ? { keys: outline.filter((s) => s.required).map((s) => s.key), labels: outline.map((s) => s.label) }
      : null;
    const cur = (await q(`select status, version from contra_archetype where id=$1`, [id])).rows[0];
    if (!cur) return res.status(404).json({ error: "not found" });
    // status only advances on explicit save; autosaves keep it. A save of an
    // already-saved archetype bumps the version and snapshots it (v1, v2, …).
    const status = save ? "saved" : null;
    const slug = save && name ? `${slugify(name)}-${stamp()}` : null;
    const newVersion = save ? (cur.status === "saved" ? (cur.version || 1) + 1 : 1) : null;

    const { rows } = await q(
      `update contra_archetype set
         name = coalesce($2, name),
         description = coalesce($3, description),
         review_outline = coalesce($4::jsonb, review_outline),
         global_rules = coalesce($5::jsonb, global_rules),
         detect_signature = coalesce($6::jsonb, detect_signature),
         status = coalesce($7, status),
         slug = coalesce(slug, $8),
         version = coalesce($9, version),
         updated_at = now()
       where id=$1
       returning id, name, slug, status, description, version, review_outline, global_rules, created_at, updated_at`,
      [id, name || null, description ?? null, outline ? JSON.stringify(outline) : null, gRules ? JSON.stringify(gRules) : null,
       signature ? JSON.stringify(signature) : null, status, slug, newVersion]
    );
    const a = rows[0];
    if (save) {
      await q(`insert into contra_archetype_version(archetype_id,version,name,description,review_outline,global_rules) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [id, a.version, a.name, a.description || null, JSON.stringify(a.review_outline || []), JSON.stringify(a.global_rules || [])]);
    }
    res.json({ archetype: a });
  });

  // contra_review.archetype_id -> contra_archetype.id is ON DELETE NO ACTION, so an
  // archetype that has EVER been used in a review cannot be deleted: Postgres raises
  // 23503, Express turns it into a 500, and the client (which never checked r.ok)
  // closed the dialog and re-rendered as if it had worked. Clicking again did the
  // same nothing, forever. Say what is actually in the way, and offer the thing that
  // does work — retiring it, which stops it being offered without rewriting history.
  app.delete("/api/contra/archetype/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
    const used = Number((await q(`select count(*)::int c from contra_review where archetype_id=$1`, [id])).rows[0]?.c || 0);
    if (used) return res.status(409).json({
      error: `This archetype has been used in ${used} review${used === 1 ? "" : "s"}, so deleting it would erase how those contracts were judged. Retire it instead — it stops being offered for new reviews and the old ones keep their reasoning.`,
      used, can_retire: true });
    try {
      await q(`delete from contra_archetype where id=$1`, [id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(409).json({ error: `Could not delete it — something still refers to it (${String(e.code || e.message || e).slice(0, 60)}). Retire it instead.`, can_retire: true });
    }
  });
  // retire = keep the row and the history, stop offering it for new reviews
  app.post("/api/contra/archetype/:id/retire", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad id" });
    await q(`update contra_archetype set status='retired' where id=$1`, [id]);
    res.json({ ok: true });
  });

  // ---- Contract Review: drop → detect → select → review → reviewed ---------

  // Merge 1-3 archetype outlines into one (dedup sections by key/label, union
  // rules, tag which archetype requires each). Deterministic.
  function dedupOutlines(archetypes) {
    const bykey = new Map();
    for (const a of archetypes) {
      for (const s of (a.review_outline || [])) {
        const k = canonKey(s.key || slugify(s.label));
        if (!bykey.has(k)) bykey.set(k, { key: k, label: s.label, what_to_check: s.what_to_check, required: false, rules: [], from: [] });
        const m = bykey.get(k);
        m.required = m.required || s.required !== false;
        if (!m.from.includes(a.name)) m.from.push(a.name);
        const seen = new Set(m.rules.map((r) => r.text.toLowerCase()));
        for (const r of (s.rules || [])) { const t = String(r.text || "").trim(); if (t && !seen.has(t.toLowerCase())) { m.rules.push({ text: t, from: a.name }); seen.add(t.toLowerCase()); } }
      }
    }
    const globals = [];
    const gseen = new Set();
    for (const a of archetypes) for (const r of (a.global_rules || [])) { const t = String(r.text || "").trim(); if (t && !gseen.has(t.toLowerCase())) { globals.push({ text: t, from: a.name }); gseen.add(t.toLowerCase()); } }
    return { sections: [...bykey.values()], globals };
  }

  // Drop contracts → extract → contra-detect recommends archetypes → persist.
  app.post("/api/contra/batch", upload.array("files", 10), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files" });
    try {
      const archetypes = (await q(`select id, name, review_outline from contra_archetype where status='saved'`)).rows;
      const bname = req.body.name || `Batch ${istStamp()}`;
      const b = (await q(`insert into contra_batch(name,status,contract_count) values($1,'detecting',$2) returning id, name`, [bname, files.length])).rows[0];
      const reviews = [];
      for (const f of files) {
        const extract = await extractFile(f.path, f.originalname);
        const text = String(extract.text || "").slice(0, 60000);
        let detected = [];
        if (archetypes.length) {
          const dout = await runPipeline("contra-detect", {
            user: `Contract:\n${text.slice(0, 20000)}\n\nSaved archetypes:\n${JSON.stringify(archetypes.map((a) => ({ id: a.id, name: a.name, sections: (a.review_outline || []).map((s) => s.label) })))}`,
            maxTokens: 500,
          });
          await logRun(dout, { ref_type: "batch", ref_id: b.id, input: f.originalname, output: "detect" });
          const dp = jparse(dout.text);
          const arr = dp?.matches || (dp?.archetype_id != null ? [dp] : []);
          detected = (arr || []).filter((m) => m && m.archetype_id != null)
            .map((m) => ({ archetype_id: Number(m.archetype_id), confidence: Number(m.confidence) || 0, why: String(m.why || "").slice(0, 160) }))
            .sort((x, y) => y.confidence - x.confidence);
        }
        const top = detected[0];
        const ext = extname(f.originalname).toLowerCase();
        const origBuf = ext === ".docx" ? readFileSync(f.path) : null;   // keep .docx for redline markup
        const rrow = (await q(
          `insert into contra_review(batch_id,contract_name,extract_md,detected,archetype_id,detect_confidence,status,original_file,original_ext)
           values($1,$2,$3,$4::jsonb,$5,$6,'detected',$7,$8) returning id, contract_name, archetype_id, detect_confidence`,
          [b.id, f.originalname, text, JSON.stringify(detected), top?.archetype_id || null, top?.confidence || null, origBuf, ext]
        )).rows[0];
        reviews.push({ ...rrow, detected });
        try { rmSync(f.path); } catch { /* ignore */ }
      }
      await q(`update contra_batch set status='detected' where id=$1`, [b.id]);
      res.json({ batch: b, reviews, archetypes: archetypes.map((a) => ({ id: a.id, name: a.name })) });
    } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
  });

  // Run the holistic review of one contract against the selected archetype(s).
  app.post("/api/contra/review/:id/run", async (req, res) => {
    const id = Number(req.params.id);
    const ids = (req.body?.archetype_ids || []).slice(0, 3).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "pick at least one archetype" });
    try {
      const rev = (await q(`select ${REVIEW_COLS} from contra_review where id=$1`, [id])).rows[0];
      if (!rev) return res.status(404).json({ error: "not found" });
      const archetypes = (await q(`select id, name, review_outline, global_rules from contra_archetype where id = any($1)`, [ids])).rows;
      const merged = dedupOutlines(archetypes);
      await q(`update contra_review set status='reviewing', archetype_ids=$2::jsonb, archetype_id=$3 where id=$1`, [id, JSON.stringify(ids), ids[0]]);

      const outlineForPrompt = merged.sections.map((s) => ({ key: s.key, label: s.label, what_to_check: s.what_to_check, required: s.required, rules: s.rules.map((r) => r.text) }));
      const allRules = [
        ...merged.sections.flatMap((s) => s.rules.map((r) => ({ rule: r.text, section_key: s.key }))),
        ...merged.globals.map((g) => ({ rule: g.text, section_key: "whole-contract" })),
      ];
      const keys = outlineForPrompt.map((s) => s.key);
      const rout = await runPipeline("contra-review", {
        // caller-side output contract — always applied, immune to any stored-prompt drift
        system: `Return STRICT JSON only, no prose: {"summary": string, "meta": {"title": string, "type": string, "effective_date": string, "expiry_date": string}, "parties": {"a": string, "b": string}, "verdicts": [{"key","verdict","evidence_refs":[],"note"}], "rule_checks": [{"rule","section_key","result","note","refs":[]}], "findings": [{"kind","severity","note","refs":[]}], "redlines": [{"find","replace","reason","ref"}]}. meta.title = the contract's own title/name; meta.type = the contract type as a short tag (NDA, MSA, SOW, DPA, Employment, Lease, Services, Supply…); meta.effective_date / meta.expiry_date = the term start / end (or renewal) dates exactly as printed, or "" if not stated. parties = the two contracting parties' names. Use ONLY these section keys for verdicts (one per section): ${keys.join(", ")}. verdict ∈ present|non_standard|risky|missing. Emit exactly one rule_check for EVERY rule in the provided list; result ∈ pass|check|breach with the § evidence. findings.kind ∈ contradiction|off_archetype|commercial|unresolved_ref. redlines = concrete fixes to apply as tracked changes: "find" MUST be a short, EXACT verbatim substring copied from the contract text (so it can be located), "replace" is the corrected text, plus a one-line "reason" and the "ref". Only propose a redline where there is a clear fix (a rule breach or a risky term). Cite the § for every claim; never assert a contradiction as fact.`,
        user: `Contract:\n${(rev.extract_md || "").slice(0, 50000)}\n\nSections to verdict (use these keys):\n${JSON.stringify(outlineForPrompt)}\n\nRules to check (one rule_check each):\n${JSON.stringify(allRules)}`,
        maxTokens: 8000, // large archetypes (many sections/rules) produce big JSON — don't truncate
      });
      await logRun(rout, { ref_type: "review", ref_id: id, rules_applied: merged.sections.flatMap((s) => s.rules.map((r) => r.text)), input: rev.contract_name, output: "review" });
      // A REVIEW THAT DID NOT RUN MUST NEVER SAY "CLEAN".
      // runPipeline does NOT throw — it RETURNS {mode:"stub"|"disabled"|"error"}
      // with prose in .text. That prose contains no JSON, so `jparse(...) || {}`
      // yielded {}, every array came back empty, issue_count computed to 0, and the
      // row was written status='done'. The product then rendered it green and
      // exported a branded Word document reading "0 issues flagged" — for a
      // contract no model had ever read. Six different failures all landed here:
      // no key, pipeline disabled in Admin, provider 429/5xx, JSON truncated at
      // max_tokens (the model DID find breaches and we threw them away), an empty
      // extract, and a PDF whose pages could not be read.
      const fail = async (mode, note) => {
        await q(`update contra_review set status='error', run_mode=$2, run_note=$3, issue_count=null, updated_at=now() where id=$1`,
          [id, mode, String(note || "").slice(0, 500)]).catch(() => {});
        return res.status(502).json({ error: note, mode, review: { id, status: "error" } });
      };
      if (rout.mode !== "ai") {
        return fail(rout.mode,
          rout.mode === "disabled" ? "The contra-review pipeline is switched off in Admin — nothing was reviewed."
          : rout.mode === "stub" ? "No AI model is configured for contra-review, so no review ran. Add a provider key in Admin → Vault."
          : `The model could not be reached — ${String(rout.text || "").slice(0, 200)}`);
      }
      const rp = jparse(rout.text);
      // A parse failure is NOT a clean contract. Truncation is the dangerous case:
      // the review genuinely happened and found things, and the JSON was cut off.
      if (!rp) return fail("error", "The model replied but the review could not be read as JSON — most likely cut off mid-answer. Nothing was assessed; re-run it.");
      const verdicts = snapKeys(Array.isArray(rp.verdicts) ? rp.verdicts : [], keys, merged.sections.map((s) => s.label));
      const rule_checks = Array.isArray(rp.rule_checks) ? rp.rule_checks : [];
      const findings = Array.isArray(rp.findings) ? rp.findings : [];
      const redlines = Array.isArray(rp.redlines) ? rp.redlines.filter((r) => r && r.find) : [];
      const party1 = rp.parties?.a || null, party2 = rp.parties?.b || null;
      const m = rp.meta || {};
      const meta = { title: m.title || "", type: m.type || "", effective_date: m.effective_date || "", expiry_date: m.expiry_date || "" };
      const issue_count = verdicts.filter((v) => ["risky", "missing", "non_standard"].includes(v.verdict)).length
        + rule_checks.filter((c) => c.result === "breach" || c.result === "check").length + findings.length;
      // COVERAGE. The model was asked for one verdict per section and one
      // rule_check per rule. Fewer means it did not finish — and a contract that
      // was only half-checked must not be reported with the same confidence as one
      // that was fully checked, because the half it skipped is where the breach is.
      // count only verdicts that landed on a real section — an unmatched one is a
  // verdict the model failed to key, and counting it as coverage would let a
  // half-keyed reply look complete
  const coverage = { sections_expected: keys.length,
                         sections_returned: new Set(verdicts.filter((v) => v.key && !v.unmatched).map((v) => v.key)).size,
                         unmatched_verdicts: verdicts.filter((v) => v.unmatched).length,
                         rules_expected: allRules.length, rules_returned: rule_checks.length };
      const complete = coverage.sections_returned >= coverage.sections_expected
                    && coverage.rules_returned >= coverage.rules_expected;
      const report = { title: "Contract Review", generated_at: new Date().toISOString(), archetypes: archetypes.map((a) => a.name), meta, parties: { a: party1, b: party2 }, summary: rp.summary || "", verdicts, rule_checks, findings, redlines, sections: outlineForPrompt, coverage, complete };
      await q(`update contra_review set status=$9, verdicts=$2::jsonb, rule_checks=$3::jsonb, findings=$4::jsonb, report=$5::jsonb, issue_count=$6, party1=$7, party2=$8, run_mode='ai', coverage=$10::jsonb, updated_at=now() where id=$1`,
        [id, JSON.stringify(verdicts), JSON.stringify(rule_checks), JSON.stringify(findings), JSON.stringify(report), issue_count, party1, party2,
         complete ? "done" : "partial", JSON.stringify(coverage)]);

      // timeline (newest-first on read): the review event + one row per finding + redline
      let seq = 0;
      await q(`insert into contra_change(review_id,seq,actor_type,actor_id,kind,body,reasoning) values($1,$2,'ai','contra-review','review',$3,$4)`,
        [id, seq++, `Reviewed against ${archetypes.map((a) => a.name).join(" + ")}`, String(rp.summary || "").slice(0, 400)]);
      for (const fnd of findings) {
        await q(`insert into contra_change(review_id,seq,actor_type,actor_id,kind,body,reasoning,refs) values($1,$2,'ai','contra-review',$3,$4,'',$5::jsonb)`,
          [id, seq++, fnd.kind || "finding", String(fnd.note || "").slice(0, 300), JSON.stringify(fnd.refs || [])]);
      }
      for (const rl of redlines) {
        await q(`insert into contra_change(review_id,seq,actor_type,actor_id,kind,body,reasoning,refs) values($1,$2,'ai','contra-review','redline',$3,$4,$5::jsonb)`,
          [id, seq++, `“${String(rl.find).slice(0, 80)}” → “${String(rl.replace || "").slice(0, 80)}”`, String(rl.reason || "").slice(0, 240), JSON.stringify(rl.ref ? [rl.ref] : [])]);
      }
      const pend = (await q(`select count(*) c from contra_review where batch_id=$1 and status not in ('done','partial','error','not_assessed')`, [rev.batch_id])).rows[0];
      if (Number(pend.c) === 0) await q(`update contra_batch set status='done' where id=$1`, [rev.batch_id]);
      res.json({ review: { id, status: complete ? "done" : "partial", issue_count, report, coverage } });
    } catch (e) {
      await q(`update contra_review set status='error' where id=$1`, [id]).catch(() => {});
      res.status(500).json({ error: String(e.message || e).slice(0, 200) });
    }
  });

  app.get("/api/contra/batches", async (_req, res) => {
    res.json({ batches: (await q(`select id, name, status, contract_count, created_at from contra_batch order by id desc limit 50`)).rows });
  });
  // all reviews (for the Reviewed history table)
  app.get("/api/contra/reviews", async (_req, res) => {
    const rows = (await q(
      `select r.id, r.contract_name, r.party1, r.party2, r.archetype_id, a.name as archetype,
              r.report->'meta'->>'type' as contract_type,
              r.report->'meta'->>'effective_date' as effective_date,
              r.report->'meta'->>'expiry_date' as expiry_date,
              r.issue_count, r.status, r.created_at, r.updated_at
         from contra_review r left join contra_archetype a on a.id = r.archetype_id
        -- NOT just 'done'. Filtering to done meant a review that failed, was only
        -- partly covered, or was retired as never-assessed vanished from the product
        -- entirely — no row, no way back, no way to re-run it. Hiding a bad review is
        -- the same mistake as calling it clean, one step further along.
        where r.status in ('done','partial','error','not_assessed') order by r.id desc limit 200`
    )).rows;
    res.json({ reviews: rows });
  });

  app.get("/api/contra/batch/:id", async (req, res) => {
    const b = (await q(`select * from contra_batch where id=$1`, [Number(req.params.id)])).rows[0];
    if (!b) return res.status(404).json({ error: "not found" });
    const reviews = (await q(`select id, contract_name, archetype_id, archetype_ids, detected, detect_confidence, status, issue_count from contra_review where batch_id=$1 order by id`, [b.id])).rows;
    res.json({ batch: b, reviews });
  });
  app.get("/api/contra/review/:id", async (req, res) => {
    const r = (await q(`select ${REVIEW_COLS}, (original_file is not null) as has_original from contra_review where id=$1`, [Number(req.params.id)])).rows[0];
    if (!r) return res.status(404).json({ error: "not found" });
    const changes = (await q(`select * from contra_change where review_id=$1 order by seq desc`, [r.id])).rows;
    res.json({ review: r, changes });
  });
  app.delete("/api/contra/batch/:id", async (req, res) => {
    await q(`delete from contra_batch where id=$1`, [Number(req.params.id)]); // cascades reviews + changes
    res.json({ ok: true });
  });

  // Ask Contract — grounded Q&A on the reviewed contract; logged to the timeline.
  app.post("/api/contra/review/:id/ask", async (req, res) => {
    const id = Number(req.params.id);
    const { question, box_key } = req.body || {};
    if (!question) return res.status(400).json({ error: "no question" });
    const rev = (await q(`select ${REVIEW_COLS} from contra_review where id=$1`, [id])).rows[0];
    if (!rev) return res.status(404).json({ error: "not found" });
    try {
      const out = await runPipeline("contra-ask", {
        system: `Answer ONLY from the contract below. Cite the § for every claim; combine several §§ when they interact. Be concise and practical.\n\nContract:\n${(rev.extract_md || "").slice(0, 50000)}`,
        user: `${question}${box_key ? `\n(focus on the "${box_key}" section)` : ""}`,
        maxTokens: 900,
      });
      await logRun(out, { ref_type: "review", ref_id: id, input: question, output: "ask" });
      const answer = out.mode === "ai" ? out.text : "(no answer — add a keyed model in AI Skills & Pipelines)";
      const seq = await nextSeq(id);
      await q(`insert into contra_change(review_id,seq,actor_type,actor_id,kind,body,reasoning) values($1,$2,'ai','contra-ask','qa',$3,$4)`,
        [id, seq, `Q: ${String(question).slice(0, 220)}${box_key ? ` (${box_key})` : ""}`, String(answer).slice(0, 1500)]);
      res.json({ answer });
    } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
  });

  // Every decision made on this review — so the report can show a finding as
  // resolved instead of re-presenting it as if nobody had looked.
  app.get("/api/contra/review/:id/decisions", async (req, res) => {
    const rows = (await q(`select box_key, finding_key, verdict, reason, actor, created_at
                             from contra_decision where review_id=$1`, [Number(req.params.id)])).rows;
    res.json({ decisions: rows });
  });

  // The teaching signal: a check rejected repeatedly across contracts of the SAME
  // archetype is the archetype being wrong, not the contracts. Surfaced for a
  // human to soften or remove — never applied automatically.
  app.get("/api/contra/archetype/:id/signal", async (req, res) => {
    const rows = (await q(
      `select box_key, finding_key, count(*) c,
              array_agg(distinct nullif(reason,'')) filter (where reason is not null) as reasons
         from contra_decision
        where archetype_id=$1 and verdict='reject'
        group by box_key, finding_key having count(*) >= 2
        order by c desc limit 20`, [Number(req.params.id)])).rows;
    res.json({ signals: rows });
  });

  // Clause labels — a 2-4 word topic per cited § (Indemnity, Payment terms…), so the
  // report chips say what each clause is about. Generated once (gated) + cached on the report.
  app.post("/api/contra/review/:id/clause-labels", async (req, res) => {
    const id = Number(req.params.id);
    const rev = (await q(`select id, extract_md, report from contra_review where id=$1`, [id])).rows[0];
    if (!rev) return res.status(404).json({ error: "not found" });
    const rep = rev.report || {};
    if (rep.clause_labels && Object.keys(rep.clause_labels).length) return res.json({ labels: rep.clause_labels, cached: true });
    const refs = [...new Set([
      ...(rep.rule_checks || []).flatMap((c) => c.refs || []),
      ...(rep.findings || []).flatMap((f) => f.refs || []),
      ...(rep.verdicts || []).flatMap((v) => v.evidence_refs || []),
    ].map((x) => String(x || "").trim()).filter(Boolean))];
    if (!refs.length) return res.json({ labels: {} });
    try {
      const out = await runPipeline("contra-clause-label", {
        system: `Label each clause reference with a 2-4 word topic of what that clause is about (e.g. "Indemnity", "Payment terms", "Governing law", "Termination", "Confidentiality", "Limitation of liability", "Scope of work"). Decide from the contract. Return STRICT JSON {"labels":{"<ref>":"<2-4 words>"}} covering EXACTLY these refs: ${JSON.stringify(refs)}.\n\nContract:\n${(rev.extract_md || "").slice(0, 50000)}`,
        user: `Refs: ${JSON.stringify(refs)}`,
        maxTokens: 1200,
      });
      const j = jparse(out.text) || {};
      const labels = (j.labels && typeof j.labels === "object") ? j.labels : {};
      rep.clause_labels = labels;
      await q(`update contra_review set report=$2::jsonb where id=$1`, [id, JSON.stringify(rep)]);
      res.json({ labels });
    } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 200) }); }
  });

  // Human action on a box. A comment is a note; an accept/reject is a DECISION —
  // it resolves the item, persists against the thing decided (not just the
  // moment), and feeds the archetype-level teaching signal below.
  app.post("/api/contra/review/:id/act", async (req, res) => {
    const id = Number(req.params.id);
    const { kind, box_key, finding_key, body } = req.body || {};
    // NOT req.body.by — the browser does not get to say who acted.
    const by = req.acct?.user || "unknown";
    if (!["accept", "reject", "comment"].includes(kind)) return res.status(400).json({ error: "bad kind" });
    if (kind !== "comment") {
      const rv = (await q(`select archetype_id from contra_review where id=$1`, [id])).rows[0];
      await q(`insert into contra_decision(review_id, archetype_id, box_key, finding_key, verdict, reason, actor)
               values($1,$2,$3,$4,$5,$6,$7)
               -- must match contra_decision_ident_idx (051): the plain column tuple
               -- could never match a NULL finding_key, so section-level decisions
               -- inserted a new row every time instead of updating one
               on conflict (review_id, coalesce(box_key, ''), coalesce(finding_key, ''))
               do update set verdict=excluded.verdict, reason=excluded.reason, actor=excluded.actor, created_at=now()`,
        [id, rv?.archetype_id || null, String(box_key || "").slice(0, 80) || null,
         finding_key ? String(finding_key).slice(0, 160) : null, kind,
         String(body || "").slice(0, 300) || null, String(by || "you").slice(0, 40)]).catch(() => {});
    }
    const seq = await nextSeq(id);
    const label = kind === "accept" ? `Accepted · ${box_key || "review"}` : kind === "reject" ? `Rejected · ${box_key || "review"}` : `Comment · ${box_key || "whole contract"}`;
    await q(`insert into contra_change(review_id,seq,actor_type,actor_id,kind,body,reasoning) values($1,$2,'human',$3,$4,$5,$6)`,
      [id, seq, String(by || "you").slice(0, 40), kind, label, String(body || "").slice(0, 500)]);
    res.json({ ok: true });
  });

  // Branded Word (.docx) export of the review.
  app.get("/api/contra/review/:id/docx", async (req, res) => {
    const rev = (await q(`select * from contra_review where id=$1`, [Number(req.params.id)])).rows[0];
    if (!rev) return res.status(404).send("not found");
    const base = String(rev.contract_name || "contract").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-");
    const redlines = (rev.report || {}).redlines || [];
    try {
      // Original .docx + redlines → mark up the client's own file (tracked changes)
      if (rev.original_ext === ".docx" && rev.original_file && redlines.length) {
        const { buffer } = await markupDocx(rev.original_file, redlines);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${base}-MARKED-UP-${rev.id}.docx"`);
        return res.send(buffer);
      }
      // Fallback (PDF/scan or no redlines): the branded report doc
      const buf = await buildReviewDocx(rev);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="Contract-Review-${base}-${rev.id}.docx"`);
      res.send(buf);
    } catch (e) { res.status(500).send(String(e.message || e).slice(0, 200)); }
  });
}
