// Seed sample contracts with WILDLY different billing structures so they show in
// the client dropdown and compute live. Each gets: a customer, a run (run_no 1)
// carrying the compiled rule book + a precomputed outcome (so picking it shows
// numbers instantly), and placements (so Calculate / Recalibrate re-runs it).
// Run: U="$DATABASE_URL" node scripts/seed-samples.mjs
import pg from "pg";
import { computeRun } from "../server/engine/compute.js";

const pool = new pg.Pool({ connectionString: process.env.U });
const q = (t, p) => pool.query(t, p);
const getRate = async () => ({ rate: 1, source: "same" });

const box = (code, title, content, ai_explain, clause_ref) => ({ id: code, box_type_code: code, title, content, ai_explain, confidence: 0.95, clause_ref, status: "approved", chat: [], suggestions: [] });

const SAMPLES = [
  {
    code: "ACME-SAAS", name: "Acme SaaS", text: "SaaS platform billing: a fixed monthly platform fee plus usage — per active seat and per API call. No headcount, no recruitment fee.",
    findings: ["Flat platform fee billed every month.", "Per-seat charge × active seats.", "Per-API-call charge × call volume.", "No TA/OSS — pure SaaS usage billing."],
    rb: { base_currency: "USD", inputs: [{ field: "seats", why: "per-seat fee" }, { field: "api_calls", why: "per-call fee" }], cost_heads: [
      { code: "platform", kind: "flat", amount: 5000, clause_ref: "§1" },
      { code: "seats", kind: "per_unit", rate: 25, measure: "seats", clause_ref: "§2" },
      { code: "api_calls", kind: "per_unit", rate: 0.002, measure: "api_calls", clause_ref: "§3" },
    ] },
    rows: [{ ext_id: "org-a", name: "Org A", raw: { seats: 40, api_calls: 120000 } }, { ext_id: "org-b", name: "Org B", raw: { seats: 60, api_calls: 300000 } }],
  },
  {
    code: "BETA-CLOUD", name: "Beta Cloud", text: "Cloud storage billing: a tiered slab on total GB stored, plus an SLA-breach credit. No headcount, no recruitment fee.",
    findings: ["Storage billed by a GB slab (minimum below 1 TB, per-GB above).", "SLA-breach credit applied as a negative line.", "No TA/OSS — usage + credit."],
    rb: { base_currency: "USD", inputs: [{ field: "gb_stored", why: "storage slab" }], cost_heads: [
      { code: "storage", kind: "recurring_slab", measure: "gb_stored", slabs: [{ hc_min: 0, hc_max: 1000, fee_type: "minimum", rate: 300 }, { hc_min: 1001, hc_max: 100000000, fee_type: "per_resource", rate: 0.10 }], clause_ref: "§4" },
      { code: "sla_credit", kind: "credit", amount: 150, reason: "SLA breach", clause_ref: "§9" },
    ] },
    rows: [{ ext_id: "bucket-1", name: "bucket-1", raw: { gb_stored: 5000 } }, { ext_id: "bucket-2", name: "bucket-2", raw: { gb_stored: 8000 } }],
  },
  {
    code: "GAMMA-CONSULTING", name: "Gamma Consulting", text: "Professional services billing: a fixed monthly retainer plus billable hours, with an occasional goodwill credit. No headcount, no recruitment fee.",
    findings: ["Fixed monthly retainer.", "Billable hours × hourly rate.", "Goodwill credit as a negative line.", "No TA/OSS — retainer + time."],
    rb: { base_currency: "USD", inputs: [{ field: "hours", why: "billable hours" }], cost_heads: [
      { code: "retainer", kind: "flat", amount: 12000, clause_ref: "§1" },
      { code: "billable_hours", kind: "per_unit", rate: 250, measure: "hours", clause_ref: "§3" },
      { code: "goodwill_credit", kind: "credit", amount: 500, reason: "goodwill", clause_ref: "§8" },
    ] },
    rows: [{ ext_id: "eng-1", name: "Engagement 1", raw: { hours: 120 } }, { ext_id: "eng-2", name: "Engagement 2", raw: { hours: 40 } }],
  },
  {
    code: "KENVUE-GCC", name: "Kenvue GCC", text: "GCC build-and-operate: a one-time TA recruitment fee (% of CTC, split across milestones) plus a recurring monthly OSS fee by active headcount. The classic TA+OSS structure.",
    findings: ["TA fee = % of total CTC by level × referral, split across milestones.", "OSS fee = monthly by active headcount slab (no pro-rata).", "Both revenue lines on one contract."],
    rb: { base_currency: "USD", inputs: [{ field: "join_date", why: "active headcount + balance milestone" }, { field: "total_ctc", why: "base of TA fee" }, { field: "sourcing_date", why: "sourcing milestone" }], cost_heads: [
      { code: "oss", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 50, fee_type: "minimum", rate: 22000 }, { hc_min: 51, hc_max: 250, fee_type: "per_resource", rate: 530 }], clause_ref: "§4" },
      { code: "ta", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ level: "manager", referral: false, pct: 9.5 }, { level: "manager", referral: true, pct: 7 }] },
        milestones: [{ code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: 400, nontech: 300 } }], clause_ref: "§3" },
    ] },
    rows: [
      ...Array.from({ length: 12 }, (_, i) => ({ ext_id: `e${i + 1}`, name: `Resource ${i + 1}`, raw: { level: "manager", referral: false, tech: true, join_date: "2024-06-01", total_ctc: 80000, ctc_ccy: "USD" } })),
      { ext_id: "h1", name: "New Hire (Asha)", raw: { level: "manager", referral: false, tech: true, sourcing_date: "2025-03-05", join_date: "2025-03-20", total_ctc: 120000, ctc_ccy: "USD" } },
    ],
  },
];

const MONTH = "2025-03";
for (const s of SAMPLES) {
  await q(`insert into customer(code,name,currency,billing_ccy,contract_ccy) values($1,$2,'USD','USD','USD') on conflict(code) do update set name=excluded.name`, [s.code, s.name]);
  const cid = (await q(`select id from customer where code=$1`, [s.code])).rows[0].id;
  // placements (the ledger)
  await q(`delete from placement where customer_id=$1`, [cid]).catch(() => {});
  for (let i = 0; i < s.rows.length; i++) await q(`insert into placement(customer_id, ext_id, name, raw, source_row) values($1,$2,$3,$4::jsonb,$5) on conflict (customer_id, ext_id) do update set raw=excluded.raw`, [cid, s.rows[i].ext_id, s.rows[i].name, JSON.stringify(s.rows[i].raw), i + 1]);
  // compute the outcome with the real engine
  const ledger = s.rows.map((r) => ({ ext_id: r.ext_id, name: r.name, ...r.raw }));
  const res = await computeRun({ month: MONTH, ruleBook: s.rb, ledger, getRate, currency: "USD" });
  const manifest = {
    client: s.code, run_no: 1, source: "engine", invoice_month: MONTH, currency: "USD",
    steps: ["Reading the contract", "Compiling the rule book", "Reading the worksheet", "Computing each cost head", "Statement"],
    summary: { title: "Contract summary", text: s.text }, findings: s.findings,
    boxes: [box("company", "Company detail", { name: s.name, engagement: "Sample contract" }, "Demo sample with a non-TA/OSS billing structure.", "§1"),
            box("billing_rules", "Rule book & formulas", s.rb, "Compiled, executable rule book — the engine computes from this.", s.rb.cost_heads.map((h) => h.clause_ref).join(" · "))],
    compiled_rule_book: s.rb,
    totals: res.totals, by_head: res.by_head, lines: res.lines, exceptions: res.exceptions, hc: res.hc, computed: res.lines.length + res.ta.length,
  };
  await q(`insert into run(customer_id, run_no, invoice_month, currency, label, status, manifest, started_at, finished_at)
           values($1,1,$2,'USD','sample','complete',$3::jsonb,now(),now())
           on conflict (customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now()`, [cid, MONTH, JSON.stringify(manifest)]);
  console.log(`seeded ${s.code} → by_head`, res.by_head, "grand", res.totals.grand);
}
await pool.end();
console.log("done");
