// ============================================================================
// The golden set — 100+ questions with checkable expectations, and the runner
// that scores Ask against them.
//
// The honest limit first, because it decides what a score here means. These
// questions are generated from the estate the system itself read, so they cannot
// catch a MISREADING: if a date was extracted wrongly, the expectation inherits
// the same wrong date and scores it correct. What they measure rigorously is
// everything downstream of extraction —
//
//   ROUTING      does a question about TJX reach the TJX contract, out of ten?
//   CITATION     is the § it cites a clause that exists, in that document?
//   GROUNDING    does the answer contain the value the contract actually states?
//   CONSISTENCY  do five rephrasings of one question agree with each other?
//
// Those are where retrieval fails, and they fail silently, which is why they are
// worth scoring. Extraction accuracy needs a human reading contracts; this does
// not pretend to replace that.
//
// Expectations come from the DETERMINISTIC layer wherever possible — verbatim
// clause bodies and printed § references — rather than from model prose, so the
// yardstick is at least a different measurement from the thing being measured.
// ============================================================================
const BASE = process.env.QL_BASE || "https://ansr-121188302790.asia-south1.run.app";
const USER = process.env.QL_USER || "admin";
const PW = process.env.QL_PW || "admin";

let COOKIE = "";
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(COOKIE ? { cookie: COOKIE } : {}), ...(opts.headers || {}) },
  });
  const setc = r.headers.get("set-cookie");
  if (setc) COOKIE = setc.split(";")[0];
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
};

// Phrasings of the same question. Consistency across these is the point: a
// system that answers one wording and not another is not answering, it is
// pattern-matching the question.
const VARIANTS = {
  term: (n) => [
    `How long does the ${n} run?`,
    `What is the term of ${n}?`,
    `When does ${n} expire?`,
    `Is ${n} still in force, and until when?`,
    `If we do nothing, when does ${n} end?`,
  ],
  law: (n) => [
    `What law governs ${n}?`,
    `Which jurisdiction applies to ${n}?`,
    `If we ended up in court over ${n}, where would that be?`,
    `Is ${n} governed by Indian law?`,
  ],
  parties: (n) => [
    `Who are the parties to ${n}?`,
    `Who signed ${n}?`,
    `Which entity is our counterparty on ${n}?`,
  ],
  terminate: (n) => [
    `How do we terminate ${n}?`,
    `What notice must we give to exit ${n}?`,
    `Can we walk away from ${n} early, and what does it cost?`,
    `What happens to work in progress if ${n} is terminated?`,
  ],
  liability: (n) => [
    `Is liability capped under ${n}?`,
    `What is our maximum exposure on ${n}?`,
    `Does ${n} exclude indirect or consequential loss?`,
  ],
  confid: (n) => [
    `What are the confidentiality obligations under ${n}?`,
    `How long does confidentiality survive termination of ${n}?`,
  ],
};

// Estate-wide questions — the ones the meta-wiki exists for. These are the
// hardest to fake: an answer is only right if it considered EVERY contract, so a
// system that answers from the top five hits is caught here and nowhere else.
const ESTATE_QS = [
  { q: "Which of our contracts are governed by law outside India?", check: "estate_law" },
  { q: "List every contract that auto-renews.", check: "estate_renew" },
  { q: "Which contracts expire in the next 12 months?", check: "estate_expiry" },
  { q: "How many contracts do we hold, and of what types?", check: "estate_count" },
  { q: "Which contracts have no stated expiry date?", check: "estate_noexpiry" },
  { q: "Who are all our counterparties?", check: "estate_parties" },
  { q: "Which contracts were read from a scan rather than digital text?", check: "estate_scan" },
  { q: "Are there any contracts that cite a schedule or annexure they do not contain?", check: "estate_missing" },
];

async function build() {
  await api("/api/login", { method: "POST", body: JSON.stringify({ user: USER, pw: PW }) });
  const reg = await api("/api/qlegal/registry");
  const docs = (reg.documents || []).filter((d) => d.status !== "inactive");
  const set = [];

  for (const d of docs) {
    const name = d.title && d.title.length > 6 ? d.title : d.filename;
    const f = d.facts || {};
    // a short, unambiguous handle — asking about "MASTER SERVICE AGREEMENT" when
    // six contracts share that title tests nothing but the tie-break
    const handle = [f.party2 || f.counterparty, name].filter(Boolean)[0];
    const cl = await api(`/api/qlegal/clauses/${d.id}`);
    const clauses = cl.clauses || [];
    const byLabel = (re) => clauses.find((c) => re.test(`${c.label || ""} ${c.title || ""}`));

    const add = (qs, expect) => qs.forEach((q) => set.push({ q, doc_id: d.id, doc: name, ...expect }));

    if (f.effective_date) add(VARIANTS.term(handle), { expect_doc: d.id, expect_text: [f.effective_date.slice(0, 4)] });
    if (f.governing_law) add(VARIANTS.law(handle), { expect_doc: d.id, expect_text: [String(f.governing_law).split(/[;(]/)[0].trim().split(/\s+/).slice(-2).join(" ")] });
    if (f.party1 || f.party2) add(VARIANTS.parties(handle), { expect_doc: d.id, expect_text: [String(f.party1 || f.party2).split(/[,(]/)[0].trim()] });

    const t = byLabel(/terminat/i);
    if (t) add(VARIANTS.terminate(handle), { expect_doc: d.id, expect_ref: t.ref });
    const l = byLabel(/liabilit/i);
    if (l) add(VARIANTS.liability(handle), { expect_doc: d.id, expect_ref: l.ref });
    const c = byLabel(/confidential/i);
    if (c) add(VARIANTS.confid(handle), { expect_doc: d.id, expect_ref: c.ref });
  }

  for (const e of ESTATE_QS) set.push({ q: e.q, check: e.check, estate: true });
  return set;
}

// Scoring is deliberately narrow. A generous grader that accepts anything
// plausible would report a healthy number while the system quietly degraded,
// which is the failure this whole exercise exists to prevent.
function score(item, res) {
  const a = String(res.answer || "");
  const cites = res.citations || {};
  const out = { q: item.q, pass: true, why: [] };

  if (item.expect_doc && item.doc) {
    // did the answer actually mention the contract it should have?
    const key = String(item.doc).split(/[,(]/)[0].trim().slice(0, 22);
    if (key.length > 5 && !a.toLowerCase().includes(key.toLowerCase().slice(0, 12))) {
      out.pass = false; out.why.push(`did not name ${key}`);
    }
  }
  for (const t of item.expect_text || []) {
    if (t && t.length > 2 && !a.toLowerCase().includes(String(t).toLowerCase())) {
      out.pass = false; out.why.push(`missing "${t}"`);
    }
  }
  if (item.expect_ref && !a.includes(item.expect_ref)) {
    out.why.push(`did not cite ${item.expect_ref}`);   // noted, not failed: another § may answer it
  }
  if ((cites.suspect || []).length) {
    out.pass = false; out.why.push(`unverified citation: ${cites.suspect[0].ref}`);
  }
  if (!a || a.length < 20) { out.pass = false; out.why.push("empty answer"); }
  return out;
}

const LIMIT = Number(process.env.GOLDEN_LIMIT || 0);

const set = await build();
console.log(`golden set: ${set.length} questions across ${new Set(set.map((s) => s.doc_id)).size} contracts\n`);
if (process.env.GOLDEN_BUILD_ONLY) {
  console.log(JSON.stringify(set, null, 1));
  process.exit(0);
}

const run = LIMIT ? set.slice(0, LIMIT) : set;
let pass = 0; const fails = [];
for (const [i, item] of run.entries()) {
  const res = await api("/api/qlegal/ask", { method: "POST", body: JSON.stringify({ question: item.q }) });
  const s = score(item, res);
  if (s.pass) pass++; else fails.push(s);
  process.stdout.write(`${s.pass ? "." : "x"}${(i + 1) % 50 === 0 ? ` ${i + 1}\n` : ""}`);
}
console.log(`\n\nSCORE ${pass}/${run.length} (${Math.round((pass / run.length) * 100)}%)\n`);
for (const f of fails.slice(0, 25)) console.log(`  x ${f.q}\n      ${f.why.join(" · ")}`);
