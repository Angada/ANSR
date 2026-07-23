// runPipeline — the single gated entry point for every AI call in Q&ANSR.
// Resolves a registered pipeline (provider/model/prompt/enabled gate), calls the
// provider (Anthropic-native or Anthropic-compatible e.g. Z.AI via baseURL), and
// falls back gracefully when there's no key / unsupported provider. Raw user text
// never reaches a model except through here.
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, getApiKey } from "./store.js";
import { stubClauses, CLAUSE_FOR_BOX, getInterpretations } from "./clauses.js";

// Assemble grounding for a query: the cited clauses (source of truth) + any
// confirmed interpretations (the learning memory). The model answers FROM this.
export async function buildContext(client, { boxId, clauseRefs } = {}) {
  const refs = clauseRefs || CLAUSE_FOR_BOX[boxId] || [];
  const clauses = stubClauses(client).filter((c) => !refs.length || refs.includes(c.ref));
  const interps = await getInterpretations(client);
  const interpByRef = Object.fromEntries(interps.map((i) => [i.clause_ref, i]));
  const lines = ["CONTRACT CLAUSES (source of truth — cite these):"];
  for (const c of clauses) {
    lines.push(`${c.ref} ${c.title}: ${c.body}`);
    if (interpByRef[c.ref]) lines.push(`  → confirmed reading: ${interpByRef[c.ref].reading}`);
  }
  // any contract-wide interpretations not tied to a shown clause
  for (const i of interps) if (!clauses.find((c) => c.ref === i.clause_ref)) lines.push(`${i.clause_ref} confirmed reading: ${i.reading}`);
  return { text: lines.join("\n"), cited: clauses.map((c) => c.ref) };
}

function stubReply(id, user) {
  return `(${id} · no key) ${user ? `Re "${user.slice(0, 80)}": ` : ""}I'd answer with evidence + the calc trail + a clause reference. Add a provider key in Admin → AI Skills & Pipelines to switch on live answers.`;
}

// override (optional): { provider, model } lets a caller (e.g. a RayDar business
// rule's custom model dropdown) run this pipeline on a different model/provider.
// images (optional): [{ media_type, data(base64) }] — sent as vision content
// blocks alongside the user text (Anthropic-compatible vision, e.g. Claude).
export async function runPipeline(pipelineId, { system = "", user = "", images = [], maxTokens = 800, provider, model } = {}) {
  const cfg = loadConfig();
  const p = cfg.pipelines[pipelineId];
  if (!p) return { mode: "error", text: `unknown pipeline: ${pipelineId}` };
  if (p.kind === "deterministic") return { mode: "deterministic", pipeline: p.id, text: "" };
  if (!p.enabled) return { mode: "disabled", pipeline: p.id, text: "This AI step is disabled in Admin." };

  const useProvider = provider || p.provider, useModel = model || p.model;
  const prov = cfg.providers[useProvider] || {};
  const key = getApiKey(useProvider);
  const anthropicCompat = useProvider === "anthropic" || !!prov.baseURL;
  if (!key || !anthropicCompat) {
    return { mode: "stub", pipeline: p.id, provider: useProvider, model: useModel, text: stubReply(p.id, user) };
  }
  try {
    const client = new Anthropic({ apiKey: key, baseURL: prov.baseURL || undefined });
    const content = images.length
      ? [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type || "image/png", data: im.data } })),
          ...(user ? [{ type: "text", text: user }] : []),
        ]
      : (user || "");
    const r = await client.messages.create({
      model: useModel, max_tokens: maxTokens,
      system: [p.prompt || "", system].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content }],
    });
    const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return { mode: "ai", pipeline: p.id, provider: useProvider, model: useModel, text };
  } catch (e) {
    return { mode: "error", pipeline: p.id, provider: p.provider, model: p.model, text: `AI error: ${String(e.message || e).slice(0, 140)}`, fallback: stubReply(p.id, user) };
  }
}

// A flat map of every AI pipeline → its wiring (for the Admin write-up).
export function aiMap() {
  const cfg = loadConfig();
  return Object.values(cfg.pipelines).map((p) => ({
    id: p.id, product: p.product || "—", name: p.name, kind: p.kind,
    provider: p.provider || "", model: p.model || "", skills: p.skills || [],
    enabled: !!p.enabled, gated: p.kind !== "deterministic",
    description: p.description || "",
  }));
}
