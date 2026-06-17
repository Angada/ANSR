// Deterministic calc operators — the ONLY billing logic in code. Every contract
// is data (a compiled rule book); these operators interpret it. Pure functions.

// Parse a headcount/band range string into {min,max}. Handles:
// "≤100" "<=100" "101–250" "51-250" "251+" "51–250 onward" "0–50"
export function parseRange(s) {
  if (s == null) return { min: 0, max: Infinity };
  if (typeof s === "object" && ("min" in s || "max" in s)) return { min: s.min ?? 0, max: s.max ?? Infinity };
  const t = String(s).replace(/[,\s]/g, "").replace(/–|—|to/gi, "-").toLowerCase();
  let m;
  if ((m = t.match(/^[<≤]=?(\d+)/))) return { min: 0, max: +m[1] };
  if ((m = t.match(/^[>≥]=?(\d+)/)) || (m = t.match(/^(\d+)\+/)) || (m = t.match(/^(\d+)-?onward/))) return { min: +m[1], max: Infinity };
  if ((m = t.match(/^(\d+)-(\d+)/))) return { min: +m[1], max: +m[2] };
  if ((m = t.match(/^(\d+)$/))) return { min: +m[1], max: +m[1] };
  return { min: 0, max: Infinity };
}
const inRange = (n, r) => n >= r.min && n <= r.max;

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Look up a row in a keyed table. Range-match for numeric/band keys, equality else.
// table = { keys:[...], rows:[{...key fields, ...payload}] }
export function rateLookup(table, ctx) {
  if (!table?.rows?.length) return null;
  for (const row of table.rows) {
    let ok = true;
    for (const k of table.keys || Object.keys(row)) {
      if (!(k in row) || row[k] === null || row[k] === "" || row[k] === "*") continue; // wildcard
      const want = row[k], got = ctx[k];
      if (typeof want === "boolean") { if (Boolean(got) !== want) { ok = false; break; } continue; }
      if (/band|hc|headcount|range/i.test(k) || /[<≤>≥+–-]/.test(String(want))) {
        if (got == null || !inRange(Number(got), parseRange(want))) { ok = false; break; }
        continue;
      }
      if (norm(want) !== norm(got)) { ok = false; break; }
    }
    if (ok) return row;
  }
  return null;
}

// Slab pick by a numeric measure (headcount). Returns the matching slab.
export function slab(slabs, n) {
  for (const s of slabs || []) {
    const r = s.hc_min != null ? { min: s.hc_min, max: s.hc_max ?? Infinity } : parseRange(s.hc ?? s.band ?? s.range);
    if (inRange(Number(n), r)) return s;
  }
  return null;
}

export const pct = (base, p) => Math.round((Number(base) || 0) * (Number(p) || 0)) / 100;

// month helpers — work on ISO 'YYYY-MM-DD' or Date; return 'YYYY-MM'
function toDate(d) { return d instanceof Date ? d : new Date(d); }
export function monthOf(d) {
  if (!d) return null; const x = toDate(d); if (isNaN(x)) return null;
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthAfter(d, n = 1) {
  if (!d) return null; const x = toDate(d); if (isNaN(x)) return null;
  const t = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0, 23, 59, 59)); };
const monthStart = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)); };

// Active-headcount roll-forward at month-end (no pro-rata). ledger = placements
// with join_date/exit_date (ISO or null). Returns {opening,new_joiners,exits,closing}.
export function activeHeadcount(ledger, ym) {
  const end = monthEnd(ym), start = monthStart(ym);
  const prevEnd = monthEnd(monthAfter(start, -1) || ym); // prior month-end
  const activeAt = (when) => ledger.filter((p) => p.join_date && toDate(p.join_date) <= when && (!p.exit_date || toDate(p.exit_date) > when)).length;
  const joinedIn = ledger.filter((p) => p.join_date && toDate(p.join_date) >= start && toDate(p.join_date) <= end).length;
  const exitedIn = ledger.filter((p) => p.exit_date && toDate(p.exit_date) >= start && toDate(p.exit_date) <= end).length;
  return { opening: activeAt(prevEnd), new_joiners: joinedIn, exits: exitedIn, closing: activeAt(end) };
}
