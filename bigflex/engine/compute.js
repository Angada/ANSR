// Deterministic run compute. Interprets a canonical rule book against a
// normalized placement ledger → a line per cost head + a trace per number;
// quarantines bad rows; flags any cost-head kind the engine can't express.
//
// Generic over cost-head KINDS (not hardcoded to TA/OSS):
//   recurring_slab   — pick a slab by a measure → minimum | per_resource fee
//   one_time_split   — per placement, % of a base, split across milestones
//   per_unit         — rate × quantity (a measure summed across the ledger)
//   flat             — fixed amount for the period (retainer / platform fee)
//   clawback|credit  — a negative line (reversal / credit note)
//   <anything else>  — exception ("rule needs a human"), never a silent guess
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
  return null;
}
function advancesTotal(milestones, p) {
  return (milestones || []).reduce((s, m) => s + (typeof m.amount === "object" ? (fixedAmount(m, p) || 0) : 0), 0);
}

export async function computeRun({ month, ruleBook, ledger, getRate, currency }) {
  const base = currency || ruleBook.base_currency || "USD";
  const traces = [], ta = [], exceptions = [], lines = [];
  let oss = null;
  const hc = activeHeadcount(ledger, month);

  // A measure resolves to a number: active headcount, row count, or the SUM of a
  // named field across the ledger (e.g. seats, gb_stored, transactions, hours).
  const measureValue = (head) => {
    const m = head.measure;
    if (!m || m === "active_headcount") return hc.closing;
    if (m === "row_count" || m === "placements" || m === "rows") return ledger.length;
    return ledger.reduce((s, p) => s + (Number(p[m] ?? p.raw?.[m]) || 0), 0);
  };
  const addLine = (l) => { lines.push(l); traces.push({ object_type: "line", head_code: l.head_code, value_num: l.amount, value_ccy: base, base_ccy: base, why: l.why || `${l.head_code} (${l.kind})`, clause_ref: l.clause_ref, calc_steps: l.calc_steps }); };

  for (const head of ruleBook.cost_heads || []) {
    const kind = head.kind;

    if (kind === "recurring_slab") {
      const qty = measureValue(head);
      const sl = slab(head.slabs, qty);
      if (!sl) { exceptions.push({ issue: "no_slab", detail: `${head.code}: no slab covers ${qty} ${head.measure || "active HC"}`, severity: "block" }); continue; }
      const amount = sl.fee_type === "per_resource" ? sl.rate * qty : sl.rate;
      const calc_steps = [
        { label: "Measure", detail: head.measure || "active headcount", value: String(qty) },
        { label: "Apply slab", detail: `${sl.fee_type} · ${money(sl.rate)}`, value: sl.fee_type === "per_resource" ? `${money(sl.rate)} × ${qty}` : "minimum" },
        { label: `= ${head.code}`, detail: "", value: money(amount) },
      ];
      addLine({ head_code: head.code, kind, amount, ccy: base, clause_ref: head.clause_ref, calc_steps, why: `${head.code} ${sl.fee_type} slab for ${qty}` });
      if (!oss) oss = { invoice_month: month, opening_hc: hc.opening, new_joiners: hc.new_joiners, exits: hc.exits, closing_active_hc: hc.closing, fee_type: sl.fee_type, rate: sl.rate, oss_amount: amount, ccy: base, base_ccy: base, clause_ref: head.clause_ref, calc_steps, confidence: 0.98 };

    } else if (kind === "per_unit") {
      const qty = measureValue(head);
      const amount = Math.round((Number(head.rate) || 0) * qty);
      const calc_steps = [{ label: "Per-unit", detail: `${money(head.rate)} × ${qty} ${head.measure || "units"}`, value: money(amount) }];
      addLine({ head_code: head.code, kind, amount, ccy: base, clause_ref: head.clause_ref, calc_steps, why: `${head.code}: ${money(head.rate)} per ${head.measure || "unit"} × ${qty}` });

    } else if (kind === "flat") {
      const amount = Math.round(Number(head.amount) || 0);
      addLine({ head_code: head.code, kind, amount, ccy: base, clause_ref: head.clause_ref, calc_steps: [{ label: "Flat fee", detail: head.label || head.code, value: money(amount) }], why: `${head.code}: flat ${money(amount)}` });

    } else if (kind === "clawback" || kind === "credit") {
      const amount = -Math.abs(Math.round(Number(head.amount) || 0));
      addLine({ head_code: head.code, kind, amount, ccy: base, clause_ref: head.clause_ref, calc_steps: [{ label: kind, detail: head.reason || head.label || "", value: money(amount) }], why: `${head.code}: ${kind} ${money(amount)}` });

    } else if (kind === "one_time_split") {
      for (const p of ledger) {
        const fires = (head.milestones || []).filter((m) => milestoneMonth(m, p) === month);
        if (!fires.length) continue;
        if (p.total_ctc == null) { exceptions.push({ ext_id: p.ext_id, issue: "missing_ctc", detail: "no/zero base — cannot compute", severity: "block" }); continue; }
        let fx = { rate: 1, source: "same" };
        if (p.ctc_ccy && p.ctc_ccy !== base) {
          fx = await getRate(p.ctc_ccy, base, invoiceDate(month));
          if (fx.rate == null) { exceptions.push({ ext_id: p.ext_id, issue: "fx_unavailable", detail: `${p.ctc_ccy}→${base}`, severity: "block" }); continue; }
        }
        const ctcBase = Math.round(p.total_ctc * fx.rate);
        const rrow = rateLookup(head.rate_table, { gcc_band: hc.closing, level: p.level, referral: p.referral, tech: p.tech });
        if (!rrow) { exceptions.push({ ext_id: p.ext_id, issue: "no_rate", detail: `no rate for level=${p.level}, band=${hc.closing}, referral=${p.referral}`, severity: "block" }); continue; }
        const gross = pct(ctcBase, rrow.pct);
        const adv = advancesTotal(head.milestones, p);
        const billed = { sourcing: 0, acceptance: 0, balance: 0 };
        let invoice_value = 0;
        for (const m of fires) {
          let a = typeof m.amount === "object" ? fixedAmount(m, p) : m.amount === "gross_minus_advances" ? gross - adv : gross;
          a = Math.max(0, Math.round(a));
          billed[m.code] = (billed[m.code] || 0) + a; invoice_value += a;
        }
        const steps = [
          { label: `${p.name}: classify`, detail: `${p.referral ? "referral" : "non-referral"} · ${p.level}${p.tech != null ? " · " + (p.tech ? "tech" : "non-tech") : ""}`, value: "" },
          { label: `${p.name}: base`, detail: "total CTC", value: `${p.ctc_ccy || base} ${Number(p.total_ctc).toLocaleString()}` },
          ...(fx.source !== "same" ? [{ label: `${p.name}: FX`, detail: `× ${fx.rate} (${fx.source})`, value: money(ctcBase) }] : []),
          { label: `${p.name}: rate`, detail: `band ${hc.closing} → ${rrow.pct}%`, value: `${rrow.pct}%` },
          { label: `${p.name}: gross`, detail: "", value: money(gross) },
          { label: `${p.name}: milestones this month`, detail: fires.map((m) => m.code).join(" + "), value: money(invoice_value) },
        ];
        ta.push({ _head: head.code, ext_id: p.ext_id, employee: p.name, invoice_month: month, referral: p.referral, tech: p.tech, level: p.level,
          total_ctc: p.total_ctc, ccy: p.ctc_ccy, base_ccy: base, fx_rate: fx.rate, ta_pct: rrow.pct, gross_ta_fee: gross,
          sourcing_billed: billed.sourcing, acceptance_billed: billed.acceptance, balance_billed: billed.balance,
          invoice_value, clause_ref: head.clause_ref, confidence: fx.source === "same" ? 0.95 : 0.85, calc_steps: steps });
        traces.push({ object_type: "ta_calc", ext_id: p.ext_id, value_num: invoice_value, value_ccy: base, base_ccy: base, fx_rate: fx.rate, why: `${head.code} ${fires.map((m) => m.code).join("+")} @ ${rrow.pct}%`, clause_ref: head.clause_ref, calc_steps: steps });
      }

    } else {
      // flag, don't guess — the engine has no operator for this kind
      exceptions.push({ issue: "unsupported_cost_head", detail: `${head.code}: kind '${kind}' needs a human — no operator for it`, severity: "block" });
    }
  }

  // totals — generic by-head, plus the back-compat oss/ta buckets
  const by_head = {};
  for (const l of lines) by_head[l.head_code] = (by_head[l.head_code] || 0) + l.amount;
  for (const t of ta) by_head[t._head || "ta"] = (by_head[t._head || "ta"] || 0) + t.invoice_value;
  const total_oss = oss?.oss_amount || 0;
  const total_ta = ta.reduce((s, t) => s + t.invoice_value, 0);
  const grand = lines.reduce((s, l) => s + l.amount, 0) + total_ta;
  return { oss, ta, lines, by_head, traces, exceptions, hc, totals: { oss: total_oss, ta: total_ta, grand } };
}

// Run the rule book's worked examples through the interpreter (trust gate).
export async function runWorkedExamples(ruleBook, getRate = async () => ({ rate: 1, source: "same" })) {
  const taHead = (ruleBook.cost_heads || []).find((h) => h.kind === "one_time_split");
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
