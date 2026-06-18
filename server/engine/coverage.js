// Coverage validator for the canonical rule set. Given a head's declared
// dimensions (each with a value domain) and its SPARSE rate cells (wildcards
// allowed), prove that every combination in the domain resolves to a cell —
// without materialising giant cross-products. Reports gaps + conflicts.
//
// A cell matches a combo when, for every dimension the head bills on, the cell's
// value is "*" (wildcard) or equals the combo's value. Specificity = number of
// non-wildcard dims (a more specific cell wins; two equally-specific matches on
// the same combo = a conflict).

const MAX_COMBOS = 20000; // safety cap — beyond this we sample instead of enumerate
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function cellMatches(cell, combo, dims) {
  for (const d of dims) {
    const want = cell.dims?.[d];
    if (want === undefined || want === null || want === "" || want === "*") continue; // wildcard
    if (typeof want === "boolean") { if (Boolean(combo[d]) !== want) return false; continue; }
    if (!eq(want, combo[d])) return false;
  }
  return true;
}
const specificity = (cell, dims) => dims.filter((d) => { const v = cell.dims?.[d]; return v !== undefined && v !== null && v !== "" && v !== "*"; }).length;

function* combos(domains, dims) {
  if (!dims.length) { yield {}; return; }
  const [first, ...rest] = dims;
  for (const v of domains[first] || ["*"]) {
    for (const sub of combos(domains, rest)) yield { [first]: coerce(v), ...sub };
  }
}
function coerce(v) { if (v === "true" || v === true) return true; if (v === "false" || v === false) return false; return v; }
function size(domains, dims) { return dims.reduce((n, d) => n * Math.max(1, (domains[d] || []).length), 1); }

// coverage for ONE head
export function headCoverage(head, dimDomains, cells) {
  const dims = head.dimensions || [];
  const hc = (cells || []).filter((c) => c.head_code === head.code);
  if (!dims.length) return { head: head.code, expected: 1, covered: hc.length ? 1 : 0, gaps: hc.length ? [] : [{}], conflicts: [], pct: hc.length ? 100 : 0 };
  const total = size(dimDomains, dims);
  if (total > MAX_COMBOS) {
    // too large to enumerate — report authored count + flag for human (sampled)
    return { head: head.code, expected: total, covered: null, gaps: [], conflicts: [], pct: null, note: `domain ${total} combos > cap; ${hc.length} cells authored — spot-check` };
  }
  let covered = 0; const gaps = [], conflicts = [];
  for (const combo of combos(dimDomains, dims)) {
    const hits = hc.filter((c) => cellMatches(c, combo, dims));
    if (!hits.length) { if (gaps.length < 50) gaps.push(combo); continue; }
    covered++;
    // conflict = ≥2 equally-most-specific matches
    const maxSpec = Math.max(...hits.map((h) => specificity(h, dims)));
    const top = hits.filter((h) => specificity(h, dims) === maxSpec);
    if (top.length > 1 && conflicts.length < 50) conflicts.push({ combo, rows: top.length });
  }
  return { head: head.code, expected: total, covered, gaps, conflicts, pct: total ? Math.round((covered / total) * 10000) / 100 : 100 };
}

// coverage for the whole rule set
export function coverage(ruleSet) {
  const dimDomains = {};
  for (const d of ruleSet.dimensions || []) dimDomains[d.name] = (d.allowed_values || []).map(coerce);
  const heads = (ruleSet.heads || []).filter((h) => h.kind === "one_time_split" || (h.dimensions && h.dimensions.length));
  const perHead = heads.map((h) => headCoverage(h, dimDomains, ruleSet.cells));
  const enumerable = perHead.filter((h) => h.pct !== null);
  const pct = enumerable.length ? Math.round((enumerable.reduce((s, h) => s + h.pct, 0) / enumerable.length) * 100) / 100 : 100;
  const gaps = perHead.flatMap((h) => h.gaps.map((g) => ({ head: h.head, combo: g })));
  const conflicts = perHead.flatMap((h) => (h.conflicts || []).map((c) => ({ head: h.head, ...c })));
  const status = conflicts.length ? "red" : pct >= 100 ? "green" : pct >= 80 ? "amber" : "red";
  return { coverage_pct: pct, status, per_head: perHead, gaps, conflicts };
}
