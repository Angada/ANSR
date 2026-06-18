// Seed sample contracts that all bill off the SAME employee worksheet (roster).
// The CALC LOGIC is the full family — a recurring fee by active-headcount slab
// (MANY slabs) + a one-time recruitment fee = % of CTC by seniority band ×
// referral × tech, split across THREE milestone phases (sourcing / acceptance /
// balance) with tech vs non-tech advances. Only NAMES, BANDS, RATES and FIXED
// FEES differ per contract. The roster has hires at different lifecycle stages
// so one month's invoice shows every phase at once.
// Run: U="$DATABASE_URL" node scripts/seed-samples.mjs
import pg from "pg";
import { computeRun } from "../server/engine/compute.js";

const pool = new pg.Pool({ connectionString: process.env.U });
const q = (t, p) => pool.query(t, p);
const getRate = async () => ({ rate: 1, source: "same" });
const box = (code, title, content, ai_explain, clause_ref) => ({ id: code, box_type_code: code, title, content, ai_explain, confidence: 0.95, clause_ref, status: "approved", chat: [], suggestions: [] });

// ONE shared roster: ~120 active managers (sets the band) + hires staged so that
// in March 2025 sourcing, acceptance AND balance all fire — plus a non-tech hire.
const ROSTER = [
  ...Array.from({ length: 120 }, (_, i) => ({ ext_id: `e${i + 1}`, name: `Resource ${i + 1}`, raw: { level: "manager", referral: false, tech: true, join_date: "2024-06-01", total_ctc: 80000, ctc_ccy: "USD" } })),
  { ext_id: "src-1", name: "Sourced (tech mgr)", raw: { level: "manager", referral: false, tech: true, sourcing_date: "2025-03-05", total_ctc: 120000, ctc_ccy: "USD" } },
  { ext_id: "src-2", name: "Sourced (non-tech)", raw: { level: "manager", referral: false, tech: false, sourcing_date: "2025-03-20", total_ctc: 90000, ctc_ccy: "USD" } },
  { ext_id: "acc-1", name: "Offer accepted (director)", raw: { level: "director", referral: false, tech: true, sourcing_date: "2025-02-01", offer_date: "2025-03-08", total_ctc: 200000, ctc_ccy: "USD" } },
  { ext_id: "bal-1", name: "Joined last month (balance)", raw: { level: "manager", referral: true, tech: true, sourcing_date: "2024-12-01", offer_date: "2025-01-10", join_date: "2025-02-15", total_ctc: 100000, ctc_ccy: "USD" } },
];
const INPUTS = [
  { field: "join_date", why: "active headcount + balance milestone" }, { field: "exit_date", why: "removes from active headcount" },
  { field: "sourcing_date", why: "sourcing milestone" }, { field: "offer_date", why: "acceptance milestone" },
  { field: "level", why: "rate band" }, { field: "source", why: "referral status" }, { field: "tech_flag", why: "tech vs non-tech advance" },
  { field: "fixed_ctc", why: "base of the fee" }, { field: "variable_ctc", why: "completes total CTC" },
];
// full TA rate table (band × level × referral) — bands sized to the live HC
const taRows = (mul = 1) => [
  { band: "51–250", level: "non_leadership", referral: false, pct: 8.5 * mul },
  { band: "51–250", level: "non_leadership", referral: true, pct: 6.5 * mul },
  { band: "51–250", level: "manager", referral: false, pct: 9.5 * mul },
  { band: "51–250", level: "manager", referral: true, pct: 7 * mul },
  { band: "51–250", level: "director", referral: false, pct: 11 * mul },
  { band: "51–250", level: "director", referral: true, pct: 9 * mul },
];
const m3 = (s, a) => [ // three milestone phases, tech/non-tech advances + balance
  { code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: s.tech, nontech: s.nontech } },
  { code: "acceptance", trigger: "month_of:offer_date", amount: { tech: a.tech, nontech: a.nontech } },
  { code: "balance", trigger: "month_after:join_date:1", amount: "gross_minus_advances" },
];
const slabsMany = (min, perA, perB, perC) => [
  { hc_min: 0, hc_max: 50, fee_type: "minimum", rate: min },
  { hc_min: 51, hc_max: 100, fee_type: "per_resource", rate: perA },
  { hc_min: 101, hc_max: 250, fee_type: "per_resource", rate: perB },
  { hc_min: 251, hc_max: 1000, fee_type: "per_resource", rate: perC },
];

const SAMPLES = [
  { code: "KENVUE-GCC", name: "Kenvue GCC",
    text: "Two fees off the employee sheet. (1) A recurring monthly OSS fee by active-headcount slab, no pro-rata — ≤50 $22,000 min; 51–100 $530; 101–250 $480; 251–1000 $430 per active resource. (2) A one-time TA recruitment fee = % of total CTC by seniority band × referral (manager 9.5% / 7% ref, director 11% / 9% ref, non-leadership 8.5% / 6.5% ref), split across three phases: sourcing (tech $400 / non-tech $300), acceptance (tech $600 / non-tech $300), and balance one month after joining (gross − advances).",
    heads: [
      { code: "oss", kind: "recurring_slab", measure: "active_headcount", slabs: slabsMany(22000, 530, 480, 430), clause_ref: "§4" },
      { code: "ta", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: taRows(1) }, milestones: m3({ tech: 400, nontech: 300 }, { tech: 600, nontech: 300 }), clause_ref: "§3" },
    ] },
  { code: "NORTHWIND-GCC", name: "Northwind GCC",
    text: "Same build-and-operate structure, richer commercials. 'Managed Ops' by active-headcount slab (≤40 $30,000 min; 41–100 $650; 101–300 $600; 301–1000 $560 per resource) plus a 'Recruitment' fee = % of total CTC (manager 11% / 8% ref, director 14% / 11% ref) split across the same three phases (sourcing $600/$450, acceptance $800/$600, balance gross − advances).",
    heads: [
      { code: "managed_ops", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 40, fee_type: "minimum", rate: 30000 }, { hc_min: 41, hc_max: 100, fee_type: "per_resource", rate: 650 }, { hc_min: 101, hc_max: 300, fee_type: "per_resource", rate: 600 }, { hc_min: 301, hc_max: 1000, fee_type: "per_resource", rate: 560 }], clause_ref: "§4" },
      { code: "recruitment", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ band: "*", level: "manager", referral: false, pct: 11 }, { band: "*", level: "manager", referral: true, pct: 8 }, { band: "*", level: "director", referral: false, pct: 14 }, { band: "*", level: "director", referral: true, pct: 11 }, { band: "*", level: "non_leadership", referral: false, pct: 9 }] }, milestones: m3({ tech: 600, nontech: 450 }, { tech: 800, nontech: 600 }), clause_ref: "§3" },
    ] },
  { code: "ZEPHYR-GCC", name: "Zephyr GCC",
    text: "Operations-only contract (no recruitment fee). A single recurring 'Staffing Fee' by active-headcount slab: ≤30 $25,000 min; 31–100 $720; 101–250 $700; 251–1000 $650 per active resource. No pro-rata.",
    heads: [
      { code: "staffing_fee", kind: "recurring_slab", measure: "active_headcount", slabs: [{ hc_min: 0, hc_max: 30, fee_type: "minimum", rate: 25000 }, { hc_min: 31, hc_max: 100, fee_type: "per_resource", rate: 720 }, { hc_min: 101, hc_max: 250, fee_type: "per_resource", rate: 700 }, { hc_min: 251, hc_max: 1000, fee_type: "per_resource", rate: 650 }], clause_ref: "§2" },
    ] },
  { code: "HELIO-GCC", name: "Helio GCC",
    text: "Recruitment-led contract: a 'Recruitment' fee = % of total CTC (manager 8% / 6% ref, director 10%) split across three phases (sourcing tech $400 / non-tech $300, acceptance $500 / $350, balance gross − advances), plus a flat 'Onboarding' fee of $1,000 per active resource each month.",
    heads: [
      { code: "recruitment", kind: "one_time_split", rate_table: { keys: ["level", "referral"], rows: [{ band: "*", level: "manager", referral: false, pct: 8 }, { band: "*", level: "manager", referral: true, pct: 6 }, { band: "*", level: "director", referral: false, pct: 10 }] }, milestones: m3({ tech: 400, nontech: 300 }, { tech: 500, nontech: 350 }), clause_ref: "§3" },
      { code: "onboarding", kind: "per_unit", rate: 1000, measure: "active_headcount", clause_ref: "§5" },
    ] },
];

const MONTH = "2025-03";
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
    summary: { title: "Contract summary", text: s.text }, findings: s.heads.map((h) => `${h.code} — ${h.kind.replace(/_/g, " ")}${h.milestones ? " · 3 phases (sourcing/acceptance/balance)" : ""}${h.slabs ? ` · ${h.slabs.length} slabs` : ""}`),
    boxes: [
      box("company", "Company detail", { legal_name: s.name + " Inc.", engagement: "GCC build & operate", signatory: "VP, Global Ops" }, "Counterparty and engagement scope.", "§1"),
      box("legal", "Legal details", { governing_law: "Karnataka, India", term: "36 months", termination: "90-day notice", liability_cap: "12 months fees" }, "Standard legal frame.", "§9–12"),
      box("payment_terms", "Payment terms", { invoice_frequency: "monthly", due_days: 30, currency: "USD", schedule: "TA split across sourcing, acceptance, balance" }, "Billed monthly, net-30, USD; recruitment fee paid in three phases.", "§5"),
      box("commercial_terms", "Commercial terms", { revenue_lines: s.heads.map((h) => h.code).join(" + "), basis: s.heads.map((h) => h.kind.replace(/_/g, " ")).join(" · ") }, "The revenue lines on this contract.", "§3"),
      box("billing_rules", "Rule book & formulas", rb, "Compiled rule book — full slab table, full band × referral × tech rate table, and 3 milestone phases. The engine computes from this.", s.heads.map((h) => h.clause_ref).join(" · ")),
      box("caveats", "Caveats", { no_pro_rata: "recurring fee is full-month even for mid-month joiners/exits", tech_split: "advances differ for tech vs non-tech hires", three_phases: "TA is billed across sourcing, acceptance and balance months" }, "Watch-outs that change billing.", "§3–4"),
      box("flags", "Flags", { confirm: "confirm bands, rates, advances and slabs against the signed SOW before release" }, "Gaps that need a human decision.", "§3"),
    ],
    compiled_rule_book: rb,
    oss: res.oss, ta: res.ta, totals: res.totals, by_head: res.by_head, lines: res.lines, exceptions: res.exceptions, hc: res.hc, computed: res.lines.length + res.ta.length,
  };
  await q(`insert into run(customer_id, run_no, invoice_month, currency, label, status, manifest, started_at, finished_at)
           values($1,1,$2,'USD','sample','complete',$3::jsonb,now(),now())
           on conflict (customer_id, run_no) do update set manifest=excluded.manifest, finished_at=now()`, [cid, MONTH, JSON.stringify(manifest)]);
  const phases = res.ta.reduce((a, t) => { if (t.sourcing_billed) a.add("sourcing"); if (t.acceptance_billed) a.add("acceptance"); if (t.balance_billed) a.add("balance"); return a; }, new Set());
  console.log(`seeded ${s.code} → by_head`, res.by_head, `| phases this month: ${[...phases].join("+") || "none"} | grand ${res.totals.grand}`);
}
await pool.end();
console.log("done");
