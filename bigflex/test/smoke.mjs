// Pure-engine smoke test (no DB): compile a rule book → compute a run.
import { compileRuleBook } from "../engine/rulebook.js";
import { computeRun } from "../engine/compute.js";

const box = { content: {
  base_currency: "USD",
  ctc_definition: "fixed + variable",
  ta_rate_table: [
    { band: "≤100", level: "non_leadership", referral: false, ta_pct: 8.5 },
    { band: "101–250", level: "manager", referral: false, ta_pct: 9.5 },
  ],
  milestones: [
    { code: "sourcing", tech: 400, nontech: 300 },
    { code: "acceptance", tech: 600, nontech: 300 },
    { code: "balance" },
  ],
  oss_slabs: [
    { hc: "≤50", logic: "minimum monthly fee", rate: 22000 },
    { hc: "51–250", logic: "per active resource", rate: 530 },
  ],
} };

const rb = compileRuleBook(box);
const ledger = [];
for (let i = 0; i < 120; i++) ledger.push({ ext_id: "E" + i, name: "E" + i, level: "non_leadership", referral: false, tech: true, join_date: "2024-06-01", exit_date: null, total_ctc: 80000, ctc_ccy: "USD" });
ledger.push({ ext_id: "M1", name: "Asha", level: "manager", referral: false, tech: true, sourcing_date: "2024-12-01", offer_date: "2025-01-15", join_date: "2025-02-10", total_ctc: 120000, ctc_ccy: "USD" });

const getRate = async () => ({ rate: 1, source: "test" });
const r = await computeRun({ month: "2025-03", ruleBook: rb, ledger, getRate, currency: "USD" });

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
assert(rb.cost_heads.length === 2, "2 cost heads");
assert(r.oss.fee_type === "per_resource" && r.oss.oss_amount === 530 * r.oss.closing_active_hc, "OSS per-resource");
const asha = r.ta.find((t) => t.employee === "Asha");
assert(asha && asha.ta_pct === 9.5 && asha.gross_ta_fee === 11400, "Asha 9.5% → 11400 gross");
assert(asha.balance_billed === 11400 - 1000, "balance = gross − advances(1000)");
console.log("PASS · OSS", r.oss.oss_amount, "· TA Asha", asha.invoice_value, "· totals", r.totals);
