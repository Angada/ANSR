// Contra — contract review app. Phase 1: the Archetype Maker.
// Upload a sample → Munshi/OCR extract → contra-archetype proposes the review
// SECTIONS → reviewer confirms/amends + tags Required → save as an archetype.
// Everything persists (draft rows) so you can leave and come back.
import { readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { q } from "./db/client.js";
import { extractFile } from "./extract.js";
import { runPipeline } from "./ai.js";
import { buildReviewDocx } from "./contra-docx.js";
import { markupDocx } from "./contra-redline.js";

// Every column of contra_review EXCEPT the heavy/raw blobs (original_file bytea,
// contract_doc) — used for reads that don't need the original bytes, so we never
// serialise the uploaded file into a JSON response. The /docx route still SELECT *s.
const REVIEW_COLS = "id, batch_id, contract_name, archetype_id, archetype_ids, status, verdicts, findings, rule_checks, report, issue_count, detect_confidence, detected, marked_doc_path, extract_md, original_ext, party1, party2, created_at, updated_at";

// snap LLM verdict keys onto the archetype's section keys (model-adherence safety)
function snapKeys(verdicts, keys, labels) {
  const set = new Set(keys);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byNorm = {}; keys.forEach((k, i) => { byNorm[norm(k)] = k; byNorm[norm(labels[i])] = k; });
  return (verdicts || []).map((v) => {
    if (set.has(v.key)) return v;
    const n = norm(v.key);
    if (byNorm[n]) return { ...v, key: byNorm[n] };
    const hit = keys.find((k, i) => norm(k).includes(n) || n.includes(norm(k)) || norm(labels[i]).includes(n) || n.includes(norm(labels[i])));
    return hit ? { ...v, key: hit } : v;
  });
}
const nextSeq = async (id) => Number((await q(`select coalesce(max(seq),-1)+1 s from contra_change where review_id=$1`, [id])).rows[0].s);

const slugify = (s) => String(s || "archetype").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", "·").replace(/:/g, "");

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
    key: slugify(s.key || s.label || `section_${i + 1}`).replace(/-/g, "_"),
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

  app.delete("/api/contra/archetype/:id", async (req, res) => {
    await q(`delete from contra_archetype where id=$1`, [Number(req.params.id)]);
    res.json({ ok: true });
  });

  // ---- Contract Review: drop → detect → select → review → reviewed ---------

  // Merge 1-3 archetype outlines into one (dedup sections by key/label, union
  // rules, tag which archetype requires each). Deterministic.
  function dedupOutlines(archetypes) {
    const bykey = new Map();
    for (const a of archetypes) {
      for (const s of (a.review_outline || [])) {
        const k = (s.key || slugify(s.label)).toLowerCase();
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
      const bname = req.body.name || `Batch ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
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
      const rp = jparse(rout.text) || {};
      const verdicts = snapKeys(Array.isArray(rp.verdicts) ? rp.verdicts : [], keys, merged.sections.map((s) => s.label));
      const rule_checks = Array.isArray(rp.rule_checks) ? rp.rule_checks : [];
      const findings = Array.isArray(rp.findings) ? rp.findings : [];
      const redlines = Array.isArray(rp.redlines) ? rp.redlines.filter((r) => r && r.find) : [];
      const party1 = rp.parties?.a || null, party2 = rp.parties?.b || null;
      const m = rp.meta || {};
      const meta = { title: m.title || "", type: m.type || "", effective_date: m.effective_date || "", expiry_date: m.expiry_date || "" };
      const issue_count = verdicts.filter((v) => ["risky", "missing", "non_standard"].includes(v.verdict)).length
        + rule_checks.filter((c) => c.result === "breach" || c.result === "check").length + findings.length;
      const report = { title: "Contract Review", generated_at: new Date().toISOString(), archetypes: archetypes.map((a) => a.name), meta, parties: { a: party1, b: party2 }, summary: rp.summary || "", verdicts, rule_checks, findings, redlines, sections: outlineForPrompt };
      await q(`update contra_review set status='done', verdicts=$2::jsonb, rule_checks=$3::jsonb, findings=$4::jsonb, report=$5::jsonb, issue_count=$6, party1=$7, party2=$8, updated_at=now() where id=$1`,
        [id, JSON.stringify(verdicts), JSON.stringify(rule_checks), JSON.stringify(findings), JSON.stringify(report), issue_count, party1, party2]);

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
      const pend = (await q(`select count(*) c from contra_review where batch_id=$1 and status<>'done'`, [rev.batch_id])).rows[0];
      if (Number(pend.c) === 0) await q(`update contra_batch set status='done' where id=$1`, [rev.batch_id]);
      res.json({ review: { id, status: "done", issue_count, report } });
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
        where r.status = 'done' order by r.id desc limit 200`
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

  // Human action on a box (accept / reject / comment) → remembered on the timeline.
  app.post("/api/contra/review/:id/act", async (req, res) => {
    const id = Number(req.params.id);
    const { kind, box_key, body, by } = req.body || {};
    if (!["accept", "reject", "comment"].includes(kind)) return res.status(400).json({ error: "bad kind" });
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
