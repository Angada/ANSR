// Q-Legal — legal-repository intelligence. SharePoint (or upload) is the source
// of truth; this module builds the derived layer: per-version C1 (full transcript)
// + C2 (concise key), the registry, doc tree, obligations, global search + Ask,
// the confirm queue, editable business rules, and the learning-loop feedback store.
// Every AI step is a named gated pipeline (qlegal-*) with scope-matched business
// rules injected at call time; every call is logged append-only to ql_log.
import { readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { createHash } from "node:crypto";
import { q } from "./db/client.js";
import { extractFile, toMarkdown } from "./extract.js";
import { putOriginal, putExtract, getExtract } from "./storage.js";
import { runPipeline } from "./ai.js";

const TENANT = "Q-LEGAL"; // ring-fenced storage namespace (vault + docstore)

// pull the first JSON object out of an LLM reply (tolerates prose / code fences)
function jparse(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
const clip = (s, n) => String(s || "").slice(0, n);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s : null;

// ---- business rules: active rules for a scope, injected into every prompt ----
async function rulesFor(scope) {
  const { rows } = await q(
    `select code, title, body from ql_rule where status='active' and (scope='global' or scope=$1) order by id`, [scope]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) return { text: "", codes: [] };
  const text = "BUSINESS RULES (set by the legal team — follow them):\n" + rows.map((r) => `- ${r.title}: ${r.body}`).join("\n");
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
const KEY_CONTRACT = `Return STRICT JSON only, no prose:
{"meta":{"title":"the contract's own title","doc_type":"MSA|SOW|NDA|Amendment|DPA|Employment|Lease|SaaS|Services|Supply|Other",
 "party1":"","party2":"","counterparty":"the non-us party (or party2)","effective_date":"YYYY-MM-DD or \\"\\"","expiry_date":"YYYY-MM-DD or \\"\\"",
 "governing_law":"","value":"contract value as printed or \\"\\"","auto_renewal":true|false,"notice_period":"as printed or \\"\\"","executed":true|false},
 "summary":"2-4 plain sentences on what this contract is",
 "tags":["lowercase tags from the controlled vocabulary where possible"],
 "clauses":[{"ref":"§ as printed","label":"2-4 word topic","gist":"one line"}],
 "notice":{"notice_clauses":[{"ref":"","what":"","method":"","days":""}],"notice_contacts":[""],"change_of_control":[{"ref":"","requires":"notice|consent"}]}}
Use ONLY what the document states — empty string when not stated. Never invent § references; use what the document prints.`;

const OBLIG_CONTRACT = `Return STRICT JSON only, no prose:
{"obligations":[{"kind":"expiry|renewal|termination_notice|deliverable|sla|notice","what":"one line","who_owes":"us|counterparty|unknown",
 "due_date":"YYYY-MM-DD or \\"\\"","frequency":"one_time|monthly|quarterly|annual","ref":"§ as printed"}]}
Extract the dated lifecycle obligations (expiry, renewal window, termination-notice deadline) AND the post-execution deliverables/SLAs
(reports, certificates, insurance, audits). Cite the § for every one. Only what the contract actually states.`;

const LINK_CONTRACT = `Return STRICT JSON only, no prose:
{"parent_id": <id of the governing/parent document from the candidate list, or null>,
 "relation_kind": "amends|governed_by|supersedes|references|null", "confidence": 0-1, "why": "one line citing the tell-tale (e.g. 'pursuant to the MSA dated…')"}
Only propose a parent when the document itself references it (by name/date/parties) — never guess from topic similarity alone.`;

// ---- shared per-file ingestion (upload path now; SharePoint sync later) ------
// Writes per step as it completes (resumable spirit): version row first, then C1,
// then C2, then obligations — a crash never loses finished work.
async function ingestFile(f, { actor = "you" } = {}) {
  const buf = readFileSync(f.path);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const ext = extname(f.originalname).toLowerCase();

  // duplicate: this exact file is already in the repository → skip, point at it
  const dup = (await q(`select v.document_id, v.version_no, d.filename from ql_version v join ql_document d on d.id=v.document_id where v.sha256=$1 limit 1`, [sha256])).rows[0];
  if (dup) return { filename: f.originalname, skipped: "duplicate", of: dup };

  // one document, many versions: same filename → a new version of that document
  let doc = (await q(`select * from ql_document where lower(filename)=lower($1) limit 1`, [f.originalname])).rows[0];
  if (!doc) {
    doc = (await q(`insert into ql_document(filename, source) values($1,'upload') returning *`, [f.originalname])).rows[0];
  }
  const versionNo = (doc.latest_version || 0) + 1;
  const ver = (await q(
    `insert into ql_version(document_id, version_no, sha256, status) values($1,$2,$3,'processing')
     on conflict (document_id, version_no) do update set sha256=excluded.sha256, status='processing'
     returning id`, [doc.id, versionNo, sha256]
  )).rows[0];

  try {
    // STEP · read (deterministic; Munshi vision-OCR fallback for scans)
    const extract = await extractFile(f.path, f.originalname);
    const c1 = clip(extract.text, 400000);
    if (!c1.trim()) throw new Error("could not read any text from that file");
    const storagePath = await putOriginal(TENANT, sha256, ext, buf);
    const c1DocId = `ql-${doc.id}-v${versionNo}`;
    await putExtract(TENANT, c1DocId, toMarkdown({ docType: "contract", originalName: f.originalname, sha256, extract }));
    await q(`update ql_version set storage_path=$2, c1_doc_id=$3, c1_text=$4, ocr=$5 where id=$1`,
      [ver.id, storagePath, c1DocId, c1, !!extract.ocr]);

    // STEP · concise key (C2) — gated qlegal-key + ingestion business rules
    const rules = await rulesFor("ingestion");
    const out = await runPipeline("qlegal-key", {
      system: [rules.text, KEY_CONTRACT].filter(Boolean).join("\n\n"),
      user: `Document filename: ${f.originalname}\n\nContract:\n${clip(c1, 60000)}`,
      maxTokens: 4000,
    });
    await logRun(out, { ref_type: "version", ref_id: ver.id, rules: rules.codes, input: f.originalname, output: "concise key (C2)" });
    const kp = jparse(out.text) || {};
    const meta = kp.meta || {};
    const tags = [...new Set([...(Array.isArray(kp.tags) ? kp.tags : []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
      ...(extract.ocr ? ["scanned-source"] : []), ...(meta.executed ? ["executed"] : [])])].slice(0, 12);
    const c2 = { meta, summary: kp.summary || "", tags, clauses: (kp.clauses || []).slice(0, 400), notice: kp.notice || {}, mode: out.mode };
    await q(`update ql_version set c2=$2::jsonb, is_executed=$3, status='done', error=null where id=$1`,
      [ver.id, JSON.stringify(c2), !!meta.executed]);
    await q(
      `update ql_document set title=coalesce(nullif($2,''), title), doc_type=coalesce(nullif($3,''), doc_type),
        party1=coalesce(nullif($4,''), party1), party2=coalesce(nullif($5,''), party2),
        counterparty=coalesce(nullif($6,''), counterparty), summary=coalesce(nullif($7,''), summary),
        facts=$8::jsonb, tags=$9::jsonb, latest_version=$10, updated_at=now() where id=$1`,
      [doc.id, clip(meta.title, 200), clip(meta.doc_type, 40), clip(meta.party1, 160), clip(meta.party2, 160),
       clip(meta.counterparty || meta.party2, 160), clip(kp.summary, 1200), JSON.stringify(meta), JSON.stringify(tags), versionNo]
    );
    // grow the tag vocabulary with new free tags (suggest-first lives in the UI)
    for (const t of tags) await q(`insert into ql_tag_vocab(tag, kind) values($1,'free') on conflict (tag) do nothing`, [t]).catch(() => {});

    // AI couldn't classify (no key / parse miss) → the human confirm queue
    if (out.mode !== "ai" || !meta.doc_type) {
      await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why) values('classification',$1,$2::jsonb,$3,$4)`,
        [doc.id, JSON.stringify({ doc_type: meta.doc_type || null }), out.mode === "ai" ? 0.4 : 0,
         out.mode === "ai" ? "the model could not classify this document" : "no keyed model — classify this document manually"]);
    }

    // STEP · obligations — gated qlegal-obligations + obligations business rules
    try {
      const orules = await rulesFor("obligations");
      const oout = await runPipeline("qlegal-obligations", {
        system: [orules.text, OBLIG_CONTRACT].filter(Boolean).join("\n\n"),
        user: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nContract:\n${clip(c1, 50000)}`,
        maxTokens: 2500,
      });
      await logRun(oout, { ref_type: "document", ref_id: doc.id, rules: orules.codes, input: f.originalname, output: "obligations" });
      const op = jparse(oout.text) || {};
      await q(`delete from ql_obligation where document_id=$1 and status='proposed'`, [doc.id]); // re-propose on re-ingest; confirmed rows kept
      for (const o of (op.obligations || []).slice(0, 60)) {
        if (!o || !o.what) continue;
        await q(`insert into ql_obligation(document_id, kind, what, who_owes, due_date, frequency, ref) values($1,$2,$3,$4,$5,$6,$7)`,
          [doc.id, clip(o.kind, 30) || "deliverable", clip(o.what, 300), clip(o.who_owes, 20) || "unknown",
           validDate(o.due_date), clip(o.frequency, 20) || "one_time", clip(o.ref, 60)]).catch(() => {});
      }
    } catch { /* obligations are best-effort — the document still lands */ }

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

    return { filename: f.originalname, document_id: doc.id, version_no: versionNo, ocr: !!extract.ocr, mode: out.mode, doc_type: meta.doc_type || null };
  } catch (e) {
    await q(`update ql_version set status='error', error=$2 where id=$1`, [ver.id, clip(e.message, 300)]).catch(() => {});
    return { filename: f.originalname, error: clip(e.message, 200) };
  }
}

// ---- doc tree: propose a parent for one document (gated qlegal-link) ---------
async function proposeLinks(docId) {
  const doc = (await q(`select id, filename, title, doc_type, party1, party2, summary from ql_document where id=$1`, [docId])).rows[0];
  if (!doc) return;
  const cands = (await q(
    `select id, filename, title, doc_type, party1, party2 from ql_document where id<>$1 order by updated_at desc limit 200`, [docId]
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
  if (!lp || !lp.parent_id || !cands.some((c) => c.id === Number(lp.parent_id))) return;
  await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why) values('link',$1,$2::jsonb,$3,$4)`,
    [docId, JSON.stringify({ parent_id: Number(lp.parent_id), relation_kind: clip(lp.relation_kind, 20) || "references" }),
     Number(lp.confidence) || 0, clip(lp.why, 240)]);
}

// deterministic lineage sweep: near-identical text across two different documents
// (e.g. the executed PDF of a final Word doc) → propose an executed_of link.
function wordSet(s) { return new Set(clip(s, 40000).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3)); }
function jaccard(a, b) { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); }
async function proposeLineage(docId) {
  const mine = (await q(`select v.c1_text from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version where d.id=$1`, [docId])).rows[0];
  if (!mine?.c1_text) return;
  const my = wordSet(mine.c1_text);
  const others = (await q(
    `select d.id, d.filename, v.c1_text from ql_document d join ql_version v on v.document_id=d.id and v.version_no=d.latest_version where d.id<>$1 limit 300`, [docId]
  )).rows;
  for (const o of others) {
    if (!o.c1_text) continue;
    const sim = jaccard(my, wordSet(o.c1_text));
    if (sim >= 0.85) {
      await q(`insert into ql_confirm(kind, document_id, proposal, confidence, why) values('lineage',$1,$2::jsonb,$3,$4)`,
        [docId, JSON.stringify({ other_id: o.id, relation_kind: "executed_of" }), Math.round(sim * 100) / 100,
         `near-identical text (${Math.round(sim * 100)}%) to “${o.filename}” — likely the same contract (draft ↔ executed)`]);
      break;
    }
  }
}

export function mountQLegal(app, upload) {
  // ---- ingestion: manual sync (SharePoint Graph delta sync lands here later) --
  app.post("/api/qlegal/upload", upload.array("files", 20), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no files" });
    const results = [];
    for (const f of files) {
      results.push(await ingestFile(f));                      // persisted per file as it completes
      try { rmSync(f.path); } catch { /* ignore */ }
    }
    // tree link + lineage proposals for the docs that landed (best-effort, non-blocking)
    (async () => {
      for (const r of results) if (r.document_id) { await proposeLinks(r.document_id).catch(() => {}); await proposeLineage(r.document_id).catch(() => {}); }
    })();
    res.json({ results });
  });

  // ---- registry (the estate table) -------------------------------------------
  app.get("/api/qlegal/registry", async (_req, res) => {
    const docs = (await q(
      `select d.*, (select count(*) from ql_obligation o where o.document_id=d.id and o.status in ('proposed','confirmed')
         and (o.due_date is null or o.due_date >= current_date)) as open_obligations,
        (select count(*) from ql_version v where v.document_id=d.id) as versions,
        exists(select 1 from ql_version v where v.document_id=d.id and v.ocr) as scanned
       from ql_document d order by d.updated_at desc limit 1000`
    )).rows;
    const counts = (await q(`select coalesce(doc_type,'unclassified') t, count(*) c from ql_document group by 1 order by c desc`)).rows;
    res.json({ documents: docs, by_type: counts });
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
    res.json({ document: doc, versions, c2, obligations, children, parent, confirms });
  });
  app.delete("/api/qlegal/document/:id", async (req, res) => {
    await q(`delete from ql_document where id=$1`, [Number(req.params.id)]); // cascades versions/obligations/confirms
    res.json({ ok: true });
  });

  // serve a version's C1 transcript (the doc×api switch — never the original)
  app.get("/api/qlegal/c1/:versionId", async (req, res) => {
    const v = (await q(`select c1_doc_id, c1_text from ql_version where id=$1`, [Number(req.params.versionId)])).rows[0];
    if (!v) return res.status(404).send("not found");
    const md = (v.c1_doc_id && await getExtract(TENANT, v.c1_doc_id)) || v.c1_text || "";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(md);
  });

  // ---- global search: facts + full-text over C1 (hybrid; vectors arrive P2) ---
  // OR-ranked: a doc matching ANY term hits; matching more terms ranks higher.
  // (AND semantics silently drop "liability cap" when only "liability" is printed.)
  const orQuery = (term) => clip(term, 200).split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, "")).filter((w) => w.length > 1).join(" OR ") || "";
  app.get("/api/qlegal/search", async (req, res) => {
    const term = clip(req.query.q, 200).trim();
    if (!term) return res.json({ hits: [] });
    const tsq = orQuery(term);
    const fts = tsq ? (await q(
      `select d.id, d.filename, d.title, d.doc_type, d.party1, d.party2, d.tags, v.version_no,
              ts_headline('english', v.c1_text, websearch_to_tsquery('english', $1),
                'MaxFragments=2, MaxWords=22, MinWords=8, FragmentDelimiter= … ') as snippet,
              ts_rank(to_tsvector('english', coalesce(v.c1_text,'')), websearch_to_tsquery('english', $1)) as rank
         from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version
        where to_tsvector('english', coalesce(v.c1_text,'')) @@ websearch_to_tsquery('english', $1)
        order by rank desc limit 25`, [tsq]
    )).rows : [];
    const facts = (await q(
      `select id, filename, title, doc_type, party1, party2, tags from ql_document
        where filename ilike $1 or title ilike $1 or party1 ilike $1 or party2 ilike $1 or counterparty ilike $1 or tags::text ilike $1
        limit 10`, [`%${term}%`]
    )).rows;
    const seen = new Set(fts.map((h) => h.id));
    res.json({ hits: [...fts.map((h) => ({ ...h, via: "text" })), ...facts.filter((f) => !seen.has(f.id)).map((f) => ({ ...f, via: "facts" }))] });
  });

  // ---- Ask the repository: NL answers grounded in FTS hits + registry facts ---
  app.post("/api/qlegal/ask", async (req, res) => {
    const question = clip(req.body?.question, 500).trim();
    if (!question) return res.status(400).json({ error: "no question" });
    try {
      // grounding: top text hits (OR-ranked) with generous context + the estate shape
      const tsq = orQuery(question);
      const hits = tsq ? (await q(
        `select d.id, d.filename, d.title, d.doc_type, v.c1_text,
                ts_rank(to_tsvector('english', coalesce(v.c1_text,'')), websearch_to_tsquery('english', $1)) as rank
           from ql_version v join ql_document d on d.id=v.document_id and v.version_no=d.latest_version
          where to_tsvector('english', coalesce(v.c1_text,'')) @@ websearch_to_tsquery('english', $1)
          order by rank desc limit 4`, [tsq]
      )).rows : [];
      const estate = (await q(`select coalesce(doc_type,'unclassified') t, count(*) c from ql_document group by 1`)).rows;
      const soon = (await q(
        `select d.filename, o.kind, o.what, o.due_date from ql_obligation o join ql_document d on d.id=o.document_id
          where o.status in ('proposed','confirmed') and o.due_date between current_date and current_date + 120 order by o.due_date limit 15`
      )).rows;
      const ctx = [
        `REPOSITORY SHAPE: ${estate.map((e) => `${e.t}: ${e.c}`).join(" · ") || "empty"}`,
        soon.length ? `UPCOMING OBLIGATIONS (120 days): ${soon.map((s) => `${s.filename} — ${s.what} (${s.due_date ? String(s.due_date).slice(0, 10) : "?"})`).join(" | ")}` : "",
        ...hits.map((h) => `DOCUMENT [${h.id}] ${h.title || h.filename} (${h.doc_type || "?"}):\n${clip(h.c1_text, 12000)}`),
      ].filter(Boolean).join("\n\n");
      const rules = await rulesFor("search");
      const out = await runPipeline("qlegal-ask", {
        system: [rules.text, `Answer ONLY from the repository context below. Cite the document name AND the § for every claim; if the context doesn't contain the answer, say what's missing — never guess. Be concise and practical.\n\n${ctx}`].filter(Boolean).join("\n\n"),
        user: question,
        maxTokens: 1200,
      });
      await logRun(out, { ref_type: "ask", rules: rules.codes, input: question, output: clip(out.text, 400) });
      res.json({
        answer: out.mode === "ai" ? out.text : "(no answer — point the Q-Legal pipelines at a keyed model in AI Skills & Pipelines)",
        mode: out.mode, sources: hits.map((h) => ({ id: h.id, name: h.title || h.filename })),
      });
    } catch (e) { res.status(500).json({ error: clip(e.message, 200) }); }
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
      `select c.*, d.filename, d.title from ql_confirm c left join ql_document d on d.id=c.document_id
        where c.status='open' order by c.id desc limit 200`
    )).rows;
    res.json({ confirms: rows });
  });
  app.post("/api/qlegal/confirm/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { action, doc_type, by } = req.body || {};
    if (!["accept", "reject"].includes(action)) return res.status(400).json({ error: "action must be accept|reject" });
    const c = (await q(`select * from ql_confirm where id=$1 and status='open'`, [id])).rows[0];
    if (!c) return res.status(404).json({ error: "not found or already resolved" });
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
        if (t) await q(`update ql_document set doc_type=$2, updated_at=now() where id=$1`, [c.document_id, t]);
      }
    }
    await q(`update ql_confirm set status=$2, resolved_by=$3, resolved_at=now() where id=$1`, [id, action === "accept" ? "accepted" : "rejected", clip(by, 40) || "you"]);
    // every confirmation is a learning label (append-only)
    await q(`insert into ql_feedback(surface, document_id, field, was, corrected, note, actor) values('confirm',$1,$2,$3,$4,$5,$6)`,
      [c.document_id, c.kind, JSON.stringify(c.proposal), action, clip(c.why, 240), clip(by, 40) || "you"]).catch(() => {});
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
      [code, clip(title, 160), clip(body, 2000), ["global", "ingestion", "search", "obligations", "drafting"].includes(scope) ? scope : "global"])).rows;
    res.json({ rule: rows[0] });
  });
  app.post("/api/qlegal/rule/:id", async (req, res) => {
    const { title, body, scope, status } = req.body || {};
    const rows = (await q(
      `update ql_rule set title=coalesce($2,title), body=coalesce($3,body), scope=coalesce($4,scope),
        status=coalesce($5,status), version=version+1, updated_at=now() where id=$1 returning *`,
      [Number(req.params.id), title ? clip(title, 160) : null, body ? clip(body, 2000) : null,
       ["global", "ingestion", "search", "obligations", "drafting"].includes(scope) ? scope : null,
       ["active", "off"].includes(status) ? status : null]
    )).rows;
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ rule: rows[0] });
  });

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
}
