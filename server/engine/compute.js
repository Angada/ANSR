// Deterministic run compute. Interprets a canonical rule book against a
// normalized placement ledger → ta_calc + oss_calc + trace; quarantines bad rows.
import { rateLookup, slab, pct, monthOf, monthAfter, activeHeadcount } from "./operators.js";

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
const invoiceDate = (month) => `${month}-28`;

function milestoneMonth(m, p) {
  const [op, field, n] = (m.trigger || "").split(":");
  if (op === "month_of") return monthOf(p[field]);
  if (op === "month_after") return monthAfter(p[field], Number(n) || 1);
  return null;
}
function fixedAmount(m, p) {
  if (m.amount && typeof m.amount === "object") return Number(p.tech ? m.amount.tech : m.amount.nontech) || 0;
  return null; // gross / gross_minus_advances handled separately
}
function advancesTotal(milestones, p) {
  return (milestones || []).reduce((s, m) => s + (typeof m.amount === "object" ? (fixedAmount(m, p) || 0) : 0), 0);
}

export async function computeRun({ month, ruleBook, ledger, getRate, currency }) {
  const base = currency || ruleBook.base_currency || "USD";
  const traces = [], ta = [], exceptions = [];
  let oss = null;

  const hc = activeHeadcount(ledger, month);

  // ---- recurring slab (OSS) — once per month ----
  const ossHead = ruleBook.cost_heads.find((h) => h.kind === "recurring_slab");
  if (ossHead) {
    const sl = slab(ossHead.slabs, hc.closing);
    if (!sl) exceptions.push({ issue: "no_oss_slab", detail: `no slab covers ${hc.closing} active HC`, severity: "block" });
    else {
      const amount = sl.fee_type === "per_resource" ? sl.rate * hc.closing : sl.rate;
      const calc_steps = [
        { label: "Opening active HC", detail: "prior month-end", value: String(hc.opening) },
        { label: "+ New joiners", detail: `${month}`, value: "+" + hc.new_joiners },
        { label: "− Exits", detail: `${month}`, value: "−" + hc.exits },
        { label: "= Closing active HC", detail: "no pro-rata, month-end", value: hc.closing + " HC" },
        { label: "Apply slab", detail: `${sl.fee_type} · ${money(sl.rate)}`, value: sl.fee_type === "per_resource" ? `${money(sl.rate)} × ${hc.closing}` : "minimum" },
        { label: "= OSS", detail: "", value: money(amount) },
      ];
      oss = { invoice_month: month, opening_hc: hc.opening, new_joiners: hc.new_joiners, exits: hc.exits, closing_active_hc: hc.closing,
        fee_type: sl.fee_type, rate: sl.rate, oss_amount: amount, ccy: base, base_ccy: base, clause_ref: ossHead.clause_ref, calc_steps, confidence: 0.98 };
      traces.push({ object_type: "oss_calc", value_num: amount, value_ccy: base, base_ccy: base, why: `OSS ${sl.fee_type} slab for ${hc.closing} active HC`, clause_ref: ossHead.clause_ref, calc_steps });
    }
  }

  // ---- one-time split (TA) — per placement, only milestones that fire this month ----
  const taHead = ruleBook.cost_heads.find((h) => h.kind === "one_time_split");
  if (taHead) {
    for (const p of ledger) {
      const fires = (taHead.milestones || []).filter((m) => milestoneMonth(m, p) === month);
      if (!fires.length) continue;
      if (p.total_ctc == null) { exceptions.push({ ext_id: p.ext_id, issue: "missing_ctc", detail: "no/zero CTC — cannot compute TA", severity: "block" }); continue; }
      let fx = { rate: 1, source: "same" };
      if (p.ctc_ccy && p.ctc_ccy !== base) {
        fx = await getRate(p.ctc_ccy, base, invoiceDate(month));
        if (fx.rate == null) { exceptions.push({ ext_id: p.ext_id, issue: "fx_unavailable", detail: `${p.ctc_ccy}→${base}`, severity: "block" }); continue; }
      }
      const ctcBase = Math.round(p.total_ctc * fx.rate);
      const rrow = rateLookup(taHead.rate_table, { gcc_band: hc.closing, level: p.level, referral: p.referral, tech: p.tech });
      if (!rrow) { exceptions.push({ ext_id: p.ext_id, issue: "no_rate", detail: `no rate for level=${p.level}, band=${hc.closing}, referral=${p.referral}`, severity: "block" }); continue; }
      const gross = pct(ctcBase, rrow.pct);
      const adv = advancesTotal(taHead.milestones, p);
      const billed = { sourcing: 0, acceptance: 0, balance: 0 };
      let invoice_value = 0;
      for (const m of fires) {
        let a = typeof m.amount === "object" ? fixedAmount(m, p) : m.amount === "gross_minus_advances" ? gross - adv : gross;
        a = Math.max(0, Math.round(a));
        billed[m.code] = (billed[m.code] || 0) + a; invoice_value += a;
      }
      const steps = [
        { label: `${p.name}: classify`, detail: `${p.referral ? "referral" : "non-referral"} · ${p.level}${p.tech != null ? " · " + (p.tech ? "tech" : "non-tech") : ""}` , value: "" },
        { label: `${p.name}: CTC`, detail: "fixed + variable", value: `${p.ctc_ccy} ${Number(p.total_ctc).toLocaleString()}` },
        ...(fx.source !== "same" ? [{ label: `${p.name}: FX`, detail: `× ${fx.rate} (${fx.source})`, value: money(ctcBase) }] : []),
        { label: `${p.name}: TA %`, detail: `band ${hc.closing} → ${rrow.pct}%`, value: `${rrow.pct}%` },
        { label: `${p.name}: gross TA`, detail: "", value: money(gross) },
        { label: `${p.name}: milestones this month`, detail: fires.map((m) => m.code).join(" + "), value: money(invoice_value) },
      ];
      ta.push({ ext_id: p.ext_id, employee: p.name, invoice_month: month, referral: p.referral, tech: p.tech, level: p.level,
        total_ctc: p.total_ctc, ccy: p.ctc_ccy, base_ccy: base, fx_rate: fx.rate, ta_pct: rrow.pct, gross_ta_fee: gross,
        sourcing_billed: billed.sourcing, acceptance_billed: billed.acceptance, balance_billed: billed.balance,
        invoice_value, clause_ref: taHead.clause_ref, confidence: fx.source === "same" ? 0.95 : 0.85, calc_steps: steps });
      traces.push({ object_type: "ta_calc", ext_id: p.ext_id, value_num: invoice_value, value_ccy: base, base_ccy: base, fx_rate: fx.rate, why: `TA ${fires.map((m) => m.code).join("+")} @ ${rrow.pct}%`, clause_ref: taHead.clause_ref, calc_steps: steps });
    }
  }

  const total_oss = oss?.oss_amount || 0;
  const total_ta = ta.reduce((s, t) => s + t.invoice_value, 0);
  return { oss, ta, traces, exceptions, hc, totals: { oss: total_oss, ta: total_ta, grand: total_oss + total_ta } };
}

// Run the rule book's worked examples through the interpreter (trust gate).
export async function runWorkedExamples(ruleBook, getRate = async () => ({ rate: 1, source: "same" })) {
  const taHead = ruleBook.cost_heads.find((h) => h.kind === "one_time_split");
  const out = [];
  for (const ex of ruleBook.worked_examples || []) {
    const i = ex.inputs || {};
    let actual = null;
    if (taHead && (ex.expect?.head || "ta") === "ta") {
      const rrow = rateLookup(taHead.rate_table, { gcc_band: i.gcc_band ?? i.band, level: i.level, referral: i.referral, tech: i.tech });
      let ctc = Number(String(i.ctc ?? i.total_ctc ?? 0).replace(/[,\s$]/g, ""));
      if (i.ccy && ruleBook.base_currency && i.ccy !== ruleBook.base_currency) { const fx = await getRate(i.ccy, ruleBook.base_currency); if (fx.rate) ctc = Math.round(ctc * fx.rate); }
      if (rrow) actual = pct(ctc, rrow.pct);
    }
    const expected = Number(String(ex.expect?.amount ?? ex.expected ?? "").toString().replace(/[,\s$%]/g, "")) || null;
    out.push({ scenario: ex.scenario || JSON.stringify(i), expected, actual, pass: expected != null && actual != null && Math.abs(expected - actual) <= Math.max(1, expected * 0.02) });
  }
  return out;
}
