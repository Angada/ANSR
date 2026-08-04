// ============================================================================
// Q-Docs — the key (C2) step, as a component.
//
// Q-Legal's key is deliberately NOT generalised. It asks for governing law,
// auto-renewal, notice periods and change-of-control because those are the
// things a legal repository is asked about, and a schema broad enough to cover a
// budget sheet would stop asking them well. Diluting a working extractor to
// serve documents it was never for is how both get worse.
//
// So this is a copy that varies only where it must. One engine — the same C1,
// clause layer, edges, vectors, gates and retrieval ladder — with a PROFILE
// deciding what the key asks for. The legal profile below is Q-Legal's schema
// carried over verbatim, so Q-Docs can read a contract exactly as well; the
// others exist because an approval memo and a drawing have different questions.
//
// Adding a domain means adding a profile here. It does not mean touching the
// engine, and it never means editing another domain's schema.
// ============================================================================

// Fields every document has, whatever it is. A profile appends to these rather
// than restating them, so "what does every document carry" has one answer.
const COMMON = `"title":"the document's own title",
 "doc_type":"the best-fitting category from: {{CATEGORIES}} — or, ONLY if none genuinely fits, propose a NEW short category name",
 "doc_type_confidence":0-1,
 "issued_by":"the organisation or person who issued it, if stated",
 "document_date":"YYYY-MM-DD or \\"\\"",
 "reference_no":"any document/reference/drawing number as printed, else \\"\\""`;

// The shared tail: structure, not domain. Contents and clauses are read by the
// deterministic clause layer for documents that have § numbering; the model's
// list is the fallback for prose. Kept identical across profiles on purpose —
// the retrieval ladder reads these keys by name.
const TAIL = `"summary":"2-4 plain sentences on what this document is",
 "tags":["lowercase tags from the controlled vocabulary where possible"],
 "contents":[{"ref":"§ or section as printed","heading":"the heading as printed","page":"if shown, else \\"\\""}],
 "clauses":[{"ref":"as printed","label":"2-4 word topic","gist":"one line of what it actually says"}],
 "exhibits":[{"ref":"","title":"schedules, annexures, appendices, attachments as printed"}]`;

const RULES = `Use ONLY what the document states — empty string when not stated. Never invent a reference; use what the document prints.`;

export const PROFILES = {
  // Q-Legal's schema, carried over unchanged. If Q-Legal's key improves, this is
  // the line to copy it to — deliberately a copy, not a shared import, so a
  // change made for one product cannot silently alter the other.
  legal: {
    label: "Legal — contracts, agreements, deeds",
    fields: `${COMMON},
 "party1":"","party2":"","counterparty":"the non-us party (or party2)",
 "jurisdiction":"country/nationality of the counterparty or of the contract, if stated",
 "effective_date":"YYYY-MM-DD or \\"\\"","expiry_date":"YYYY-MM-DD or \\"\\"",
 "governing_law":"","value":"contract value as printed or \\"\\"",
 "auto_renewal":true|false,"notice_period":"as printed or \\"\\"","executed":true|false`,
    extra: `"notice":{"notice_clauses":[{"ref":"","what":"","method":"","days":""}],"notice_contacts":[""],"change_of_control":[{"ref":"","requires":"notice|consent"}]}`,
    note: `"contents" = the document's table of contents, in order. "clauses" = every substantive clause with its topic.`,
  },

  // Approval memos, budget sheets, minutes, correspondence. What a real-estate
  // team asks of these is who decided, how much, and when — not governing law.
  approval: {
    label: "Approvals, memos, budget notes",
    fields: `${COMMON},
 "project":"the project or site it concerns, if stated",
 "requested_by":"","approved_by":"","approval_status":"approved|rejected|pending|unclear",
 "amount":"the sum as printed, with currency, or \\"\\"",
 "amount_basis":"what the sum is for, one line",
 "decision_date":"YYYY-MM-DD or \\"\\"","valid_until":"YYYY-MM-DD or \\"\\""`,
    extra: `"line_items":[{"what":"","amount":"as printed","note":""}],
 "conditions":[{"what":"a condition attached to the approval","ref":""}]`,
    note: `"line_items" only where the document actually itemises. Never total them yourself — report what is printed.`,
  },

  // Drawings, plans, technical submissions. The title block is the key; there is
  // usually no prose to summarise and no clause structure at all.
  drawing: {
    label: "Drawings, plans, technical sheets",
    fields: `${COMMON},
 "project":"","discipline":"architectural|structural|MEP|civil|landscape|other",
 "drawing_no":"as printed","revision":"as printed","scale":"as printed",
 "drawn_by":"","checked_by":"","approved_by":"",
 "sheet_title":"the title block's own description"`,
    extra: `"revisions":[{"rev":"","date":"YYYY-MM-DD or \\"\\"","description":"as printed"}]`,
    note: `Read the TITLE BLOCK and the revision table. A drawing has no prose — leave summary short and factual, and return empty arrays for contents and clauses rather than inventing structure.`,
  },

  // The fallback. Anything that does not fit a profile still gets identified,
  // dated and summarised, which is enough to find it again.
  generic: {
    label: "Any document",
    fields: `${COMMON},
 "people":["names or organisations the document concerns"],
 "dates":[{"what":"what the date is for","date":"YYYY-MM-DD"}],
 "amounts":[{"what":"","amount":"as printed"}]`,
    extra: "",
    note: `Identify it, date it, say what it is. Do not force it into a shape it does not have.`,
  },
};

// Build the STRICT-JSON contract for a profile. Same shape as Q-Legal's, so the
// whole downstream chain — clause wiki, estate map, index, Ask — reads it
// unchanged; only the meta block differs by domain.
export function keySchema(profileName, categories = []) {
  const p = PROFILES[profileName] || PROFILES.generic;
  const cats = categories.length ? categories : ["Contract", "Approval", "Drawing", "Report", "Other"];
  return `Return STRICT JSON only, no prose:
{"meta":{${p.fields.replace("{{CATEGORIES}}", cats.join(" | "))}},
 ${TAIL}${p.extra ? `,\n ${p.extra}` : ""}}
${p.note}
${RULES}`;
}

export const profileNames = () => Object.entries(PROFILES).map(([k, v]) => ({ id: k, label: v.label }));

// Pick a profile from what we already know, before spending a model call. The
// filename and the detected type are usually enough; `generic` is a real answer,
// not a failure, so nothing is forced into the wrong shape.
export function guessProfile({ filename = "", docType = "", text = "" } = {}) {
  // Underscores and dots are WORD characters, so \bmsa\b never matches
  // "MSA_AkashX.pdf" — which is exactly how real filenames are written. Split on
  // them first, or the commonest naming convention in the estate reads as
  // unrecognised.
  const hay = `${filename} ${docType}`.toLowerCase().replace(/[_\-.()\[\]]+/g, " ");
  if (/\b(dwg|drawing|plan|layout|elevation|section|gfc|rcp)\b/.test(hay)) return "drawing";
  if (/\b(approval|memo|minutes|budget|estimate|boq|variation|po|purchase order)\b/.test(hay)) return "approval";
  if (/\b(agreement|contract|deed|msa|sow|nda|lease|addendum|amendment)\b/.test(hay)) return "legal";
  // fall back to the words themselves, cheaply — a contract says so early on
  const head = String(text).slice(0, 4000).toLowerCase();
  if (/\b(this agreement|whereas|the parties hereto|hereinafter referred)\b/.test(head)) return "legal";
  return "generic";
}
