// BigFlex engine orchestrator (factory). Inject your DB query fn, extract store,
// and a way to fetch a client's billing_rules box. Nothing app-specific here.
//
//   const engine = createEngine({ q, getExtract, getRuleBookBox, getRate });
//   await engine.saveLedger(client, docId, mapping);
//   const run = await engine.computeAndPersist(client, "2025-03");
import { compileRuleBook } from "./rulebook.js";
import { normalizeRow } from "./normalize.js";
import { computeRun, runWorkedExamples } from "./compute.js";

export function createEngine({ q, getExtract, getRuleBookBox, getRate, summaryFor, federation, epidemiology }) {
  // federation (optional): createFederation(q) from ../atlas/federation.js. When
  // supplied, a label confirmed on one contract auto-applies to its archetype
  // siblings — contract-level decisions still override the federated default.
  // epidemiology (optional): createEpidemiology(q) — after each run, refresh the
  // archetype's recurring-exception patterns so siblings get pre-warned.
  async function getDecisions(client) {
    const out = {};
    if (federation) try { Object.assign(out, await federation.decisionsFor(client)); } catch { /* */ }
    try { for (const x of (await q(`select topic, choice from decision where customer_id=(select id from customer where code=$1)`, [client])).rows || []) out[x.topic] = x.choice; } catch { /* */ }
    return out;
  }
  // record a clarification answer so federation can promote it across the archetype
  async function recordDecision(client, topic, choice) {
    await q(`insert into decision(customer_id, topic, choice, decided_by) values((select id from customer where code=$1),$2,$3,'host')
             on conflict (customer_id, topic) do update set choice=excluded.choice, decided_at=now()`, [client, topic, choice]).catch(() => {});
    if (federation) await federation.record(client, topic, choice).catch(() => {});
  }
  async function getRuleBook(client) {
    const box = await getRuleBookBox(client); // host supplies the billing_rules box
    return compileRuleBook(box || {});
  }

  async function saveLedger(client, docId, mapping) {
    let rows = []; try { rows = JSON.parse((await getExtract(client, `${docId}-rows`)) || "[]"); } catch { /* */ }
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

  async function computeAndPersist(client, month) {
    const ruleBook = await getRuleBook(client);
    const decisions = await getDecisions(client);
    let placements = [];
    try { placements = (await q(`select id, ext_id, name, raw from placement where customer_id=(select id from customer where code=$1)`, [client])).rows || []; } catch { /* */ }

    const clarMap = new Map();
    const ledger = placements.map((p) => {
      const { normalized, clarifications } = normalizeRow(p.raw || {}, ruleBook, decisions);
      for (const c of clarifications) clarMap.has(c.topic) ? clarMap.get(c.topic).rows_affected++ : clarMap.set(c.topic, { ...c, rows_affected: 1 });
      return { id: p.id, ext_id: p.ext_id, name: p.name || normalized.name, ...normalized };
    });
    const res = await computeRun({ month, ruleBook, ledger, getRate, currency: ruleBook.base_currency });
    const clarifications = [...clarMap.values()];

    // reuse the month's open draft run; only a released run is frozen
    let runNo = null;
    try {
      runNo = (await q(`select run_no from run where customer_id=(select id from customer where code=$1) and invoice_month=$2 and status<>'released' order by run_no desc limit 1`, [client, month])).rows?.[0]?.run_no ?? null;
      if (runNo == null) runNo = (await q(`select coalesce(max(run_no),0)+1 n from run where customer_id=(select id from customer where code=$1)`, [client])).rows[0].n;
    } catch { runNo = 1; }

    const manifest = { client, run_no: runNo, invoice_month: month, currency: ruleBook.base_currency, source: "engine",
      summary: summaryFor ? await summaryFor(client) : null, oss: res.oss, ta: res.ta, exceptions: res.exceptions,
      totals: res.totals, hc: res.hc, computed: res.ta.length, clarifications };

    try {
      const rid = (await q(`select id from run where customer_id=(select id from customer where code=$1) and run_no=$2`, [client, runNo])).rows?.[0]?.id;
      if (rid) for (const t of ["ta_calc", "oss_calc", "trace", "exception_item", "statement"]) await q(`delete from ${t} where run_id=$1`, [rid]).catch(() => {});
      const runId = (await q(`insert into run(customer_id, run_no, invoice_month, currency, label, status, manifest, started_at, finished_at)
        values((select id from customer where code=$1),$2,$3,$4,'engine','complete',$5::jsonb,now(),now())
        on conflict (customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now() returning id`,
        [client, runNo, month, ruleBook.base_currency, JSON.stringify(manifest)])).rows[0].id;
      if (res.oss) await q(`insert into oss_calc(run_id,invoice_month,opening_hc,new_joiners,exits,closing_active_hc,fee_type,rate,oss_amount,ccy,base_ccy,clause_ref,explain) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
        [runId, month, res.oss.opening_hc, res.oss.new_joiners, res.oss.exits, res.oss.closing_active_hc, res.oss.fee_type, res.oss.rate, res.oss.oss_amount, res.oss.ccy, res.oss.clause_ref, JSON.stringify(res.oss.calc_steps)]).catch(() => {});
      for (const t of res.ta) await q(`insert into ta_calc(run_id,invoice_month,referral,tech,level,total_ctc,ta_pct,gross_ta_fee,sourcing_billed,acceptance_billed,balance_billed,invoice_value,ccy,base_ccy,clause_ref,explain) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [runId, month, t.referral, t.tech, t.level, t.total_ctc, t.ta_pct, t.gross_ta_fee, t.sourcing_billed, t.acceptance_billed, t.balance_billed, t.invoice_value, t.ccy, t.base_ccy, t.clause_ref, JSON.stringify(t.calc_steps)]).catch(() => {});
      for (const tr of res.traces) await q(`insert into trace(run_id,object_type,value_num,value_ccy,base_ccy,why,clause_ref,calc_steps) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [runId, tr.object_type, tr.value_num, tr.value_ccy, tr.base_ccy, tr.why, tr.clause_ref, JSON.stringify(tr.calc_steps)]).catch(() => {});
      for (const e of res.exceptions) await q(`insert into exception_item(run_id,ext_id,issue,detail,severity,status) values($1,$2,$3,$4,$5,'open')`, [runId, e.ext_id || null, e.issue, e.detail, e.severity || "block"]).catch(() => {});
      await q(`insert into statement(run_id,customer_id,invoice_month,currency,total_oss,total_ta,grand_total) values($1,(select id from customer where code=$2),$3,$4,$5,$6,$7)`,
        [runId, client, month, ruleBook.base_currency, res.totals.oss, res.totals.ta, res.totals.grand]).catch(() => {});
    } catch { /* json-only */ }

    // refresh archetype exception epidemiology so siblings get pre-warned
    if (epidemiology) await epidemiology.record(client).catch(() => {});

    return { ok: true, run_no: runNo, month, totals: res.totals, computed: res.ta.length, exceptions: res.exceptions, clarifications, hc: res.hc };
  }

  async function selfTest(client) { return runWorkedExamples(await getRuleBook(client), getRate); }
  // prewarn (optional): the archetype's recurring exceptions for a (new) contract
  async function prewarn(client) { return epidemiology ? epidemiology.prewarn(client) : { archetype: null, warnings: [] }; }
  return { getDecisions, recordDecision, getRuleBook, saveLedger, computeAndPersist, selfTest, prewarn };
}
