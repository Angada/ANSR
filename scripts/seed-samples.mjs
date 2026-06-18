// Seed sample contracts that all bill off the SAME employee worksheet (roster),
// so you can upload one sheet and see how different rule books produce different
// bills. The CALC LOGIC is the same family (a recurring fee by active-headcount
// slab + a one-time recruitment fee as % of CTC split across milestones); only
// the NAMES, BANDS, RATES, and FIXED FEES differ per contract.
// Run: U="$DATABASE_URL" node scripts/seed-samples.mjs
import pg from "pg";
import { computeRun } from "../server/engine/compute.js";

const pool = new pg.Pool({ connectionString: process.env.U });
const q = (t, p) => pool.query(t, p);
const getRate = async () => ({ rate: 1, source: "same" });
const box = (code, title, content, ai_explain, clause_ref) => ({ id: code, box_type_code: code, title, content, ai_explain, confidence: 0.95, clause_ref, status: "approved", chat: [], suggestions: [] });

// ONE shared employee roster (the worksheet shape every contract consumes):
// 12 active managers + 1 new hire sourced this month. Canonical fields so it
// works the same whether seeded or mapped from an uploaded sheet.
const ROSTER = [
  ...Array.from({ length: 12 }, (_, i) => ({ ext_id: `e${i + 1}`, name: `Resource ${i + 1}`, raw: { level: "manager", referral: false, tech: true, join_date: "2024-06-01", total_ctc: 80000, ctc_ccy: "USD" } })),
  { ext_id: "h1", name: "New Hire (Asha)", raw: { level: "manager", referral: false, tech: true, sourcing_date: "2025-03-05", join_date: "2025-03-20", total_ctc: 120000, ctc_ccy: "USD" } },
];
const INPUTS = [
  { field: "join_date", why: "active headcount + balance milestone" },
  { field: "exit_date", why: "removes from active headcount" },
  { field: "sourcing_date", why: "triggers the recruitment fee" },
  { field: "level", why: "rate band" }, { field: "source", why: "referral status" },
  { field: "fixed_ctc", why: "base of the fee" }, { field: "variable_ctc", why: "completes total CTC" },
];

// Same calc family, different names/bands/rates/fees per contract.
const SAMPLES = [
  {
    code: "KENVUE-GCC", name: "Kenvue GCC",
    text: "Two fees off the employee sheet: a recurring monthly OSS fee by active-headcount slab (no pro-rata), and a one-time TA recruitment fee = % of total CTC by level × referral, split across milestones. Bands ≤50 → $22,000 minimum; 51–250 → $530 per active resource. TA: manager 9.5% (7% if referral).",
    heads: [
      { code: "oss", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 50, fee_type: "minimum", rate: 22000 }, { hc_min: 51, hc_max: 250, fee_type: "per_resource", rate: 530 }], clause_ref: "§4" },
      { code: "ta", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ level: "manager", referral: false, pct: 9.5 }, { level: "manager", referral: true, pct: 7 }, { level: "director", referral: false, pct: 11 }] }, milestones: [{ code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: 400, nontech: 300 } }], clause_ref: "§3" },
    ],
  },
  {
    code: "NORTHWIND-GCC", name: "Northwind GCC",
    text: "Same structure as a build-and-operate GCC, different commercials. A recurring 'Managed Ops' fee by active-headcount slab (≤40 → $30,000 minimum; 41–300 → $650 per active resource) plus a 'Recruitment' fee = % of total CTC (manager 11%, director 14%; 8% if referral), one milestone on sourcing ($600 tech / $450 non-tech).",
    heads: [
      { code: "managed_ops", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 40, fee_type: "minimum", rate: 30000 }, { hc_min: 41, hc_max: 300, fee_type: "per_resource", rate: 650 }], clause_ref: "§4" },
      { code: "recruitment", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ level: "manager", referral: false, pct: 11 }, { level: "manager", referral: true, pct: 8 }, { level: "director", referral: false, pct: 14 }] }, milestones: [{ code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: 600, nontech: 450 } }], clause_ref: "§3" },
    ],
  },
  {
    code: "ZEPHYR-GCC", name: "Zephyr GCC",
    text: "Operations-only contract (no recruitment fee). A single recurring 'Staffing Fee' by active-headcount slab: ≤30 → $25,000 minimum; 31–250 → $700 per active resource. No pro-rata.",
    heads: [
      { code: "staffing_fee", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 30, fee_type: "minimum", rate: 25000 }, { hc_min: 31, hc_max: 250, fee_type: "per_resource", rate: 700 }], clause_ref: "§2" },
    ],
  },
  {
    code: "HELIO-GCC", name: "Helio GCC",
    text: "Recruitment-led contract: a one-time 'Recruitment' fee = % of total CTC (manager 8%, 6% if referral) split on sourcing ($400 tech / $300 non-tech), plus a flat 'Onboarding' fee of $1,000 per active resource each month. No headcount slab.",
    heads: [
      { code: "recruitment", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ level: "manager", referral: false, pct: 8 }, { level: "manager", referral: true, pct: 6 }] }, milestones: [{ code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: 400, nontech: 300 } }], clause_ref: "§3" },
      { code: "onboarding", kind: "per_unit", rate: 1000, measure: "active_headcount", clause_ref: "§5" },
    ],
  },
];

const MONTH = "2025-03";
// remove the old (wrong-shape) samples
await q(`delete from placement where customer_id in (select id from customer where code = any($1))`, [["ACME-SAAS", "BETA-CLOUD", "GAMMA-CONSULTING"]]).catch(() => {});
await q(`delete from run where customer_id in (select id from customer where code = any($1))`, [["ACME-SAAS", "BETA-CLOUD", "GAMMA-CONSULTING"]]).catch(() => {});
await q(`delete from customer where code = any($1)`, [["ACME-SAAS", "BETA-CLOUD", "GAMMA-CONSULTING"]]).catch(() => {});

for (const s of SAMPLES) {
  const rb = { base_currency: "USD", inputs: INPUTS, cost_heads: s.heads };
  await q(`insert into customer(code,name,currency,billing_ccy,contract_ccy) values($1,$2,'USD','USD','USD') on conflict(code) do update set name=excluded.name`, [s.code, s.name]);
  const cid = (await q(`select id from customer where code=$1`, [s.code])).rows[0].id;
  await q(`delete from placement where customer_id=$1`, [cid]).catch(() => {});
  for (let i = 0; i < ROSTER.length; i++) await q(`insert into placement(customer_id, ext_id, name, raw, source_row) values($1,$2,$3,$4::jsonb,$5) on conflict (customer_id, ext_id) do update set raw=excluded.raw`, [cid, ROSTER[i].ext_id, ROSTER[i].name, JSON.stringify(ROSTER[i].raw), i + 1]);
  const ledger = ROSTER.map((r) => ({ ext_id: r.ext_id, name: r.name, ...r.raw }));
  const res = await computeRun({ month: MONTH, ruleBook: rb, ledger, getRate, currency: "USD" });
  const manifest = {
    client: s.code, run_no: 1, source: "engine", invoice_month: MONTH, currency: "USD",
    steps: ["Reading the contract", "Compiling the rule book", "Reading the worksheet", "Computing each cost head", "Statement"],
    summary: { title: "Contract summary", text: s.text }, findings: s.heads.map((h) => `${h.code} — ${h.kind.replace(/_/g, " ")}`),
    boxes: [
      box("company", "Company detail", { legal_name: s.name + " Inc.", engagement: "GCC build & operate (sample)", signatory: "VP, Global Ops" }, "Counterparty and engagement scope.", "§1"),
      box("legal", "Legal details", { governing_law: "Karnataka, India", term: "36 months", termination: "90-day notice", liability_cap: "12 months fees" }, "Standard legal frame.", "§9–12"),
      box("payment_terms", "Payment terms", { invoice_frequency: "monthly", due_days: 30, currency: "USD" }, "Billed monthly, net-30, USD.", "§5"),
      box("commercial_terms", "Commercial terms", { revenue_lines: s.heads.map((h) => h.code).join(" + "), basis: s.heads.map((h) => h.kind.replace(/_/g, " ")).join(" · ") }, "The revenue lines on this contract.", "§3"),
      box("billing_rules", "Rule book & formulas", rb, "Compiled rule book — same calc family as Kenvue, different names/bands/rates/fees. The engine computes from this.", s.heads.map((h) => h.clause_ref).join(" · ")),
      box("caveats", "Caveats", { no_pro_rata: "recurring fee is full-month even for mid-month joiners/exits", source_labels: "referral vs non-referral must be mapped before the rate applies" }, "Watch-outs that change billing if mis-handled.", "§3–4"),
      box("flags", "Flags", { confirm: "confirm bands, rates and fixed fees against the signed SOW before release" }, "Gaps that need a human decision.", "§3"),
    ],
    compiled_rule_book: rb,
    oss: res.oss, ta: res.ta, totals: res.totals, by_head: res.by_head, lines: res.lines, exceptions: res.exceptions, hc: res.hc, computed: res.lines.length + res.ta.length,
  };
  await q(`insert into run(customer_id, run_no, invoice_month, currency, label, status, manifest, started_at, finished_at)
           values($1,1,$2,'USD','sample','complete',$3::jsonb,now(),now())
           on conflict (customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now()`, [cid, MONTH, JSON.stringify(manifest)]);
  console.log(`seeded ${s.code} → by_head`, res.by_head, "grand", res.totals.grand);
}
await pool.end();
console.log("done");
