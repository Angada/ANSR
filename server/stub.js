// Stub run generator — realistic Q&ANSR invoice trace until the calc engine is
// built. It defines the TRACE CONTRACT the invoice page consumes:
//   replay slider  → every calc_step has a global `seq`; reveal steps 0..p in order.
//   confidence heatmap → every line/step has `confidence` 0..1.
//   audit pack     → every line carries value + why + clause_ref + calc_steps + source_ref.
// Replace with real data from ta_calc/oss_calc/trace; keep the shape identical.

// ---- ops hub cards ---------------------------------------------------------
export function stubOps() {
  const live = (title, sub, href) => ({ title, sub, href, status: "live" });
  const soon = (title, sub) => ({ title, sub, href: "", status: "coming" });
  return [
    live("Invoice Studio", "contract → monthly bill", "/contracts.html"),
    live("Admin · AI Pipelines", "models, switching, keys", "/admin.html"),
    soon("Contract Aggregator", "portfolio billing + forecast"),
    soon("Roster Normalizer", "clean messy emp data"),
    soon("Reconciliation", "deviation scorecard"),
    soon("Exceptions Desk", "un-billable rows"),
    soon("What-if Simulator", "HC / rate impact"),
    soon("Leakage Detector", "unbilled recoverable"),
    soon("FX Exposure", "INR↔USD sensitivity"),
    soon("Forecast", "pipeline → projection"),
    soon("Credit Notes", "clawback / corrections"),
    soon("Tax Engine", "GST / VAT / WHT"),
    soon("Audit Vault", "documents + provenance"),
    soon("Approvals", "maker–checker"),
    soon("Anomaly Sentinel", "outliers + dupes"),
    soon("Dispute Studio", "client pushback replies"),
    soon("Statements", "released invoice packs"),
    soon("Rate Master", "versioned terms"),
    soon("Notifications", "run-ready alerts"),
    soon("Reports", "MIS + exports"),
  ];
}

// ---- contracts list --------------------------------------------------------
export function stubContracts() {
  return [
    { id: "ANSR-KENVUE", code: "ANSR-KENVUE", name: "Kenvue", currency: "USD", runs: 3, last_month: "2025-03", status: "active" },
  ];
}

export function stubRuns(customer = "ANSR-KENVUE") {
  return [
    { run_no: 1, month: "2025-01", status: "complete", grand: 81200 },
    { run_no: 2, month: "2025-02", status: "complete", grand: 84940 },
    { run_no: 3, month: "2025-03", status: "draft", grand: 88465 },
  ];
}

// ---- contract boxes (Phase A output, stub until SOW analyzed) ---------------
export function stubContract(id = "ANSR-KENVUE") {
  const box = (box_type_code, title, content, ai_explain, confidence, clause_ref, status = "draft", extras = {}) =>
    ({ id: box_type_code, box_type_code, title, content, ai_explain, confidence, clause_ref, status, chat: [], suggestions: [], ...extras });
  return {
    contract: { id, name: "Kenvue", currency: "USD", tz: "Asia/Kolkata", source_doc: "SOW (stub — upload to analyze for real)" },
    boxes: [
      box("company", "Company detail",
        { legal_name: "Kenvue Inc.", engagement: "GCC build & operate", signatory: "VP, Global Ops" },
        "Counterparty and engagement scope identified from the SOW header + signature block.", 0.96, "SOW §1 Parties"),
      box("legal", "Legal details",
        { governing_law: "Karnataka, India", term: "36 months", termination: "90-day notice", liability_cap: "12 months fees", confidentiality: "5 years" },
        "Standard legal frame: governing law, term, termination, liability cap.", 0.9, "SOW §9–12"),
      box("payment_terms", "Payment terms",
        { invoice_frequency: "monthly", due_days: 30, currency: "USD", late_fee: "1.5%/mo" },
        "Billed monthly, net-30, in USD. Late fee applies after due date.", 0.93, "SOW §5 Payment"),
      box("commercial_terms", "Commercial terms",
        { ta_fee: "% of CTC by band × level × referral", oss_fee: "monthly by active GCC headcount slab", milestone_split: "sourcing + acceptance + balance" },
        "Two revenue lines — one-time TA recruitment fee (split into 3 milestones) and recurring monthly OSS fee by headcount.", 0.88, "SOW §3 TA · §4 OSS"),
      box("billing_rules", "Rule book & formulas",
        {
          ctc_definition: "Total Annual CTC = fixed salary + target annual cash bonus. Exclude LTI, stock, joining bonus, retention bonus.",
          ta_rate_table: [
            { band: "≤100", level: "non_leadership", referral: false, ta_pct: 8.5 },
            { band: "≤100", level: "non_leadership", referral: true, ta_pct: 6.5 },
            { band: "101–250", level: "manager", referral: false, ta_pct: 9.5 },
            { band: "101–250", level: "director", referral: false, ta_pct: 11.0 },
          ],
          milestones: [
            { code: "sourcing", trigger: "sourcing month (Col C)", tech: 400, nontech: 300 },
            { code: "acceptance", trigger: "offer month (Col D)", tech: 600, nontech: 300 },
            { code: "balance", trigger: "1 month after join (Col E)", amount: "gross TA − advances" },
          ],
          oss_slabs: [
            { hc: "≤50", logic: "minimum monthly fee", rate: 22000 },
            { hc: "51–250", logic: "per active resource", rate: 530 },
          ],
          currency: "CTC may be INR → convert to USD at RBI rate on invoice-date before applying TA%.",
          worked_examples: [
            { scenario: "referral non-leadership, band ≤100, CTC $80k", expected: "$5,200 gross TA (6.5%)" },
            { scenario: "non-referral director, band 101–250, CTC $120k", expected: "$13,200 gross TA (11%)" },
          ],
        },
        "Derived executable rule book. Q&ANSR computes from THIS (no input workbook). Review each rule, chat to clarify, amend, then approve — the calc engine runs exactly this. Worked examples are the trust test the engine must reproduce.",
        0.79, "SOW §3 TA rate table · §3.3 milestone · §4.2 OSS slab",
        "draft",
        { suggestions: [
          { id: "s1", kind: "ai_suggestion", proposed_by: "ai", summary: "Confirm 'referral' source labels: GDC counts as non-referral?", rationale: "EMP list shows GDC + Employee/Business Referral — needs mapping before TA% applies.", clause_ref: "SOW §3.1", confidence: 0.7, status: "open" },
          { id: "s2", kind: "ai_suggestion", proposed_by: "ai", summary: "Add VP/site-leader TA% — not in extracted table", rationale: "Commercial terms mention VP/site leader level but no rate row was found.", clause_ref: "SOW §3", confidence: 0.6, status: "open" },
        ] }),
    ],
  };
}

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
