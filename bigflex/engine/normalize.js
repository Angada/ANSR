// Normalize a column-mapped worksheet row to canonical values using the rule
// book's normalizers + persisted decisions. Anything unmapped/ambiguous becomes
// a clarification (never a guess).
const norm = (v) => String(v ?? "").trim().toLowerCase();
const num = (v) => { const n = Number(String(v ?? "").replace(/[,\s$₹]/g, "")); return isNaN(n) ? null : n; };

// date → {iso} | {ambiguous} | {bad} | {empty}
export function parseDate(v) {
  if (v == null || v === "" || /^#?n\/?a$/i.test(String(v))) return { empty: true };
  if (v instanceof Date && !isNaN(v)) return { iso: v.toISOString().slice(0, 10) };
  if (typeof v === "number" && v > 30000) { // excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return { iso: d.toISOString().slice(0, 10) };
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return { iso: `${m[1]}-${m[2]}-${m[3]}` };
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    if (a > 12 && b <= 12) return { iso: `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}` }; // dd/mm
    if (b > 12 && a <= 12) return { iso: `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}` }; // mm/dd
    if (a <= 12 && b <= 12) return { ambiguous: s };
    return { bad: s };
  }
  const t = Date.parse(s); return isNaN(t) ? { bad: s } : { iso: new Date(t).toISOString().slice(0, 10) };
}

// layer value → canonical (decision override → rule-book keyword → null)
export function classify(layer, value, rb, decisions = {}) {
  if (value == null || value === "") return null;
  const key = `${layer}:${norm(value)}`;
  if (decisions[key]) return decisions[key];
  for (const rule of (rb.normalizers?.[layer] || [])) {
    if ((rule.match || []).some((m) => norm(m) === norm(value) || norm(value).includes(norm(m)))) return rule.to;
  }
  return null;
}

const DATE_FIELDS = ["sourcing_date", "offer_date", "join_date", "exit_date"];

export function normalizeRow(row, rb, decisions = {}) {
  const clar = [], flags = [];
  const out = { ext_id: row.ext_id ?? null, name: row.name ?? null, role_raw: row.role ?? null, source_raw: row.source ?? null, status_raw: row.status ?? null };

  for (const f of DATE_FIELDS) {
    if (!(f in row)) continue;
    const d = parseDate(row[f]);
    if (d.iso) out[f] = d.iso;
    else if (d.ambiguous) { flags.push(`${f}_ambiguous`); clar.push({ type: "date", topic: `date_format`, field: f, value: d.ambiguous, question: `Date “${d.ambiguous}” (${f}) — is it day/month or month/day?`, options: ["DD/MM", "MM/DD"] }); }
    else if (d.bad) { flags.push(`${f}_unparseable`); }
    // empty handled by validate (required check)
  }

  // source → referral
  if (row.source != null && row.source !== "") {
    const r = classify("source", row.source, rb, decisions);
    if (r) { out.source = r; out.referral = r === "referral"; }
    else { out.source = row.source; clar.push({ type: "map", topic: `source:${norm(row.source)}`, field: "source", value: row.source, question: `How should source “${row.source}” be classified?`, options: ["referral", "non_referral"] }); }
  }

  // role → level (rate lookup later confirms it matches a rate row)
  if (row.role != null) out.level = classify("level", row.role, rb, decisions) || norm(row.role);
  if (row.status != null) out.status = classify("status", row.status, rb, decisions) || norm(row.status);
  if (row.tech != null) out.tech = /tech/i.test(String(row.tech)) && !/non/i.test(String(row.tech));

  out.fixed_ctc = num(row.fixed_ctc);
  out.variable_ctc = num(row.variable_ctc) ?? 0;
  out.total_ctc = out.fixed_ctc != null ? out.fixed_ctc + (out.variable_ctc || 0) : null;
  out.ctc_ccy = String(row.currency || rb.base_currency || "USD").toUpperCase();
  out.date_flags = flags;
  return { normalized: out, clarifications: clar };
}
