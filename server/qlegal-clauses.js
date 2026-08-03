// ============================================================================
// The Canon clause layer — one component, two halves.
//
// Contra declared `contra-atomize` and never ran it; Q-Legal asked one model
// call to emit the key, the contents wiki AND every clause at once, which is
// exactly the call that truncated and left C2 empty on real contracts.
//
// The fix is to stop asking a model for things a document already states.
//
//   HALF 1 · deterministic — the § reference, the exact text, the nesting and
//            the cross-references are READ from the contract. No model, so no
//            truncation, no renumbering, no invented clause, and 100% coverage
//            however long the agreement runs.
//   HALF 2 · intelligence — a topic label and a one-line gist per clause,
//            batched so a 300-clause MSA is many small calls that cannot lose
//            clause 297 by running out of tokens.
//
// What this buys Ask: verified § anchors (a citation can be checked against the
// stored body), and EDGES — "unless terminated per Section 15" becomes a link
// Ask can follow. Similarity ranking cannot do that: a cross-reference is
// usually textually unlike its target, so vectors rank it lowest exactly when
// it matters most.
// ============================================================================
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";

// ---- HALF 1 · deterministic structure --------------------------------------

// Headings as contracts actually print them. Ordered: the most explicit form
// wins, so "Section 12.3 Termination" is not mistaken for prose beginning "12".
const HEAD = [
  // §12.3 Termination   |   § 12.3 — Termination
  /^\s*§\s*(\d+(?:\.\d+)*)\s*[.)\-–—:]?\s*(.*)$/,
  // Section 12.3 Termination   |   Clause 4.2  |  Article V
  /^\s*(?:SECTION|Section|CLAUSE|Clause|ARTICLE|Article)\s+(\d+(?:\.\d+)*|[IVXLC]+)\s*[.)\-–—:]?\s*(.*)$/,
  // 12.3 Termination   |   12.3. Termination   |   12 TERMINATION
  /^\s*(\d+(?:\.\d+)*)[.)]?\s+([A-Z§"'(].{0,120})$/,
  // ANNEXURE III / SCHEDULE 2 / APPENDIX A / EXHIBIT B
  /^\s*(?:(ANNEXURE|Annexure|SCHEDULE|Schedule|APPENDIX|Appendix|EXHIBIT|Exhibit)\s+([A-Z0-9IVXLC]+))\s*[.)\-–—:]?\s*(.*)$/,
];

// The commonest layout in real agreements, and the one that defeats a
// single-line regex: the number sits ALONE on its line and the heading text
// begins the next one — "2.2." / "Statements of Work. As used herein…".
// Measured on the sample estate, missing this form cost the Insulet MSA every
// one of its clauses.
const NUM_ONLY = /^\s*(\d+(?:\.\d+)*)\s*[.)]?\s*$/;

// Clause numbers are small and shallow. Street numbers and ZIP codes are not:
// without this, "1100 Dallas, Texas 75240" became §1100 with title "Dallas,
// Texas 75240", and the address block outranked the actual contract.
const plausibleRef = (ref) => {
  const parts = String(ref).split(".");
  if (parts.length > 4) return false;
  return parts.every((p) => p.length <= 2 && Number(p) >= 0 && Number(p) <= 99);
};

// Title from the line that follows a bare number: contracts print the heading
// as a leading Title-Case sentence — "Term. The term of this Agreement shall…".
const titleFrom = (line) => {
  const t = String(line || "").trim();
  // a definitions clause leads with the defined term in quotes — that term IS
  // the title, and it is the single most useful label in the whole document
  const d = t.match(/^["“”']([^"“”']{1,60})["“”']\s+(?:means|shall mean|has the meaning)/i);
  if (d) return d[1].trim();
  const m = t.match(/^([A-Z][^.;:]{0,78})[.:]\s/);
  return m ? m[1].trim() : "";
};

// A heading line is short and does not end mid-sentence. Contract bodies often
// begin with a number ("12 months' notice"), and without this guard every such
// paragraph forks a bogus clause.
const looksHeading = (line) => {
  const t = line.trim();
  if (!t || t.length > 160) return false;
  if (/[,;]$/.test(t)) return false;
  return true;
};

// Page furniture — e-sign banners and bare page numbers repeat on every page and
// would otherwise land inside whichever clause spans the page break.
const FURNITURE = /^\s*(?:\d{1,4}|Page\s+\d+(?:\s+of\s+\d+)?|(?:Zoho Sign|DocuSign|Docusign)\s+(?:Document|Envelope)\s+ID:.*)\s*$/;

export function splitClauses(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let cur = null;
  let ord = 0;

  const push = () => {
    if (!cur) return;
    cur.body = cur.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (cur.body || cur.title) out.push(cur);
    cur = null;
  };

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    if (FURNITURE.test(raw)) continue;
    let hit = null;

    // 1 · the number alone on its line, heading text on the next
    const numOnly = raw.match(NUM_ONLY);
    if (numOnly && plausibleRef(numOnly[1])) {
      let j = ln + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      hit = { ref: numOnly[1], title: titleFrom(lines[j]) };
    }

    // 2 · the explicit single-line forms
    if (!hit && looksHeading(raw)) {
      for (let i = 0; i < HEAD.length; i++) {
        const m = raw.match(HEAD[i]);
        if (!m) continue;
        if (i === 3) { hit = { ref: `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim(), title: (m[3] || "").trim() }; break; }
        if (/^\d/.test(m[1]) && !plausibleRef(m[1])) continue;   // an address, not a clause
        hit = { ref: m[1], title: (m[2] || "").trim() };
        break;
      }
    }
    if (hit && hit.ref) {
      push();
      const numeric = /^\d+(?:\.\d+)*$/.test(hit.ref);
      cur = {
        ord: ++ord,
        ref: numeric ? `§${hit.ref}` : hit.ref,
        title: hit.title,
        depth: numeric ? hit.ref.split(".").length : 1,
        parent_ref: numeric && hit.ref.includes(".")
          ? `§${hit.ref.slice(0, hit.ref.lastIndexOf("."))}` : null,
        body: [],
      };
    } else if (cur) {
      cur.body.push(raw);
    } else if (raw.trim()) {
      // preamble before the first numbered clause — recitals, parties, title
      cur = { ord: ++ord, ref: "§0", title: "Preamble", depth: 1, parent_ref: null, body: [raw] };
    }
  }
  push();

  // A document with almost no headings is prose (or a scan transcript). One
  // bogus "clause" holding 60,000 characters is worse than admitting there is
  // no clause structure to map.
  if (out.length < 3) return [];

  // The swallow guard, set from measurement rather than intuition.
  //
  // A scan taught us the failure: the Karnataka registration stamp on a lease
  // deed reads as "26.29", was accepted as a clause because it looks like one,
  // and then swallowed 54,819 characters — everything after a heading belongs to
  // it until the next heading. Two such stamps held 97% of a 38-page deed, and
  // the resulting 12-clause "index" was not incomplete but actively misleading:
  // Ask would cite §26.29 for anything at all.
  //
  // Tried a running sequence check first (contracts number upward, so §26.29
  // before §1 is rejectable). It regressed every contract tested: numbered list
  // items inside a clause body reset the counter, legitimate sections 2, 3, 4, 12
  // and 13 were discarded, and Insulet fell from 34 clauses to none. A rule that
  // needs the document to be well-behaved is no use on the documents that aren't.
  //
  // Tried "one clause holds >40% of the text" next. That killed Insulet too — its
  // §5.4 genuinely runs 28,143 characters, 46% of the agreement, and is correctly
  // attributed. Size alone does not mean wrong.
  //
  // What does separate them is the AVERAGE. Measured across the estate: ONEDIOS
  // 584 chars per clause, TJX 1,119, Insulet 1,813 — and the broken scan 8,333.
  // Real clauses run one to two thousand characters. If yours average eight
  // thousand, you have not found the clause structure, whatever the count says.
  const total = out.reduce((n, c) => n + c.body.length, 0);
  if (total > 20000 && total / out.length > 4000) return [];
  return out;
}

// ---- cross-references: the edges Ask can walk ------------------------------

// "pursuant to Section 15", "as defined in Clause 4.2", "subject to §7.1",
// "set out in Annexure III". Captured with the phrase, because the phrase is
// what tells you WHY the clauses are linked.
const XREF = /\b(?:pursuant to|subject to|in accordance with|as (?:defined|set out|described|provided) in|per|under|notwithstanding|except as (?:provided|set out) in|referred to in)\s+(?:§\s*|Sections?\s+|Clauses?\s+|Articles?\s+|Paragraphs?\s+)?(\d+(?:\.\d+)*|(?:Annexure|Schedule|Appendix|Exhibit)\s+[A-Z0-9IVXLC]+)/gi;

export function edgesFrom(clauses) {
  const known = new Set(clauses.map((c) => c.ref));
  const edges = [];
  const seen = new Set();
  for (const c of clauses) {
    for (const m of String(c.body || "").matchAll(XREF)) {
      const target = /^\d/.test(m[1]) ? `§${m[1]}` : m[1].replace(/\s+/g, " ");
      if (target === c.ref) continue;                    // a clause citing itself
      const key = `${c.ref}>${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from_ref: c.ref,
        to_ref: target,
        phrase: m[0].replace(/\s+/g, " ").trim().slice(0, 80),
        // an edge pointing nowhere is a finding, not a bug: contracts really do
        // cite schedules that were never attached
        resolved: known.has(target),
      });
    }
  }
  return edges;
}


// ---- defined-term edges -----------------------------------------------------
//
// The largest silent gap in the whole layer. "Services" is defined once, in one
// clause, and then used in forty — and not one of those forty says "as defined
// in §1.1", so no cross-reference exists to follow and no vector ranks the
// definition against a question about scope. The clause that decides what the
// words MEAN is invisible to every retrieval path we have.
//
// The definitions are already in hand: the splitter titles a definitions clause
// with the term it defines, because contracts print «"Services" means …».
const GENERIC = new Set(["agreement", "party", "parties", "person", "day", "days", "month", "year",
  "term", "notice", "law", "date", "business day", "writing"]);

export function definedTerms(clauses) {
  const terms = new Map();                       // lower term -> defining ref
  for (const c of clauses) {
    // ONLY the explicit «"X" means …» construction. Using the clause TITLE as a
    // term looked like free recall and was quietly wrong: it made "Termination",
    // "Expenses" and even "Preamble" into defined terms, so every clause that
    // said the word "termination" got an edge to the termination heading. A
    // heading is not a definition, and a wrong edge is worse than a missing one
    // because Ask follows it and reads the wrong clause with confidence.
    const cands = [];
    for (const m of String(c.body || "").matchAll(/["\u201c\u201d']([^"\u201c\u201d']{3,60})["\u201c\u201d']\s+(?:means|shall mean|has the meaning)/gi))
      cands.push(m[1]);
    for (const t of cands) {
      const k = t.trim().toLowerCase();
      if (k.length < 4 || GENERIC.has(k)) continue;
      if (!terms.has(k)) terms.set(k, { ref: c.ref, term: t.trim() });
    }
  }
  return terms;
}

// A clause that uses a defined term gets an edge TO the clause defining it —
// that direction, so Ask seeded on the clause you asked about can pull the
// meaning of the words in it. Capped per clause: a clause using eight defined
// terms does not need eight edges to be understood, and an uncapped join turns
// a 100-clause contract into thousands of rows nobody reads.
export function defineEdges(clauses, terms, { perClause = 4 } = {}) {
  const edges = [];
  for (const c of clauses) {
    const hay = String(c.body || "").toLowerCase();
    let n = 0;
    for (const [k, v] of terms) {
      if (v.ref === c.ref) continue;                       // the definition itself
      if (n >= perClause) break;
      // word-boundary match, so "service" does not fire on "services agreement"
      if (!new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay)) continue;
      edges.push({ from_ref: c.ref, to_ref: v.ref, phrase: `uses the defined term "${v.term}"`, resolved: true, kind: "defines" });
      n++;
    }
  }
  return edges;
}

// ---- HALF 2 · labels, batched ----------------------------------------------

// Small batches on purpose. The whole reason C2 came back empty was one call
// asked to carry everything; 25 clauses of trimmed text cannot overrun.
const BATCH = 25;
const TRIM = 1200;

export async function labelClauses(clauses, { onProgress } = {}) {
  const labels = new Map();
  for (let i = 0; i < clauses.length; i += BATCH) {
    const chunk = clauses.slice(i, i + BATCH);
    const payload = chunk.map((c) => `${c.ref} ${c.title || ""}\n${(c.body || "").slice(0, TRIM)}`).join("\n\n---\n\n");
    try {
      const out = await runPipeline("qlegal-atomize", { user: payload, maxTokens: 4000 });
      const parsed = JSON.parse((String(out.text || "").match(/\{[\s\S]*\}/) || ["{}"])[0]);
      for (const c of parsed.clauses || []) {
        if (c && c.ref) labels.set(String(c.ref).trim(), { label: c.label || "", gist: c.gist || "" });
      }
    } catch { /* a batch that fails leaves those clauses unlabelled — the § and
                 the verbatim text are already safe, which is the part that must
                 never depend on a model being reachable */ }
    if (onProgress) onProgress(Math.min(i + BATCH, clauses.length), clauses.length);
  }
  return labels;
}

// ---- the component: atomize one document -----------------------------------

export async function atomize(documentId, versionId, text, { label = true } = {}) {
  const clauses = splitClauses(text);
  if (!clauses.length) return { clauses: 0, edges: 0, labelled: 0, structured: false };

  const edges = edgesFrom(clauses).map((e) => ({ ...e, kind: "xref" }));
  const terms = definedTerms(clauses);
  const defs = defineEdges(clauses, terms);
  const labels = label ? await labelClauses(clauses) : new Map();

  await q(`delete from ql_clause where version_id = $1`, [versionId]);
  for (const c of clauses) {
    const l = labels.get(c.ref) || {};
    await q(
      `insert into ql_clause(document_id, version_id, ord, ref, parent_ref, depth, title, label, gist, body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [documentId, versionId, c.ord, c.ref, c.parent_ref, c.depth,
       c.title || null, l.label || null, l.gist || null, c.body || ""],
    );
  }
  await q(`delete from ql_clause_edge where version_id = $1`, [versionId]);
  for (const e of [...edges, ...defs]) {
    await q(
      `insert into ql_clause_edge(document_id, version_id, from_ref, to_ref, phrase, resolved, kind)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [documentId, versionId, e.from_ref, e.to_ref, e.phrase, e.resolved, e.kind || "xref"],
    );
  }
  return {
    clauses: clauses.length,
    edges: edges.length,
    defined_terms: terms.size,
    define_edges: defs.length,
    labelled: labels.size,
    unresolved: edges.filter((e) => !e.resolved).length,
    missing: [...new Set(edges.filter((e) => !e.resolved).map((e) => e.to_ref))].slice(0, 12),
    structured: true,
  };
}

// ---- readers ---------------------------------------------------------------

// The clause wiki: every clause, in document order, with its § anchor. Not the
// model's recollection of the clauses, and not capped at max_clauses — the
// whole contract, because "which clauses mention indemnity" is only a true
// answer if every clause was actually considered.
export async function clauseWiki(documentId) {
  const r = await q(
    `select ord, ref, parent_ref, depth, title, label, gist, body
       from ql_clause where document_id = $1 order by ord`, [documentId]);
  return r.rows;
}

// The navigation index — what the model reads FIRST to decide where to look.
//
// Handing a model 112 clauses in full is not retrieval, it is a haystack with
// the needle included. The index is the same clauses reduced to one indented
// line each, with the contract's own cross-references inlined, so the reading
// order is visible: go to §3.1 for the term, and §3.1 defers to §15.
// A short gist is deliberate — enough to route on, not enough to answer from,
// so the model fetches the real clause instead of paraphrasing a summary.
export async function clauseIndex(documentId, { gistChars = 90 } = {}) {
  const [clauses, edges] = await Promise.all([clauseWiki(documentId), clauseEdges(documentId)]);
  if (!clauses.length) return "";
  const byFrom = new Map();
  for (const e of [...edges, ...defs]) {
    if (!e.resolved || e.kind === "defines") continue;
    if (!byFrom.has(e.from_ref)) byFrom.set(e.from_ref, []);
    byFrom.get(e.from_ref).push(e.to_ref);
  }
  const lines = clauses.map((c) => {
    const pad = "  ".repeat(Math.max(0, (c.depth || 1) - 1));
    const topic = c.label || c.title || "";
    const gist = (c.gist || "").replace(/\s+/g, " ").slice(0, gistChars);
    const to = byFrom.get(c.ref);
    return `${pad}${c.ref}${topic ? ` · ${topic}` : ""}${gist ? ` — ${gist}` : ""}${to ? `  [see also ${[...new Set(to)].join(", ")}]` : ""}`;
  });
  const dangling = edges.filter((e) => !e.resolved);
  return lines.join("\n")
    + (dangling.length ? `\n(cites but does not contain: ${[...new Set(dangling.map((e) => e.to_ref))].join(", ")})` : "");
}

// ---- the parent routing map: the estate meta-wiki ---------------------------
//
// The clause index tells the model where to go INSIDE a contract. This tells it
// which contract to open at all — the rung above. Without it, "which agreements
// auto-renew this quarter" is answered from whichever five documents happened to
// rank, which is a sample presented as an answer.
//
// Derived live from ql_document + ql_clause rather than cached: an estate map is
// only useful if it is true, and a cache of 1000 contracts is a staleness bug
// waiting for the ingest that forgets to refresh it. Every ingestion updates the
// underlying rows, so the map grows by itself.
const ANCHORS = [
  ["term", /\bterm\b|duration/i], ["termination", /terminat/i],
  ["liability", /liabilit/i], ["indemnity", /indemn/i],
  ["confidentiality", /confidential|non-disclos/i], ["payment", /payment|fees|invoic/i],
  ["governing law", /governing law|jurisdiction|dispute/i], ["renewal", /renew/i],
];

export async function estateWiki({ limit = 1000 } = {}) {
  const docs = (await q(
    `select d.id, d.title, d.filename, d.doc_type, d.party1, d.party2, d.counterparty,
            d.tags, d.facts, d.latest_version, d.updated_at
       from ql_document d order by d.updated_at desc limit $1`, [limit])).rows;
  if (!docs.length) return { lines: [], count: 0 };

  const ids = docs.map((d) => Number(d.id));
  const counts = new Map();
  for (const r of (await q(`select document_id, count(*)::int n from ql_clause where document_id = any($1) group by 1`, [ids])).rows)
    counts.set(Number(r.document_id), r.n);

  // the § a lawyer jumps to first, per contract — routing, not content
  const anchorRows = (await q(
    `select document_id, ref, coalesce(nullif(label,''), title, '') t from ql_clause
      where document_id = any($1) and coalesce(nullif(label,''), title, '') <> '' order by ord`, [ids])).rows;
  const anchors = new Map();
  for (const r of anchorRows) {
    const id = Number(r.document_id);
    if (!anchors.has(id)) anchors.set(id, new Map());
    const m = anchors.get(id);
    for (const [name, re] of ANCHORS) if (!m.has(name) && re.test(r.t)) m.set(name, r.ref);
  }

  const lines = docs.map((d) => {
    const f = d.facts || {};
    const parties = [d.party1, d.party2 || d.counterparty].filter(Boolean).join(" ↔ ") || "parties not stated";
    // the C2 key names these effective_date / expiry_date — read what is written,
    // not what the field "should" be called, or every contract reports no dates
    const dates = f.effective_date
      ? `${f.effective_date} → ${f.expiry_date || (f.auto_renewal ? "auto-renews" : "no expiry stated")}`
      : "dates not stated";
    const a = anchors.get(Number(d.id));
    const jump = a && a.size ? ` · jump: ${[...a].map(([k, v]) => `${k} ${v}`).join(", ")}` : "";
    const n = counts.get(Number(d.id));
    const tags = Array.isArray(d.tags) ? d.tags.slice(0, 6).join(",") : "";
    return `[${d.id}] ${d.title || d.filename} · ${d.doc_type || "unclassified"} · ${parties} · ${dates}`
      + `${f.governing_law ? ` · ${f.governing_law}` : ""}${f.value ? ` · ${f.value}` : ""}`
      + ` · v${d.latest_version || 1}${n ? ` · ${n} clauses` : " · NOT ATOMIZED"}${tags ? ` · ${tags}` : ""}${jump}`;
  });
  return { lines, count: docs.length, atomized: [...counts.keys()].length };
}

export async function clauseEdges(documentId) {
  const r = await q(
    `select from_ref, to_ref, phrase, resolved, kind
       from ql_clause_edge where document_id = $1 order by from_ref`, [documentId]);
  return r.rows;
}

// Fetch specific clauses by §, plus everything they cite. This is the traversal
// Ask needs: asked about the term, you get the term clause AND the termination
// clause it defers to, instead of ranking them separately and hoping.
export async function clausesWithRefs(documentId, refs, { hops = 1 } = {}) {
  let want = new Set(refs.filter(Boolean));
  for (let h = 0; h < hops && want.size; h++) {
    const r = await q(
      `select to_ref from ql_clause_edge
        where document_id = $1 and from_ref = any($2::text[]) and resolved`,
      [documentId, [...want]]);
    const before = want.size;
    for (const row of r.rows) want.add(row.to_ref);
    if (want.size === before) break;
  }
  if (!want.size) return [];
  const r = await q(
    `select ord, ref, title, label, gist, body from ql_clause
      where document_id = $1 and ref = any($2::text[]) order by ord`,
    [documentId, [...want]]);
  return r.rows;
}

// ---- citation verification --------------------------------------------------
//
// Measured on the live estate: of four § citations in two answers, three were
// right and one was not — an answer about governing law cited Insulet §4.5,
// which is "Disputed Amount", about withholding payment on a disputed invoice.
//
// Note what that means for the design. The clause EXISTS, so checking existence
// alone would have waved it through. The check has to be about CONTENT: does the
// clause the model pointed at actually discuss what the sentence claims? We can
// ask that cheaply and deterministically, because every clause body is stored
// verbatim — no second model call, no judgement, just words on the page.
const STOP = new Set(["that", "this", "with", "from", "have", "which", "their", "there", "under", "shall",
  "will", "been", "into", "than", "then", "them", "these", "those", "your", "about", "would", "could",
  "agreement", "contract", "clause", "section", "party", "parties", "states", "stated"]);

const contentWords = (s) => [...new Set(String(s || "").toLowerCase().match(/[a-z]{5,}/g) || [])]
  .filter((w) => !STOP.has(w));

// Pull each § the answer cites, together with the sentence it sits in — the
// sentence is the claim being made, and the claim is what must be supported.
function citedRefs(answer) {
  const out = [];
  for (const sentence of String(answer || "").split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(/§\s*(\d+(?:\.\d+)*)/g))
      out.push({ ref: `§${m[1]}`, sentence: sentence.trim() });
  }
  return out;
}

export async function verifyCitations(answer, documentIds = []) {
  const refs = citedRefs(answer);
  if (!refs.length || !documentIds.length) return { checked: 0, ok: 0, suspect: [] };
  const rows = (await q(
    `select document_id, ref, coalesce(nullif(label,''), title, '') label, body
       from ql_clause where document_id = any($1)`, [documentIds])).rows;
  const byRef = new Map();
  for (const r of rows) {
    if (!byRef.has(r.ref)) byRef.set(r.ref, []);
    byRef.get(r.ref).push(r);
  }

  const suspect = [];
  let ok = 0;
  for (const { ref, sentence } of refs) {
    const cands = byRef.get(ref) || [];
    if (!cands.length) { suspect.push({ ref, why: "no clause with that reference exists in the documents read", sentence }); continue; }
    // supported if ANY candidate clause shares real vocabulary with the claim
    const want = contentWords(sentence);
    const supported = cands.some((c) => {
      const hay = `${c.label} ${c.body}`.toLowerCase();
      return want.filter((w) => hay.includes(w)).length >= 2;
    });
    if (supported) ok++;
    else suspect.push({ ref, why: `${ref} exists but reads as "${(cands[0].label || cands[0].body.slice(0, 60)).trim()}" — it does not discuss what this sentence claims`, sentence });
  }
  return { checked: refs.length, ok, suspect };
}
