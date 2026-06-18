// Seed 8 contracts in the NEW canonical model (rule_set + dimensions + sparse
// rate_cell), all billing the SAME fixed worksheet. Each is a different payment
// structure; each is compiled + validated (coverage%) + a sample run persisted.
// Run: U="$DATABASE_URL" node scripts/seed-contracts.mjs
import pg from "pg";
import { buildRuleSet, compileSpec } from "../server/engine/ruleset.js";
import { computeRun } from "../server/engine/compute.js";

const pool = new pg.Pool({ connectionString: process.env.U });
const q = (t, p) => pool.query(t, p);
const getRate = async () => ({ rate: 1, source: "same" });

// ---- the fixed worksheet (same columns for every contract) ----
const ROSTER = [
  ...Array.from({ length: 120 }, (_, i) => ({ ext_id: `e${i + 1}`, name: `Resource ${i + 1}`, raw: { level: "manager", referral: false, tech: true, location: "IN", join_date: "2024-06-01", total_ctc: 80000, ctc_ccy: "USD" } })),
  { ext_id: "src-1", name: "Sourced tech mgr", raw: { level: "manager", referral: false, tech: true, location: "IN", sourcing_date: "2025-03-05", total_ctc: 120000, ctc_ccy: "USD" } },
  { ext_id: "src-2", name: "Sourced non-tech", raw: { level: "manager", referral: false, tech: false, location: "IN", sourcing_date: "2025-03-20", total_ctc: 90000, ctc_ccy: "USD" } },
  { ext_id: "acc-1", name: "Accepted director", raw: { level: "director", referral: false, tech: true, location: "US", sourcing_date: "2025-02-01", offer_date: "2025-03-08", total_ctc: 200000, ctc_ccy: "USD" } },
  { ext_id: "bal-1", name: "Balance tech mgr ref", raw: { level: "manager", referral: true, tech: true, location: "IN", join_date: "2025-02-15", total_ctc: 100000, ctc_ccy: "USD" } },
  { ext_id: "bal-2", name: "Balance non-tech mgr", raw: { level: "manager", referral: false, tech: false, location: "IN", join_date: "2025-02-20", total_ctc: 100000, ctc_ccy: "USD" } },
];
const LEVELS = ["non_leadership", "manager", "director"], BOOLS = [false, true];

// generate a full level×referral×tech rate matrix (cells) for a recruitment head
const taCells = (head, base, adjRef = 2, adjNonTech = 1, drop = null) => {
  const cells = [];
  for (const level of LEVELS) for (const referral of BOOLS) for (const tech of BOOLS) {
    if (drop && drop(level, referral, tech)) continue; // omit a combo to demo a gap
    const pct = Math.round((base[level] - (referral ? adjRef : 0) - (tech ? 0 : adjNonTech)) * 100) / 100;
    cells.push({ head_code: head, dims: { level, referral, tech }, pct, clause_ref: "§3" });
  }
  return cells;
};
const m3 = (s, a) => [
  { code: "sourcing", trigger: "month_of:sourcing_date", amount: { tech: s.tech, nontech: s.nontech } },
  { code: "acceptance", trigger: "month_of:offer_date", amount: { tech: a.tech, nontech: a.nontech } },
  { code: "balance", trigger: "month_after:join_date:1", amount: "gross_minus_advances" },
];
const dimLRT = [
  { name: "level", source_column: "level", type: "enum", allowed_values: LEVELS },
  { name: "referral", source_column: "source", type: "bool", allowed_values: BOOLS },
  { name: "tech", source_column: "tech", type: "bool", allowed_values: BOOLS },
];
const slabs = (...rows) => rows.map(([min, max, ft, rate]) => ({ hc_min: min, hc_max: max, fee_type: ft, rate }));

// ---- 8 contracts, same worksheet, different structures ----
const SPECS = {
  "KENVUE-GCC": { name: "Kenvue GCC", dimensions: dimLRT,
    heads: [{ code: "oss", kind: "recurring_slab", measure: "active_headcount", slabs: slabs([0, 50, "minimum", 22000], [51, 100, "per_resource", 530], [101, 250, "per_resource", 480], [251, 1000, "per_resource", 430]), clause_ref: "§4" },
            { code: "ta", kind: "one_time_split", dimensions: ["level", "referral", "tech"], milestones: m3({ tech: 400, nontech: 300 }, { tech: 600, nontech: 300 }), clause_ref: "§3" }],
    cells: taCells("ta", { non_leadership: 8.5, manager: 9.5, director: 11 }) },
  "NORTHWIND-GCC": { name: "Northwind GCC", dimensions: dimLRT,
    heads: [{ code: "managed_ops", kind: "recurring_slab", measure: "active_headcount", slabs: slabs([0, 40, "minimum", 30000], [41, 100, "per_resource", 650], [101, 300, "per_resource", 600], [301, 1000, "per_resource", 560]), clause_ref: "§4" },
            { code: "recruitment", kind: "one_time_split", dimensions: ["level", "referral", "tech"], milestones: m3({ tech: 600, nontech: 450 }, { tech: 800, nontech: 600 }), clause_ref: "§3" }],
    cells: taCells("recruitment", { non_leadership: 9, manager: 11, director: 14 }, 3, 1.5) },
  "ZEPHYR-GCC": { name: "Zephyr GCC", dimensions: [],
    heads: [{ code: "staffing_fee", kind: "recurring_slab", measure: "active_headcount", slabs: slabs([0, 30, "minimum", 25000], [31, 100, "per_resource", 720], [101, 250, "per_resource", 700], [251, 1000, "per_resource", 650]), clause_ref: "§2" }],
    cells: [] },
  "HELIO-GCC": { name: "Helio GCC", dimensions: dimLRT,
    heads: [{ code: "recruitment", kind: "one_time_split", dimensions: ["level", "referral", "tech"], milestones: m3({ tech: 400, nontech: 300 }, { tech: 500, nontech: 350 }), clause_ref: "§3" },
            { code: "onboarding", kind: "per_unit", rate: 1000, measure: "active_headcount", clause_ref: "§5" }],
    cells: taCells("recruitment", { non_leadership: 7, manager: 8, director: 10 }) },
  "ORION-GCC": { name: "Orion GCC", dimensions: [{ name: "level", source_column: "level", type: "enum", allowed_values: LEVELS }],
    heads: [{ code: "retainer", kind: "flat", amount: 15000, clause_ref: "§1" },
            { code: "per_seat", kind: "per_unit", rate: 600, measure: "active_headcount", clause_ref: "§2" },
            { code: "success_fee", kind: "one_time_split", dimensions: ["level"], milestones: [{ code: "balance", trigger: "month_after:join_date:1", amount: "gross" }], clause_ref: "§3" }],
    cells: LEVELS.map((level) => ({ head_code: "success_fee", dims: { level }, pct: level === "director" ? 6 : level === "manager" ? 4 : 3, clause_ref: "§3" })) },
  "VEGA-PROJECT": { name: "Vega Project", dimensions: [{ name: "location", source_column: "location", type: "enum", allowed_values: ["IN", "US"] }],
    heads: [{ code: "project_fee", kind: "one_time_split", dimensions: ["location"], milestones: m3({ tech: 500, nontech: 500 }, { tech: 700, nontech: 700 }), clause_ref: "§3" }],
    cells: [{ head_code: "project_fee", dims: { location: "IN" }, pct: 10, clause_ref: "§3" }, { head_code: "project_fee", dims: { location: "US" }, pct: 13, clause_ref: "§3" }] },
  "NOVA-OPS": { name: "Nova Ops", dimensions: [],
    heads: [{ code: "ops_fee", kind: "recurring_slab", measure: "active_headcount", slabs: slabs([0, 50, "minimum", 20000], [51, 250, "per_resource", 500], [251, 1000, "per_resource", 450]), clause_ref: "§2" },
            { code: "early_exit_clawback", kind: "clawback", amount: 2000, clause_ref: "§7" }],
    cells: [] },
  "ATLAS-CO": { name: "Atlas Co", dimensions: [{ name: "level", source_column: "level", type: "enum", allowed_values: LEVELS }, { name: "referral", source_column: "source", type: "bool", allowed_values: BOOLS }],
    heads: [{ code: "min_commit", kind: "flat", amount: 18000, clause_ref: "§1" },
            { code: "recruitment", kind: "one_time_split", dimensions: ["level", "referral"], milestones: [{ code: "balance", trigger: "month_after:join_date:1", amount: "gross" }], clause_ref: "§3" }],
    // intentionally DROP director+referral to demonstrate a coverage gap (soft gate)
    cells: LEVELS.flatMap((level) => BOOLS.filter((ref) => !(level === "director" && ref)).map((referral) => ({ head_code: "recruitment", dims: { level, referral }, pct: (level === "director" ? 12 : level === "manager" ? 9 : 7) - (referral ? 2 : 0), clause_ref: "§3" }))) },
};

// build the analysis box set (step 2) from a spec + its compiled rule set
const oneBox = (code, title, content, ai_explain, clause_ref) => ({ id: code, box_type_code: code, title, content, ai_explain, confidence: 0.95, clause_ref, status: "approved", chat: [], suggestions: [] });
const bx = (spec, built) => [
  oneBox("company", "Company detail", { legal_name: spec.name + " Inc.", engagement: "GCC build & operate (sample)", signatory: "VP, Global Ops" }, "Counterparty and engagement scope.", "§1"),
  oneBox("legal", "Legal details", { governing_law: "Karnataka, India", term: "36 months", termination: "90-day notice", liability_cap: "12 months fees" }, "Standard legal frame.", "§9–12"),
  oneBox("payment_terms", "Payment terms", { invoice_frequency: "monthly", due_days: 30, currency: "USD", schedule: spec.heads.some((h) => h.milestones) ? "recruitment split across sourcing / acceptance / balance" : "monthly" }, "Billing cadence + payment schedule.", "§5"),
  oneBox("commercial_terms", "Commercial terms", { revenue_lines: spec.heads.map((h) => h.code).join(" + "), basis: spec.heads.map((h) => h.kind.replace(/_/g, " ")).join(" · "), dimensions: (spec.dimensions || []).map((d) => d.name).join(" × ") || "none" }, "The revenue lines + the dimensions rates vary by.", "§3"),
  oneBox("billing_rules", "Rule book & formulas", built.ruleBook, `Compiled rule set · coverage ${built.validation.coverage_pct}% (${built.validation.status}). The engine computes from this.`, spec.heads.map((h) => h.clause_ref).join(" · ")),
  oneBox("caveats", "Caveats", { no_pro_rata: "recurring fee is full-month even for mid-month joiners/exits", dimensions: "rates vary by " + ((spec.dimensions || []).map((d) => d.name).join(", ") || "a flat schedule") }, "Watch-outs that change billing.", "§3–4"),
  oneBox("flags", "Flags", built.validation.gaps.length ? { coverage_gap: `${built.validation.gaps.length} uncovered rate combo(s) — will flag at compute (soft gate)` } : { status: "rule set fully covered — ready" }, "Gaps that need a human decision.", "§3"),
];

const MONTH = "2025-03";
for (const [code, spec] of Object.entries(SPECS)) {
  spec.base_currency = "USD";
  await q(`insert into customer(code,name,currency,billing_ccy,contract_ccy) values($1,$2,'USD','USD','USD') on conflict(code) do update set name=excluded.name`, [code, spec.name]);
  const cid = (await q(`select id from customer where code=$1`, [code])).rows[0].id;
  await q(`delete from placement where customer_id=$1`, [cid]).catch(() => {});
  for (let i = 0; i < ROSTER.length; i++) await q(`insert into placement(customer_id,ext_id,name,raw,source_row) values($1,$2,$3,$4::jsonb,$5) on conflict (customer_id,ext_id) do update set raw=excluded.raw`, [cid, ROSTER[i].ext_id, ROSTER[i].name, JSON.stringify(ROSTER[i].raw), i + 1]);
  await q(`delete from rule_set where customer_id=$1`, [cid]).catch(() => {});
  const built = await buildRuleSet(q, code, spec, { lock: true });
  // sample run on the shared roster, persisted so the UI shows numbers
  const ledger = ROSTER.map((r) => ({ ext_id: r.ext_id, name: r.name, ...r.raw }));
  const res = await computeRun({ month: MONTH, ruleBook: built.ruleBook, ledger, getRate, currency: "USD" });
  const manifest = { client: code, run_no: 1, source: "engine", invoice_month: MONTH, currency: "USD",
    steps: ["Read contract", "Compile rule set", "Validate coverage", "Read worksheet", "Compute"],
    summary: { title: "Contract summary", text: `${spec.name}: ${spec.heads.map((h) => h.code + " (" + h.kind.replace(/_/g, " ") + ")").join(" + ")}. Coverage ${built.validation.coverage_pct}%.` },
    findings: built.validation.gaps.length ? [`${built.validation.gaps.length} rate gap(s) — flagged at compute (soft gate)`] : ["Rule set fully covered."],
    boxes: bx(spec, built), compiled_rule_book: built.ruleBook,
    oss: res.oss, ta: res.ta, totals: res.totals, by_head: res.by_head, lines: res.lines, exceptions: res.exceptions, hc: res.hc, computed: res.lines.length + res.ta.length,
    coverage_pct: built.validation.coverage_pct, validation_status: built.validation.status };
  await q(`insert into run(customer_id,run_no,invoice_month,currency,label,status,manifest,started_at,finished_at) values($1,1,$2,'USD','sample','complete',$3::jsonb,now(),now()) on conflict (customer_id,run_no) do update set manifest=excluded.manifest`, [cid, MONTH, JSON.stringify(manifest)]);
  console.log(`${code.padEnd(15)} cov ${String(built.validation.coverage_pct).padStart(5)}% ${built.validation.status.padEnd(5)} | by_head ${JSON.stringify(res.by_head)} | gaps ${built.validation.gaps.length} | exc ${res.exceptions.length}`);
}
await pool.end();
console.log("done — 8 contracts in the new model");
