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

  const edges = edgesFrom(clauses);
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
  for (const e of edges) {
    await q(
      `insert into ql_clause_edge(document_id, version_id, from_ref, to_ref, phrase, resolved)
       values ($1,$2,$3,$4,$5,$6)`,
      [documentId, versionId, e.from_ref, e.to_ref, e.phrase, e.resolved],
    );
  }
  return {
    clauses: clauses.length,
    edges: edges.length,
    labelled: labels.size,
    unresolved: edges.filter((e) => !e.resolved).length,
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

export async function clauseEdges(documentId) {
  const r = await q(
    `select from_ref, to_ref, phrase, resolved
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
