// Atomizer — the deterministic heart of Munshi-for-Mint.
// The AI still emits Mint's structured 7-box JSON (the contract-intake pipeline).
// This module DECOMPOSES each box into atomic, individually-traceable rule-chips
// and REASSEMBLES chips back into the exact box-content shape the calc engine's
// compileRuleBook() already runs. Intelligence decides the reading; determinism
// does the atomizing — so we get Munshi's traceable/amendable chips WITHOUT the
// loose fuzzy taxonomy the calc engine can't execute (docs/13-munshi-for-mint.md).
import { createHash } from "node:crypto";

export const BOX_TYPES = [
  "company", "legal", "payment_terms", "commercial_terms",
  "billing_rules", "caveats", "flags",
];

// Identity fields per known table — the row's "dimensions" (not its measures).
// Used to build a STABLE chip key so the same logical row upserts across
// re-parses (and a genuinely new row forks a new chip). Unknown tables fall back
// to generic dimension detection, then a content hash.
const TABLE_IDENTITY = {
  ta_rate_table: ["gcc_band", "band", "headcount", "hc", "level", "role", "referral", "tech"],
  oss_slabs: ["hc", "band", "range", "logic"],
  milestones: ["code", "trigger"],
  worked_examples: ["scenario"],
};
// Fields that are measures (values), never identity — for the generic fallback.
const MEASURE = /(pct|rate|amount|fee|tech$|nontech|expected|value|min$|max$)/i;

const slugVal = (v) =>
  String(v ?? "").toLowerCase().trim()
    .replace(/\s+/g, "").replace(/[^a-z0-9.<>=+±%–_-]/g, "").slice(0, 28) || "_";

function rowSlug(table, row, idx) {
  if (!row || typeof row !== "object") return `#${idx}`;
  const ids = TABLE_IDENTITY[table] || [];
  let parts = ids.filter((k) => k in row).map((k) => `${k}=${slugVal(row[k])}`);
  if (!parts.length) {
    parts = Object.entries(row)
      .filter(([k, v]) => typeof v !== "number" && typeof v !== "object" && !MEASURE.test(k))
      .map(([k, v]) => `${k}=${slugVal(v)}`);
  }
  if (!parts.length) return `h${createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 8)}`;
  return parts.join("|");
}

// One box → its atomic chips. Emits a __meta chip (title + ai_explain) so the box
// shell can be rebuilt for the UI, plus one chip per scalar field / table row /
// list item. Each chip carries the box's clause_ref (a row may override it).
export function boxToChips(box) {
  const content = (box && box.content) || {};
  const bt = box.box_type_code || box.box_type;
  const clause = box.clause_ref || "";
  const conf = box.confidence ?? null;
  const chips = [];
  let ord = 0;
  const push = (key, value, extra = {}) =>
    chips.push({ box_type: bt, key, value, clause_ref: clause, confidence: conf, ord: ord++, ...extra });

  push("__meta", { kind: "box_meta", title: box.title || "", ai_explain: box.ai_explain || "" });

  for (const [field, v] of Object.entries(content)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      v.forEach((row, idx) =>
        push(`${field}#${rowSlug(field, row, idx)}`, { kind: "row", table: field, row, idx },
          { clause_ref: (row && row.clause_ref) || clause }));
    } else if (Array.isArray(v)) {
      v.forEach((item, idx) => push(`${field}#${idx}`, { kind: "item", field, v: item, idx }));
    } else if (v && typeof v === "object") {
      push(field, { kind: "object", field, v });
    } else {
      push(field, { kind: "scalar", field, v });
    }
  }
  return chips;
}

export function boxesToChips(boxes = []) {
  return boxes.flatMap((b) => boxToChips(b));
}

// Inverse of boxToChips for ONE box's chips → its content object. Rows regroup by
// table in chip order; scalars/objects/items map straight back. __meta is skipped.
export function chipsToContent(chips = []) {
  const sorted = [...chips].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
  const content = {};
  for (const ch of sorted) {
    const val = ch.value || {};
    if (val.kind === "box_meta") continue;
    if (val.kind === "row") (content[val.table] ??= []).push(val.row);
    else if (val.kind === "item") (content[val.field] ??= []).push(val.v);
    else if (val.kind === "scalar" || val.kind === "object") content[val.field] = val.v;
  }
  return content;
}

// All chips (any box) → rebuilt box objects for the UI, grouped + ordered. Each
// box carries its chips[] so the UI can render clause_ref + confidence +
// confirm/amend per chip. Box confidence = min of its data chips (weakest link).
export function chipsToBoxes(chips = []) {
  const byBox = new Map();
  for (const ch of chips) {
    if (!byBox.has(ch.box_type)) byBox.set(ch.box_type, []);
    byBox.get(ch.box_type).push(ch);
  }
  const boxes = [];
  const order = new Map(BOX_TYPES.map((t, i) => [t, i]));
  for (const [bt, group] of byBox) {
    const meta = group.find((c) => c.value?.kind === "box_meta")?.value || {};
    const dataChips = group
      .filter((c) => c.value?.kind !== "box_meta")
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    const confs = dataChips.map((c) => c.confidence).filter((x) => x != null);
    const statuses = dataChips.map((c) => c.status || "draft");
    boxes.push({
      id: bt, box_type_code: bt, title: meta.title || titleize(bt), ai_explain: meta.ai_explain || "",
      clause_ref: dataChips[0]?.clause_ref || "",
      confidence: confs.length ? Math.min(...confs) : null,
      // a box is "confirmed" only when every data chip is confirmed
      status: dataChips.length && statuses.every((s) => s === "confirmed") ? "approved" : "draft",
      content: chipsToContent(group),
      chips: dataChips,
    });
  }
  boxes.sort((a, b) => (order.get(a.box_type_code) ?? 99) - (order.get(b.box_type_code) ?? 99));
  return boxes;
}

// billing_rules content specifically — what compileRuleBook() consumes.
export function chipsToRuleContent(chips = []) {
  return chipsToContent(chips.filter((c) => c.box_type === "billing_rules"));
}

const titleize = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
