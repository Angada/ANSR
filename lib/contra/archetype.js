/* Contra-Archetype — the archetype-maker as a transplantable component.
   Turn a sample contract into a reusable review template: propose the sections
   a reviewer must check, then suggest plain-English rules from the sample's
   actual terms. Host injects `llm` (its own gate/provider), so this drops into
   any project.

     import { makeArchetype } from "@/lib/contra/archetype";
     const arch = await makeArchetype(contractText, { llm });
     // arch = { name, review_outline: [{ key,label,what_to_check,required,order,rules:[{text}] }] }

   `llm` contract:  async ({ system, user, maxTokens }) => string   (returns the model's text)
*/
import { ARCHETYPE_PROMPT, RULES_PROMPT } from "./prompts.js";

const jparse = (t) => { const m = String(t || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const slug = (s) => String(s || "section").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 48);

function normSections(sections) {
  return (Array.isArray(sections) ? sections : []).map((s, i) => ({
    key: slug(s.key || s.label || `section_${i + 1}`),
    label: String(s.label || s.key || `Section ${i + 1}`).slice(0, 80),
    what_to_check: String(s.what_to_check || "").slice(0, 400),
    required: s.required !== false,
    order: i,
    rules: [],
  }));
}

// makeArchetype(contractText, { llm, name }) → { name, review_outline }
export async function makeArchetype(contractText, { llm, name } = {}) {
  if (typeof llm !== "function") throw new Error("makeArchetype: provide llm({system,user,maxTokens}) => string");
  const text = String(contractText || "").slice(0, 60000);
  if (!text.trim()) throw new Error("makeArchetype: empty contract text");

  // 1. propose the review sections
  const p = jparse(await llm({ system: ARCHETYPE_PROMPT, user: text, maxTokens: 4000 })) || {};
  let sections = normSections(p.sections);

  // 2. suggest rules + required flags from the sample's actual terms
  try {
    const rr = jparse(await llm({
      system: RULES_PROMPT,
      user: `Contract:\n${text.slice(0, 40000)}\n\nProposed sections: ${JSON.stringify(sections.map((s) => ({ key: s.key, label: s.label })))}`,
      maxTokens: 4000,
    }));
    if (rr?.sections?.length) {
      const by = Object.fromEntries(rr.sections.map((s) => [s.key, s]));
      sections = sections.map((s) => {
        const x = by[s.key]; if (!x) return s;
        return { ...s, required: x.required !== false, rules: (x.rules || []).filter(Boolean).map((t) => ({ text: String(t).slice(0, 300) })) };
      });
    }
  } catch { /* rules are best-effort */ }

  return { name: p.name || name || "Archetype", review_outline: sections };
}

// add a plain-English review rule to a section of an archetype (host persists it)
export function addRule(archetype, sectionKey, ruleText) {
  const s = (archetype.review_outline || []).find((x) => x.key === sectionKey);
  if (s) (s.rules = s.rules || []).push({ text: String(ruleText).slice(0, 300) });
  return archetype;
}
