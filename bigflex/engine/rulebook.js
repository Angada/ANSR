// Compile the AI-produced `billing_rules` box into the canonical, executable rule
// book the interpreter runs. Defensive: AI output shapes vary across contracts;
// map what we recognise, keep raw, and flag anything unmappable for a human.
import { parseRange } from "./operators.js";

const bool = (v) => v === true || /^(true|yes|y|referral|ref)$/i.test(String(v ?? ""));

export function compileRuleBook(box, opts = {}) {
  const c = (box && box.content) || box || {};
  const base_currency = opts.base_currency || c.base_currency || "USD";
  const warnings = [];
  const cost_heads = [];

  // ---- OSS-style recurring slab head ----
  if (Array.isArray(c.oss_slabs) && c.oss_slabs.length) {
    cost_heads.push({
      code: "oss", kind: "recurring_slab", measure: "active_headcount", no_prorata: true,
      clause_ref: c.oss_clause || "§OSS",
      slabs: c.oss_slabs.map((s) => {
        const r = parseRange(s.hc ?? s.band ?? s.range ?? s);
        return { hc_min: r.min, hc_max: r.max === Infinity ? null : r.max,
          fee_type: /per/i.test(s.logic || s.fee_type || "") ? "per_resource" : "minimum",
          rate: Number(String(s.rate ?? s.fee ?? 0).replace(/[,\s$]/g, "")) || 0 };
      }),
    });
  }

  // ---- TA-style one-time split head ----
  if (Array.isArray(c.ta_rate_table) && c.ta_rate_table.length) {
    cost_heads.push({
      code: "ta", kind: "one_time_split", base: "total_ctc", clause_ref: c.ta_clause || "§TA",
      rate_table: {
        keys: ["gcc_band", "level", "referral", "tech"],
        rows: c.ta_rate_table.map((r) => ({
          gcc_band: r.gcc_band ?? r.band ?? r.headcount ?? "*",
          level: r.level ?? r.role ?? "*",
          referral: ("referral" in r) ? bool(r.referral) : "*",
          tech: ("tech" in r) ? bool(r.tech) : "*",
          pct: Number(r.pct ?? r.ta_pct ?? r.rate) || 0,
        })),
      },
      milestones: compileMilestones(c.milestones),
    });
  }

  // pass-through any other cost heads the AI emitted with an explicit kind
  for (const h of c.cost_heads || []) {
    if (h.kind) cost_heads.push(h); else warnings.push(`cost head '${h.code || "?"}' has no kind — needs human`);
  }
  if (!cost_heads.length) warnings.push("no computable cost heads found in the rule book");

  return {
    base_currency,
    inputs: requiredInputsFor(cost_heads),
    normalizers: c.normalizers || defaultNormalizers(),
    cost_heads,
    worked_examples: c.worked_examples || [],
    ctc_definition: c.ctc_definition || "",
    _warnings: warnings,
  };
}

function compileMilestones(ms) {
  if (!Array.isArray(ms) || !ms.length) {
    return [{ code: "full", trigger: "month_of:join_date", amount: "gross" }];
  }
  return ms.map((m) => {
    const code = (m.code || "").toLowerCase();
    let trigger = m.trigger_canonical;
    if (!trigger) {
      if (/sourc/.test(code)) trigger = "month_of:sourcing_date";
      else if (/accept|offer/.test(code)) trigger = "month_of:offer_date";
      else if (/balance|final/.test(code)) trigger = "month_after:join_date:1";
      else trigger = "month_of:join_date";
    }
    let amount;
    if (/balance|final/.test(code)) amount = "gross_minus_advances";
    else if (m.amount != null && typeof m.amount === "object") amount = m.amount;
    else if (m.tech != null || m.nontech != null) amount = { tech: Number(m.tech) || 0, nontech: Number(m.nontech) || 0 };
    else amount = "gross";
    return { code: code || "milestone", trigger, amount, clause_ref: m.clause_ref || "" };
  });
}

function requiredInputsFor(heads) {
  const req = new Map();
  const add = (field, type, why) => req.set(field, { field, type, required: true, why });
  add("ext_id", "text", "identify the placement");
  add("name", "text", "identify the placement");
  for (const h of heads) {
    if (h.kind === "one_time_split") {
      add("fixed_ctc", "number", "base of the fee"); add("variable_ctc", "number", "completes total CTC");
      const keys = h.rate_table?.keys || [];
      if (keys.includes("referral")) add("source", "text", "referral classification");
      if (keys.includes("level")) add("role", "text", "maps to the rate band");
      for (const m of h.milestones || []) {
        const f = (m.trigger || "").split(":")[1];
        if (f) add(f, "date", `triggers the ${m.code} milestone`);
      }
    }
    if (h.kind === "recurring_slab" && h.measure === "active_headcount") {
      add("join_date", "date", "counts into active headcount"); add("exit_date", "date", "removes from active headcount");
    }
  }
  return [...req.values()];
}

export function defaultNormalizers() {
  return {
    source: [
      { to: "referral", match: ["employee referral", "business referral", "referral", "ref"] },
      { to: "non_referral", match: ["gdc", "vendor", "agency", "direct", "#n/a", "na"] },
    ],
    status: [
      { to: "active", match: ["active", "employed", "working"] },
      { to: "exited", match: ["exited", "resigned", "left", "terminated"] },
    ],
  };
}
