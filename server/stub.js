// Stub run generator — realistic Q&ANSR invoice trace until the calc engine is
// built. It defines the TRACE CONTRACT the invoice page consumes:
//   replay slider  → every calc_step has a global `seq`; reveal steps 0..p in order.
//   confidence heatmap → every line/step has `confidence` 0..1.
//   audit pack     → every line carries value + why + clause_ref + calc_steps + source_ref.
// Replace with real data from ta_calc/oss_calc/trace; keep the shape identical.

export function stubRun(customer = "ANSR-KENVUE", runNo = 1) {
  let seq = 0;
  const S = (label, detail, value) => ({ seq: ++seq, label, detail, value });

  const oss = {
    invoice_month: "2025-03", ccy: "USD", base_ccy: "USD", confidence: 0.97,
    opening_hc: 142, new_joiners: 9, exits: 3, closing_active_hc: 148,
    slab: "51–250 (per resource)", rate: 530, amount: 78440,
    clause_ref: "SOW §4.2 OSS slab table",
    source_ref: { doc: "emp_list", sheet: "EMP LIST", note: "join/exit dates @ month-end, Asia/Kolkata" },
    calc_steps: [
      S("Opening active HC", "prior-month closing", "142"),
      S("+ New joiners (Mar)", "join_date in 2025-03", "+9"),
      S("− Exits (Mar)", "exit_date in 2025-03", "−3"),
      S("= Closing active HC", "no pro-rata, month-end", "148 HC"),
      S("Apply OSS slab", "band 51–250 → $530/resource", "$530 × 148"),
      S("= OSS amount", "", "$78,440"),
    ],
  };

  const mkTa = (name, level, referral, tech, ctcAmt, ctcCcy, pct, fx, srcBilled, accBilled, balBilled) => {
    const grossBase = Math.round(ctcAmt * fx * (pct / 100));
    const inv = srcBilled + accBilled + balBilled;
    return {
      employee: name, level, referral, tech,
      ctc: { amount: ctcAmt, ccy: ctcCcy }, ta_pct: pct, fx_rate: fx, fx_date: "2025-03-31", fx_source: "RBI",
      gross_ta_fee: grossBase, sourcing_billed: srcBilled, acceptance_billed: accBilled, balance_billed: balBilled,
      invoice_value: inv, ccy: "USD", base_ccy: "USD",
      confidence: referral && ctcCcy === "INR" ? 0.74 : 0.93, // referral+FX = lower trust
      clause_ref: "SOW §3.1 TA rate · §3.3 milestone split (Col C/D/E)",
      source_ref: { doc: "calc_inr", sheet: ctcCcy === "INR" ? "INR - OSS and TA Calcs" : "USD - OSS and TA Calcs" },
      calc_steps: [
        S(`${name}: classify`, `${referral ? "referral" : "non-referral"} · ${level} · ${tech ? "tech" : "non-tech"}`, ""),
        S(`${name}: CTC`, `fixed + target variable`, `${ctcCcy} ${ctcAmt.toLocaleString()}`),
        ...(ctcCcy === "INR" ? [S(`${name}: FX`, `× ${fx} @ 2025-03-31 RBI`, `$${Math.round(ctcAmt * fx).toLocaleString()}`)] : []),
        S(`${name}: TA %`, `band+level+referral → ${pct}%`, `${pct}%`),
        S(`${name}: gross TA`, ``, `$${grossBase.toLocaleString()}`),
        S(`${name}: − advances`, `sourcing $${srcBilled} + acceptance $${accBilled}`, `$${(srcBilled + accBilled).toLocaleString()}`),
        S(`${name}: invoice this month`, ``, "$" + inv.toLocaleString()),
      ],
    };
  };

  const ta = [
    mkTa("Asha R.", "manager", true, true, 2400000, "INR", 6.5, 0.0120, 400, 600, 0),
    mkTa("Vikram S.", "director", false, true, 95000, "USD", 9.5, 1, 400, 600, 7425),
    mkTa("Neha P.", "non_leadership", true, false, 1200000, "INR", 5.0, 0.0120, 300, 300, 0),
  ];

  const exceptions = [
    { ext_id: "E-2291", issue: "missing_join_date", detail: "balance TA fee cannot trigger", severity: "block" },
    { ext_id: "E-2310", issue: "ambiguous_date", detail: "offer_date '01/10/25' — dd/mm vs mm/dd unresolved", severity: "warn" },
  ];

  const total_oss = oss.amount;
  const total_ta = ta.reduce((s, t) => s + t.invoice_value, 0);
  return {
    stub: true, customer, run_no: runNo, invoice_month: "2025-03", currency: "USD", status: "draft",
    max_seq: seq,
    totals: { oss: total_oss, ta: total_ta, grand: total_oss + total_ta },
    oss, ta, exceptions,
  };
}
