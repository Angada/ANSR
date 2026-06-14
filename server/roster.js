// Roster (working sheet) ingestion — adapted from Leela roster-ingest:
// upload → column_match (map headers to canonical fields) → deterministic issue
// detection (date/name/id/CTC/source) → review/correct → confirm to DB.
// Raw rows are kept verbatim; corrections apply on the staged mapping, not the file.

// canonical field → header synonyms (longest/first match wins)
const FIELDS = {
  ext_id: ["employee id", "emp id", "empid", "candidate id", "ext id", "id"],
  name: ["full name", "employee name", "candidate", "name", "employee"],
  role: ["designation", "role", "title", "pg level", "level", "grade", "band"],
  source: ["source of hiring", "hiring source", "source", "referral", "channel"],
  sourcing_date: ["sourcing date", "sourcing commenced", "sourcing", "commencement"],
  offer_date: ["offer accepted", "offer date", "offer"],
  join_date: ["date of joining", "joining date", "joining", "doj", "join", "onboard", "start date"],
  exit_date: ["exit date", "last working", "resignation", "exit", "loi"],
  fixed_ctc: ["fixed pay", "fixed ctc", "fixed", "base salary", "salary"],
  variable_ctc: ["variable pay", "target bonus", "variable ctc", "variable", "bonus"],
  status: ["status", "state", "active"],
};

export const CANONICAL = Object.keys(FIELDS);

export function inferMapping(headers) {
  const used = new Set();
  const mapping = {};
  const low = headers.map((h) => String(h || "").trim().toLowerCase());
  for (const [field, syns] of Object.entries(FIELDS)) {
    for (const syn of syns) {
      const idx = low.findIndex((h, i) => !used.has(i) && h.includes(syn));
      if (idx >= 0) { mapping[field] = headers[idx]; used.add(idx); break; }
    }
  }
  return mapping;
}

// returns {fmt, ok} — detect dd/mm vs mm/dd ambiguity or unparseable
function dateState(v) {
  if (v == null || v === "" || /^#?n\/?a$/i.test(String(v))) return { state: "missing" };
  if (v instanceof Date || (typeof v === "number" && v > 30000)) return { state: "ok" };
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return { state: "ok", fmt: "DD/MM" };
    if (b > 12 && a <= 12) return { state: "ok", fmt: "MM/DD" };
    if (a <= 12 && b <= 12) return { state: "ambiguous" };
    return { state: "bad" };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { state: "ok", fmt: "ISO" };
  if (!isNaN(Date.parse(s))) return { state: "ok" };
  return { state: "bad" };
}

export function detectIssues(rows, mapping) {
  const issues = [];
  const seenIds = new Map();
  rows.forEach((r, i) => {
    const get = (f) => (mapping[f] ? r[mapping[f]] : undefined);
    const rowNo = i + 1;
    const add = (field, issue, severity, value) => issues.push({ row: rowNo, field, issue, severity, value: value ?? "" });

    if (!String(get("name") ?? "").trim()) add("name", "missing name", "block");
    const id = String(get("ext_id") ?? "").trim();
    if (!id) add("ext_id", "missing employee id", "warn");
    else { if (seenIds.has(id)) add("ext_id", `duplicate id (row ${seenIds.get(id)})`, "block", id); else seenIds.set(id, rowNo); }

    for (const df of ["sourcing_date", "offer_date", "join_date", "exit_date"]) {
      if (!mapping[df]) continue;
      const st = dateState(get(df));
      if (st.state === "bad") add(df, "unparseable date", "block", get(df));
      else if (st.state === "ambiguous") add(df, "ambiguous date (dd/mm vs mm/dd)", "warn", get(df));
      else if (st.state === "missing" && df === "join_date") add(df, "missing join date — balance TA can't trigger", "warn");
    }

    if (mapping["fixed_ctc"]) {
      const v = get("fixed_ctc");
      if (v == null || v === "" || isNaN(Number(String(v).replace(/[,\s]/g, "")))) add("fixed_ctc", "missing / non-numeric CTC", "block", v);
    }
    if (mapping["source"] && !String(get("source") ?? "").trim()) add("source", "missing source — referral undecidable", "warn");
  });
  return issues;
}

export function summarizeIssues(issues) {
  const byField = {};
  for (const x of issues) byField[x.field] = (byField[x.field] || 0) + 1;
  return { total: issues.length, blocks: issues.filter((i) => i.severity === "block").length, warns: issues.filter((i) => i.severity === "warn").length, byField };
}
