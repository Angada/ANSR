// Stub run generator — realistic Q&ANSR invoice trace until the calc engine is
// built. It defines the TRACE CONTRACT the invoice page consumes:
//   replay slider  → every calc_step has a global `seq`; reveal steps 0..p in order.
//   confidence heatmap → every line/step has `confidence` 0..1.
//   audit pack     → every line carries value + why + clause_ref + calc_steps + source_ref.
// Replace with real data from ta_calc/oss_calc/trace; keep the shape identical.

// ---- agents menu (the launcher) --------------------------------------------
export function stubOps() {
  const A = (name, role, blurb, href, status) => ({ name, role, blurb, href: href || "", status });
  return [
    A("Mint", "AR Reconciler", "Reads your contracts + employee list, rebuilds every invoice (TA + OSS) from the contract's own rules, and explains each number with a clause-backed, replayable trail.", "/mint.html", "live"),
    A("Atlas", "Contract Archetypes", "Fingerprints every contract by its billing physiology and groups them into reusable archetypes — each new contract auto-routes to a known pattern that pre-loads its rule book, inputs and playbook.", "/atlas.html", "live"),
    A("Sift", "Roster Normalizer", "Cleans messy employee data — sources, roles, statuses, dates, CTC, currency — and learns your labels so next month is zero-touch.", "", "coming"),
    A("Tally", "Reconciliation", "Scores deviations and drills to the line + clause behind any mismatch.", "", "coming"),
    A("Flag", "Exceptions Desk", "Surfaces rows that can't be safely billed — missing dates, CTC, duplicates — fixable in plain language.", "", "coming"),
    A("Forge", "What-if Simulator", "Move headcount or rates and see the bill + margin impact before you commit.", "", "coming"),
    A("Ember", "Forecast", "Projects future billing from the hiring pipeline, with explainable drivers.", "", "coming"),
    A("Sentinel", "Anomaly Watch", "Spots outlier CTC, headcount jumps, and duplicate placements before approval.", "", "coming"),
    A("Trace", "Audit Vault", "Every document, extract, and number — provenance back to the original.", "", "coming"),
    A("Admin", "AI · Integrations · Vault · Accounts", "Manage MissQ AI + provider keys, Google & third-party integrations, the document vault, and accounts — the RayDar admin.", "/admin.html", "live"),
  ];
}

// ---- contracts list --------------------------------------------------------
export function stubContracts() {
  return [
    { id: "ANSR-KENVUE", code: "ANSR-KENVUE", name: "Kenvue", currency: "USD", runs: 3, last_month: "2025-03", status: "active" },
  ];
}

export function stubRuns(customer = "ANSR-KENVUE") {
  if (customer !== "ANSR-KENVUE") return []; // new clients start with no runs
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

// ---- Mint contract-analysis run (steps + summary + findings + boxes) -------
export function stubAnalysis(client = "ANSR-KENVUE", runNo = 3) {
  const c = stubContract(client);
  const extra = [
    { id: "caveats", box_type_code: "caveats", title: "Caveats", status: "draft", confidence: 0.82,
      clause_ref: "SOW §3.1 · §6", ai_explain: "Watch-outs that change billing if mis-handled.",
      content: { source_labels: "GDC vs Employee/Business Referral must be mapped before TA% applies", no_pro_rata: "OSS is full-month even for mid-month joiners/exits", fx: "CTC in INR converts at RBI rate on invoice date" }, chat: [], suggestions: [] },
    { id: "flags", box_type_code: "flags", title: "Flags", status: "draft", confidence: 0.7,
      clause_ref: "SOW §3", ai_explain: "Gaps found during analysis that need a human decision.",
      content: { missing_rate: "No VP/site-leader TA% row found in the rate table", ambiguous: "Some offer dates are dd/mm vs mm/dd ambiguous" }, chat: [], suggestions: [] },
  ];
  return {
    client, run_no: runNo, generated_at: null, stub: true,
    steps: ["Studying contract terms", "Reading the document", "Extracting clauses", "Creating billing rules", "Building analysis boxes", "Summarising findings"],
    summary: {
      title: "Contract summary",
      text: "ANSR–Kenvue GCC build-and-operate SOW. Two revenue lines: a one-time TA recruitment fee (split into sourcing, acceptance and balance milestones) and a recurring monthly OSS fee by active GCC headcount. Billed monthly in USD, net-30.",
    },
    findings: [
      "TA % varies by GCC headcount band × candidate level × referral status — referral lowers the rate.",
      "OSS is measured at month-end with no pro-rata, using join and exit dates.",
      "Total CTC = fixed + target variable; excludes LTI, stock, joining and retention bonuses.",
      "TA fee is billed in three milestones mapped to Col C (sourcing), D (acceptance), E (balance).",
      "INR salaries convert to USD at the RBI rate on the invoice date before applying TA %.",
    ],
    boxes: [...c.boxes, ...extra],
  };
}

// Structured invoice (ANSR-branded) built from a run's calc. Stub numbers until
// the calc engine lands; shape is final so the PDF/breakdown just render it.
export function stubInvoice(client = "ANSR-KENVUE", runNo = 3) {
  const r = stubRun(client, runNo);
  const sum = (k) => r.ta.reduce((s, t) => s + (t[k] || 0), 0);
  const lines = [
    { head: "OSS", desc: `Operations Support Fee · ${r.oss.invoice_month} · ${r.oss.closing_active_hc} active HC`, hsn: "998511", amount: r.oss.amount },
    { head: "TA — Sourcing", desc: "Sourcing commencement advances", hsn: "998511", amount: sum("sourcing_billed") },
    { head: "TA — Acceptance", desc: "Offer acceptance advances", hsn: "998511", amount: sum("acceptance_billed") },
    { head: "TA — Balance", desc: "Balance TA fees (one month post-onboarding)", hsn: "998511", amount: sum("balance_billed") },
  ].filter((l) => l.amount > 0);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = { label: "Tax", rate: 0, amount: 0, note: "place-of-supply / GST as applicable" };
  const nameOf = { "ANSR-KENVUE": "Kenvue Inc." };
  return {
    stub: true, client, run_no: runNo, invoice_month: r.invoice_month, currency: r.currency,
    invoice_no: `ANSR/${client.replace(/[^A-Z0-9]/g, "").slice(0, 4)}/${r.invoice_month.replace("-", "")}/${String(runNo).padStart(2, "0")}`,
    from: { name: "ANSR Global Services Pvt. Ltd.", addr: "<ANSR registered address>", gstin: "<ANSR GSTIN>", email: "billing@ansr.com" },
    to: { name: nameOf[client] || client, addr: "<client billing address>", attn: "<accounts payable contact>", gstin: "<client GSTIN>" },
    lines, subtotal, tax, total: subtotal + tax.amount,
    notes: "Computed by Q&ANSR · Mint (AR Reconciler) from the SOW + employee worksheet. Every line is clause- and calc-traceable.",
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
