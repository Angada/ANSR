// Atlas exception epidemiology — learn which exceptions recur across the
// contracts of an archetype, so a NEW contract of that shape is pre-warned and
// gets a suggested fix before its first run. Same moat idea as federation, but
// for failures instead of label mappings.
//
//   record(client)   → recompute the archetype's exception_patterns from every
//                      sibling's runs, persist to archetype.exception_patterns.
//   prewarn(client)  → the recurring exceptions for this contract's archetype,
//                      ranked by prevalence, each with a suggested fix.
//
// Prevalence = distinct contracts in the archetype that hit this issue ÷ members.

// Heuristic fix hint from the issue/detail text — generic, contract-agnostic.
export function suggestFix(issue = "", detail = "") {
  const s = `${issue} ${detail}`.toLowerCase();
  if (/no[_ ]?rate|rate table|no rate for/.test(s)) return "Add the missing rate-table row (level/band/referral) to the rule book.";
  if (/unmapped|no normalizer|source|referral|label/.test(s)) return "Add a normalizer/decision for the unmapped label — confirm once, federation applies it to siblings.";
  if (/date|ambiguous|dd\/mm|format/.test(s)) return "Confirm the date format for this column in the rule book inputs.";
  if (/missing|absent|required|empty|null/.test(s)) return "Mark the field required in the worksheet and validate at ingest.";
  if (/currency|fx|rate|inr|convert/.test(s)) return "Set the FX basis (live or fixed) for this currency on the contract.";
  if (/duplicate|dup|conflict/.test(s)) return "De-duplicate on ext_id before staging the ledger.";
  if (/rule|operator|unsupported|kind/.test(s)) return "Rule book needs a human — add the operator/cost-head or flag the clause.";
  return "Review this exception in the playbook; resolve once and promote across the archetype.";
}

export function createEpidemiology(q) {
  async function archetypeOf(client) {
    try {
      const r = await q(`select a.id, a.slug from contract_fingerprint f join archetype a on a.id=f.archetype_id
                         where f.customer_id=(select id from customer where code=$1)`, [client]);
      return r.rows?.[0] || null;
    } catch { return null; }
  }

  // distinct issue tallies across every contract routed to this archetype
  async function patternsFor(archetypeId) {
    let members = 1;
    try { members = Number((await q(`select count(*) n from contract_fingerprint where archetype_id=$1`, [archetypeId])).rows?.[0]?.n) || 1; } catch { /* */ }
    let rows = [];
    try {
      rows = (await q(
        `select e.issue,
                count(distinct cu.id) contracts_hit,
                count(*)              occurrences,
                max(e.detail)         sample,
                max(e.severity)       severity
         from exception_item e
         join run r  on r.id = e.run_id
         join customer cu on cu.id = r.customer_id
         join contract_fingerprint f on f.customer_id = cu.id
         where f.archetype_id = $1
         group by e.issue
         order by contracts_hit desc, occurrences desc`, [archetypeId])).rows || [];
    } catch { /* */ }
    return rows.map((r) => ({
      issue: r.issue,
      contracts_hit: Number(r.contracts_hit),
      occurrences: Number(r.occurrences),
      prevalence: Math.round((Number(r.contracts_hit) / members) * 100) / 100,
      severity: r.severity || "block",
      sample: r.sample || null,
      fix: suggestFix(r.issue, r.sample || ""),
    }));
  }

  // recompute + persist the archetype's exception epidemiology after a run
  async function record(client) {
    const a = await archetypeOf(client);
    if (!a) return null;
    const patterns = await patternsFor(a.id);
    await q(`update archetype set exception_patterns=$2::jsonb, updated_at=now() where id=$1`,
      [a.id, JSON.stringify(patterns)]).catch(() => {});
    return { archetype: a.slug, patterns };
  }

  // pre-warn a (possibly new) contract using its archetype's known patterns.
  // only surfaces recurring ones (hit by >1 contract OR prevalence ≥ .5).
  async function prewarn(client) {
    const a = await archetypeOf(client);
    if (!a) return { archetype: null, warnings: [] };
    const patterns = await patternsFor(a.id);
    const warnings = patterns.filter((p) => p.contracts_hit > 1 || p.prevalence >= 0.5);
    return { archetype: a.slug, warnings };
  }

  return { record, prewarn, patternsFor, archetypeOf };
}
