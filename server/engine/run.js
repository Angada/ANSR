// Orchestrates the calc run: stage ledger → normalize (with decisions) →
// compute → persist (ta_calc/oss_calc/trace/exception/statement/run).
import { q } from "../db/client.js";
import { getExtract } from "../storage.js";
import { stubAnalysis } from "../stub.js";
import { getRate } from "../fx.js";
import { compileRuleBook } from "./rulebook.js";
import { normalizeRow } from "./normalize.js";
import { computeRun, runWorkedExamples } from "./compute.js";
import { createFederation } from "../atlas/federation.js";

const cid = (client) => `(select id from customer where code='${client.replace(/'/g, "")}')`;
export const federation = createFederation(q);

export async function getDecisions(client) {
  const out = {};
  // Atlas federation: archetype/global-promoted mappings auto-apply (contract decisions override)
  try { Object.assign(out, await federation.decisionsFor(client)); } catch { /* */ }
  try { const r = await q(`select topic, choice from decision where customer_id=(select id from customer where code=$1)`, [client]); for (const x of r.rows || []) out[x.topic] = x.choice; } catch { /* */ }
  return out;
}

export async function getRuleBook(client) {
  let box = null;
  try {
    const r = await q(`select manifest from run where customer_id=(select id from customer where code=$1) order by run_no desc limit 1`, [client]);
    const man = r.rows?.[0]?.manifest;
    // Atlas template-fill: an already-compiled rule book (from a matched archetype) wins.
    if (man?.compiled_rule_book?.cost_heads?.length) return man.compiled_rule_book;
    box = (man?.boxes || []).find((b) => b.box_type_code === "billing_rules");
  } catch { /* */ }
  if (!box) box = stubAnalysis(client).boxes.find((b) => b.box_type_code === "billing_rules");
  return compileRuleBook(box);
}

// Re-read the parsed rows, map raw→canonical, upsert into the placement ledger.
export async function saveLedger(client, docId, mapping) {
  let rows = [];
  try { rows = JSON.parse((await getExtract(client, `${docId}-rows`)) || "[]"); } catch { /* */ }
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const raw = {}; for (const [field, header] of Object.entries(mapping || {})) raw[field] = rows[i][header];
    const ext = String(raw.ext_id ?? "").trim() || `row-${i + 1}`;
    try {
      await q(`insert into placement(customer_id, ext_id, name, raw, source_row)
               values((select id from customer where code=$1), $2, $3, $4::jsonb, $5)
               on conflict (customer_id, ext_id) do update set raw=excluded.raw, name=excluded.name`,
        [client, ext, raw.name ?? null, JSON.stringify(raw), i + 1]);
      n++;
    } catch { /* */ }
  }
  return n;
}

export async function computeAndPersist(client, month) {
  const ruleBook = await getRuleBook(client);
  const decisions = await getDecisions(client);
  let placements = [];
  try { placements = (await q(`select id, ext_id, name, raw from placement where customer_id=(select id from customer where code=$1)`, [client])).rows || []; } catch { /* */ }

  const clarMap = new Map();
  const ledger = placements.map((p) => {
    const { normalized, clarifications } = normalizeRow(p.raw || {}, ruleBook, decisions);
    for (const c of clarifications) if (!clarMap.has(c.topic)) clarMap.set(c.topic, { ...c, rows_affected: 1 }); else clarMap.get(c.topic).rows_affected++;
    return { id: p.id, ext_id: p.ext_id, name: p.name || normalized.name, ...normalized };
  });

  const res = await computeRun({ month, ruleBook, ledger, getRate, currency: ruleBook.base_currency });
  const clarifications = [...clarMap.values()];

  // reuse the month's open draft run (the clarify loop edits in place); only a
  // released run is frozen → a fresh compute then opens a new version.
  let runNo = null;
  try {
    const ex = await q(`select run_no from run where customer_id=(select id from customer where code=$1) and invoice_month=$2 and status<>'released' order by run_no desc limit 1`, [client, month]);
    runNo = ex.rows?.[0]?.run_no ?? null;
    if (runNo == null) runNo = (await q(`select coalesce(max(run_no),0)+1 n from run where customer_id=(select id from customer where code=$1)`, [client])).rows[0].n;
  } catch { runNo = 1; }
  // wipe prior facts for this run before re-inserting (idempotent recompute)
  try {
    const rid = (await q(`select id from run where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, runNo])).rows?.[0]?.id;
    if (rid) { for (const tbl of ["ta_calc", "oss_calc", "trace", "exception_item"]) await q(`delete from ${tbl} where run_id=$1`, [rid]).catch(() => {}); await q(`delete from statement where run_id=$1`, [rid]).catch(() => {}); }
  } catch { /* */ }

  const manifest = {
    client, run_no: runNo, invoice_month: month, currency: ruleBook.base_currency, source: "engine",
    steps: ["Normalising rows", "Active headcount", "TA rate lookup + FX", "Milestone split", "Statement"],
    summary: { title: "Contract summary", text: stubAnalysis(client).summary.text }, findings: stubAnalysis(client).findings,
    boxes: stubAnalysis(client).boxes,
    oss: res.oss, ta: res.ta, exceptions: res.exceptions, totals: res.totals, hc: res.hc,
    computed: res.ta.length, clarifications,
  };

  // persist run + facts (best-effort)
  try {
    const runId = (await q(`insert into run(customer_id, run_no, invoice_month, currency, label, status, manifest, started_at, finished_at)
      values((select id from customer where code=$1),$2,$3,$4,'engine','complete',$5::jsonb,now(),now())
      on conflict (customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now() returning id`,
      [client, runNo, month, ruleBook.base_currency, JSON.stringify(manifest)])).rows[0].id;
    if (res.oss) await q(`insert into oss_calc(run_id, invoice_month, opening_hc, new_joiners, exits, closing_active_hc, fee_type, rate, oss_amount, ccy, base_ccy, clause_ref, explain)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
      [runId, month, res.oss.opening_hc, res.oss.new_joiners, res.oss.exits, res.oss.closing_active_hc, res.oss.fee_type, res.oss.rate, res.oss.oss_amount, res.oss.ccy, res.oss.clause_ref, JSON.stringify(res.oss.calc_steps)]).catch(() => {});
    for (const t of res.ta) await q(`insert into ta_calc(run_id, invoice_month, referral, tech, level, total_ctc, ta_pct, gross_ta_fee, sourcing_billed, acceptance_billed, balance_billed, invoice_value, ccy, base_ccy, clause_ref, explain)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [runId, month, t.referral, t.tech, t.level, t.total_ctc, t.ta_pct, t.gross_ta_fee, t.sourcing_billed, t.acceptance_billed, t.balance_billed, t.invoice_value, t.ccy, t.base_ccy, t.clause_ref, JSON.stringify(t.calc_steps)]).catch(() => {});
    for (const tr of res.traces) await q(`insert into trace(run_id, object_type, value_num, value_ccy, base_ccy, why, clause_ref, calc_steps) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [runId, tr.object_type, tr.value_num, tr.value_ccy, tr.base_ccy, tr.why, tr.clause_ref, JSON.stringify(tr.calc_steps)]).catch(() => {});
    for (const e of res.exceptions) await q(`insert into exception_item(run_id, ext_id, issue, detail, severity, status) values($1,$2,$3,$4,$5,'open')`,
      [runId, e.ext_id || null, e.issue, e.detail, e.severity || "block"]).catch(() => {});
    await q(`insert into statement(run_id, customer_id, invoice_month, currency, total_oss, total_ta, grand_total)
      values($1,(select id from customer where code=$2),$3,$4,$5,$6,$7)`,
      [runId, client, month, ruleBook.base_currency, res.totals.oss, res.totals.ta, res.totals.grand]).catch(() => {});
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('vik','run.compute','run',$1,$2::jsonb)`,
      [`${client}#${runNo}`, JSON.stringify({ computed: res.ta.length, exceptions: res.exceptions.length, totals: res.totals })]).catch(() => {});
  } catch { /* json-only */ }

  return { ok: true, run_no: runNo, month, totals: res.totals, computed: res.ta.length, exceptions: res.exceptions, clarifications, hc: res.hc };
}

export { runWorkedExamples };
