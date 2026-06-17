// Atlas pre-intake — fingerprint a contract from its RAW SOW text (before the
// rule book is compiled), propose an archetype, and gate adoption behind a human
// confirm. propose() never mutates; confirm() persists only when the returned
// token still binds the proposed fingerprint (so the human saw what they accept).
import { createHash } from "node:crypto";
import { rank, decide } from "./match.js";

// coarse heuristics over the SOW prose → a partial fingerprint
const HEAD_KW = [
  { kind: "one_time_split", re: /\b(recruit|talent acquisition|ta fee|placement fee|sourcing|milestone)\b/i },
  { kind: "recurring_slab", re: /\b(headcount|active resource|per resource|slab|operations|oss|managed service)\b/i },
  { kind: "recurring_per_unit", re: /\b(per unit|per transaction|per seat|per licen[cs]e)\b/i },
  { kind: "flat", re: /\b(flat fee|fixed monthly|retainer)\b/i },
];
const DIM_KW = [
  { d: "level", re: /\b(level|grade|seniority)\b/i },
  { d: "gcc_band", re: /\bband\b/i },
  { d: "referral", re: /\breferral\b/i },
];
const CCY_RE = /\b(USD|INR|EUR|GBP|AED|SGD)\b/;

export function createPreIntake(q) {
  function fingerprintText(text) {
    const t = String(text || "");
    const heads = [...new Set(HEAD_KW.filter((h) => h.re.test(t)).map((h) => h.kind))].sort();
    const dims = [...new Set(DIM_KW.filter((d) => d.re.test(t)).map((d) => d.d))].sort();
    const currency = (t.match(CCY_RE) || [])[1] || "USD";
    const measures = heads.includes("recurring_slab") ? ["active_headcount"] : [];
    const milestones = /\b(sourcing|acceptance|offer|joining|balance)\b/i.test(t) ? ["acceptance", "balance", "sourcing"] : [];
    return { heads, dims, measures, milestones, inputs: [], currency,
      flags: { milestones: milestones.length > 0, slabs: heads.includes("recurring_slab"), split: heads.includes("one_time_split") },
      source: "pre-intake" };
  }
  // token binds the client to the exact proposed shape — confirm must echo it back
  const token = (client, fp) => createHash("sha256").update(`${client}|${JSON.stringify(fp.heads)}|${JSON.stringify(fp.dims)}|${fp.currency}`).digest("hex").slice(0, 16);

  async function propose(client, sowText) {
    const fp = fingerprintText(sowText);
    let arcs = []; try { arcs = (await q(`select id, slug, name, version, fingerprint from archetype where status='active'`)).rows || []; } catch { /* */ }
    const candidates = rank(fp, arcs).slice(0, 5);
    const decision = arcs.length ? decide(candidates[0]) : "novel";
    return { client, stage: "pre-intake", fingerprint: fp, candidates, decision, top: candidates[0] || null,
      confirm_token: token(client, fp),
      note: "Nothing persisted. Review, then POST /api/atlas/preintake/confirm with {client, fingerprint, confirm_token, archetype_slug?} to adopt." };
  }

  async function confirm(client, payload = {}) {
    const fp = payload.fingerprint;
    if (!fp || token(client, fp) !== payload.confirm_token) return { ok: false, error: "token mismatch — re-run propose and confirm the shown fingerprint" };
    let arch = null;
    if (payload.archetype_slug) arch = (await q(`select id, slug, name, version from archetype where slug=$1`, [payload.archetype_slug])).rows?.[0] || null;
    await q(`insert into contract_fingerprint(customer_id, archetype_id, signals, similarity, decision, candidates, confidence)
             values((select id from customer where code=$1),$2,$3::jsonb,$4,'preintake-confirmed','[]'::jsonb,$4)
             on conflict (customer_id) do update set archetype_id=excluded.archetype_id, signals=excluded.signals, decision=excluded.decision, similarity=excluded.similarity`,
      [client, arch?.id || null, JSON.stringify(fp), arch ? 1 : 0]).catch(() => {});
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('atlas','atlas.preintake.confirm','customer',$1,$2::jsonb)`,
      [client, JSON.stringify({ archetype: arch?.slug || null, heads: fp.heads })]).catch(() => {});
    return { ok: true, client, archetype: arch, fingerprint: fp };
  }

  return { propose, confirm, fingerprintText };
}
