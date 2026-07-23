/* Contra-Contract — the review engine as a transplantable component.
   Detect a contract's archetype, run a holistic review against it (verdicts +
   rule-checks + whole-contract findings + tracked-change redlines), answer
   grounded questions, and mark up the original .docx. Host injects `llm`.

     import * as Contract from "@/lib/contra/contract";
     const matches = await Contract.detect(text, savedArchetypes, { llm });
     const review  = await Contract.review(text, archetype, { llm });  // or [a,b,c] to merge
     const answer  = await Contract.ask(text, "Is liability capped?", { llm });
     const { buffer } = await Contract.markupDocx(originalDocxBuf, review.redlines);

   `llm` contract:  async ({ system, user, maxTokens }) => string
*/
import { DETECT_PROMPT, buildReviewSystem, buildAskSystem } from "./prompts.js";
import { markupDocx } from "./redline.js";

const jparse = (t) => { const m = String(t || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

// snap the model's verdict keys onto the archetype's section keys (adherence safety)
function snapKeys(verdicts, keys, labels) {
  const set = new Set(keys);
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const by = {}; keys.forEach((k, i) => { by[norm(k)] = k; by[norm(labels[i])] = k; });
  return (verdicts || []).map((v) => {
    if (set.has(v.key)) return v;
    const n = norm(v.key); if (by[n]) return { ...v, key: by[n] };
    const hit = keys.find((k, i) => norm(k).includes(n) || n.includes(norm(k)) || norm(labels[i]).includes(n) || n.includes(norm(labels[i])));
    return hit ? { ...v, key: hit } : v;
  });
}

// merge 1..N archetype outlines into one (dedup sections by key, union rules)
export function dedupOutlines(archetypes) {
  const bykey = new Map();
  for (const a of archetypes) for (const s of (a.review_outline || [])) {
    const k = (s.key || slug(s.label));
    if (!bykey.has(k)) bykey.set(k, { key: k, label: s.label, what_to_check: s.what_to_check, required: false, rules: [], from: [] });
    const m = bykey.get(k); m.required = m.required || s.required !== false; if (!m.from.includes(a.name)) m.from.push(a.name);
    const seen = new Set(m.rules.map((r) => r.text.toLowerCase()));
    for (const r of (s.rules || [])) { const t = String(r.text || "").trim(); if (t && !seen.has(t.toLowerCase())) { m.rules.push({ text: t, from: a.name }); seen.add(t.toLowerCase()); } }
  }
  const globals = []; const gseen = new Set();
  for (const a of archetypes) for (const r of (a.global_rules || [])) { const t = String(r.text || "").trim(); if (t && !gseen.has(t.toLowerCase())) { globals.push({ text: t, from: a.name }); gseen.add(t.toLowerCase()); } }
  return { sections: [...bykey.values()], globals };
}

// detect(contractText, savedArchetypes, { llm }) → ranked [{ archetype_id, confidence, why }]
export async function detect(contractText, archetypes, { llm } = {}) {
  if (typeof llm !== "function") throw new Error("detect: provide llm(...)");
  if (!archetypes?.length) return [];
  const p = jparse(await llm({
    system: DETECT_PROMPT,
    user: `Contract:\n${String(contractText).slice(0, 20000)}\n\nArchetypes:\n${JSON.stringify(archetypes.map((a) => ({ id: a.id, name: a.name, sections: (a.review_outline || []).map((s) => s.label) })))}`,
    maxTokens: 600,
  }));
  return (p?.matches || []).filter((m) => m && m.archetype_id != null)
    .map((m) => ({ archetype_id: m.archetype_id, confidence: Number(m.confidence) || 0, why: String(m.why || "").slice(0, 160) }))
    .sort((a, b) => b.confidence - a.confidence);
}

// review(contractText, archetype | [archetypes], { llm }) → the full review object
export async function review(contractText, archetypes, { llm } = {}) {
  if (typeof llm !== "function") throw new Error("review: provide llm(...)");
  const list = Array.isArray(archetypes) ? archetypes : [archetypes];
  const merged = dedupOutlines(list);
  const outline = merged.sections.map((s) => ({ key: s.key, label: s.label, what_to_check: s.what_to_check, required: s.required, rules: s.rules.map((r) => r.text) }));
  const allRules = [
    ...merged.sections.flatMap((s) => s.rules.map((r) => ({ rule: r.text, section_key: s.key }))),
    ...merged.globals.map((g) => ({ rule: g.text, section_key: "whole-contract" })),
  ];
  const keys = outline.map((s) => s.key);
  const out = jparse(await llm({
    system: buildReviewSystem(keys),
    user: `Contract:\n${String(contractText).slice(0, 50000)}\n\nSections to verdict (use these keys):\n${JSON.stringify(outline)}\n\nRules to check (one rule_check each):\n${JSON.stringify(allRules)}`,
    maxTokens: 8000,
  })) || {};
  const verdicts = snapKeys(Array.isArray(out.verdicts) ? out.verdicts : [], keys, merged.sections.map((s) => s.label));
  const rule_checks = Array.isArray(out.rule_checks) ? out.rule_checks : [];
  const findings = Array.isArray(out.findings) ? out.findings : [];
  const issue_count = verdicts.filter((v) => ["risky", "missing", "non_standard"].includes(v.verdict)).length
    + rule_checks.filter((c) => c.result === "breach" || c.result === "check").length + findings.length;
  return {
    summary: out.summary || "", parties: out.parties || {},
    verdicts, rule_checks, findings,
    redlines: (Array.isArray(out.redlines) ? out.redlines : []).filter((r) => r && r.find),
    sections: outline, archetypes: list.map((a) => a.name), issue_count,
  };
}

// ask(contractText, question, { llm }) → grounded, §-cited answer
export async function ask(contractText, question, { llm } = {}) {
  if (typeof llm !== "function") throw new Error("ask: provide llm(...)");
  return String(await llm({ system: buildAskSystem(contractText), user: String(question), maxTokens: 900 })).trim();
}

export { markupDocx };
