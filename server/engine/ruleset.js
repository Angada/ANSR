// Contract Compiler: turn a canonical rule-set spec (dimensions + heads + sparse
// rate cells) into the executable rule book the engine already runs (computeRun),
// and validate it (coverage + worked examples). Persist rule_set / rule_dimension
// / rule_head / rate_cell / rule_validation.
//
// spec = {
//   base_currency, source_doc_id,
//   dimensions: [{ name, source_column, type, allowed_values:[...] }],
//   heads: [{ code, label, kind, measure, base, dimensions:[...], slabs, milestones, rate_field, clause_ref }],
//   cells: [{ head_code, dims:{...}, pct?, amount?, fee_type?, clause_ref? }],
//   worked_examples: [...]
// }
import { coverage } from "./coverage.js";
import { computeRun, runWorkedExamples } from "./compute.js";

// cells → a head's rate_table.rows the engine's rateLookup consumes
function ruleBookFromSpec(spec) {
  const cost_heads = (spec.heads || []).map((h) => {
    const head = { code: h.code, label: h.label, kind: h.kind, measure: h.measure, base: h.base, clause_ref: h.clause_ref };
    if (h.slabs) head.slabs = h.slabs;
    if (h.milestones) head.milestones = h.milestones;
    if (typeof h.rate === "number") head.rate = h.rate;          // per_unit
    if (typeof h.amount === "number") head.amount = h.amount;    // flat / credit / clawback
    if (h.kind === "one_time_split" || (h.dimensions && h.dimensions.length)) {
      const rows = (spec.cells || []).filter((c) => c.head_code === h.code).map((c) => ({ ...c.dims, pct: c.pct, amount: c.amount, fee_type: c.fee_type }));
      head.rate_table = { keys: h.dimensions || [], rows };
    }
    return head;
  });
  return { base_currency: spec.base_currency || "USD", inputs: spec.inputs || [], normalizers: spec.normalizers || {}, cost_heads, worked_examples: spec.worked_examples || [] };
}

export function compileSpec(spec) {
  return { ruleBook: ruleBookFromSpec(spec), coverage: coverage(spec) };
}

export async function validateSpec(spec, getRate = async () => ({ rate: 1, source: "same" })) {
  const cov = coverage(spec);
  const examples = await runWorkedExamples(ruleBookFromSpec(spec), getRate);
  const allPass = examples.every((e) => e.pass);
  const status = cov.conflicts.length ? "red" : (cov.coverage_pct >= 100 && allPass) ? "green" : cov.coverage_pct >= 80 ? "amber" : "red";
  return { coverage_pct: cov.coverage_pct, status, gaps: cov.gaps, conflicts: cov.conflicts, examples, per_head: cov.per_head };
}

// persist a spec as a new rule_set version (+ dims, heads, cells, validation)
export async function buildRuleSet(q, client, spec, opts = {}) {
  const ruleBook = ruleBookFromSpec(spec);
  const v = await validateSpec(spec);
  const cid = (await q(`select id from customer where code=$1`, [client])).rows?.[0]?.id;
  if (!cid) throw new Error(`unknown client ${client}`);
  const verNo = opts.version || ((await q(`select coalesce(max(version_no),0)+1 n from rule_set where customer_id=$1`, [cid])).rows[0].n);
  await q(`update rule_set set status='superseded' where customer_id=$1 and status<>'superseded'`, [cid]).catch(() => {});
  const status = opts.lock ? "locked" : "validated";
  const rsId = (await q(
    `insert into rule_set(customer_id, version_no, status, base_currency, source_doc_id, compiled, coverage_pct, validated_at, locked_at)
     values($1,$2,$3,$4,$5,$6::jsonb,$7,now(),$8) returning id`,
    [cid, verNo, status, ruleBook.base_currency, spec.source_doc_id || null, JSON.stringify(ruleBook), v.coverage_pct, opts.lock ? new Date().toISOString() : null]
  )).rows[0].id;
  for (const d of spec.dimensions || []) await q(`insert into rule_dimension(rule_set_id,name,source_column,type,allowed_values) values($1,$2,$3,$4,$5::jsonb) on conflict do nothing`, [rsId, d.name, d.source_column || d.name, d.type || "enum", JSON.stringify(d.allowed_values || [])]).catch(() => {});
  for (const h of spec.heads || []) await q(`insert into rule_head(rule_set_id,code,label,kind,measure,base,dimensions,slabs,schedule,rate_field,clause_ref,ord) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) on conflict do nothing`,
    [rsId, h.code, h.label || h.code, h.kind, h.measure || null, h.base || null, h.dimensions || null, JSON.stringify(h.slabs || null), JSON.stringify(h.milestones || null), h.rate_field || "pct", h.clause_ref || null, h.ord || 0]).catch(() => {});
  for (const c of spec.cells || []) await q(`insert into rate_cell(rule_set_id,head_code,dims,pct,amount,fee_type,clause_ref) values($1,$2,$3::jsonb,$4,$5,$6,$7)`, [rsId, c.head_code, JSON.stringify(c.dims), c.pct ?? null, c.amount ?? null, c.fee_type || null, c.clause_ref || null]).catch(() => {});
  await q(`insert into rule_validation(rule_set_id,coverage_pct,status,gaps,conflicts,examples) values($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
    [rsId, v.coverage_pct, v.status, JSON.stringify(v.gaps), JSON.stringify(v.conflicts), JSON.stringify(v.examples)]).catch(() => {});
  return { rule_set_id: rsId, version_no: verNo, status, ruleBook, validation: v };
}

// the locked/validated rule book for a client (compute reads this first)
export async function getRuleSet(q, client) {
  try {
    const r = await q(`select rs.compiled, rs.coverage_pct, rs.status, rs.version_no from rule_set rs
                       where rs.customer_id=(select id from customer where code=$1) and rs.status<>'superseded'
                       order by (rs.status='locked') desc, rs.version_no desc limit 1`, [client]);
    return r.rows?.[0] || null;
  } catch { return null; }
}
