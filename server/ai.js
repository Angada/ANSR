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
// OpenAI-compatible chat endpoints, mirroring vision.js so both transports agree.
const OPENAI_BASE = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.ai/v1", // Kimi — OpenAI-compatible /chat/completions
};

export async function runPipeline(pipelineId, opts = {}) {
  // A positional call — runPipeline(id, "", text, 1600) — used to destructure a
  // STRING silently: no throw, just user:"" and an empty prompt, so the API
  // rejected it and the caller reported "no AI model enabled". Three RayDar
  // steps failed this way 100% of the time and blamed the operator's key.
  // Fail loudly instead of pretending to run.
  if (typeof opts !== "object" || opts === null || Array.isArray(opts))
    return { mode: "error", pipeline: pipelineId, text: `runPipeline("${pipelineId}") was called with a ${typeof opts}, not an options object — expected { system, user, maxTokens }` };
  const { system = "", user = "", images = [], maxTokens = 800, provider, model } = opts;
  const cfg = loadConfig();
  const p = cfg.pipelines[pipelineId];
  if (!p) return { mode: "error", text: `unknown pipeline: ${pipelineId}` };
  if (p.kind === "deterministic") return { mode: "deterministic", pipeline: p.id, text: "" };
  if (!p.enabled) return { mode: "disabled", pipeline: p.id, text: "This AI step is disabled in Admin." };

  const useProvider = provider || p.provider, useModel = model || p.model;
  const prov = cfg.providers[useProvider] || {};
  const key = getApiKey(useProvider);
  // Transport. This used to accept ONLY Anthropic-compatible providers and
  // silently return a fabricated stub for anything else — so every OpenAI-routed
  // pipeline looked enabled in Admin, logged as if it ran, and produced invented
  // text. A configured provider must either work or say why, never pretend.
  const anthropicCompat = useProvider === "anthropic" || !!prov.baseURL;
  if (!key) {
    return { mode: "stub", pipeline: p.id, provider: useProvider, model: useModel,
      text: stubReply(p.id, user), why: `no API key for ${useProvider} — add one in Admin → Vault` };
  }
  if (!anthropicCompat) {
    const base = OPENAI_BASE[useProvider];
    if (!base) {
      return { mode: "error", pipeline: p.id, provider: useProvider, model: useModel,
        text: `AI error: no transport for provider "${useProvider}" — route this pipeline to a supported provider in Admin → AI Pipelines`,
        fallback: stubReply(p.id, user) };
    }
    try {
      const content = images.length
        ? [...(user ? [{ type: "text", text: user }] : []),
           ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.media_type || "image/png"};base64,${im.data}` } }))]
        : (user || "");
      const sys = [p.prompt || "", system].filter(Boolean).join("\n\n");
      const body = { model: useModel, messages: [...(sys ? [{ role: "system", content: sys }] : []), { role: "user", content }] };
      // newer OpenAI models reject max_tokens and require max_completion_tokens
      body[/^(gpt-5|o[1-9])/.test(String(useModel)) ? "max_completion_tokens" : "max_tokens"] = maxTokens;
      const r = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { mode: "error", pipeline: p.id, provider: useProvider, model: useModel,
          text: `AI error: ${useProvider}:${useModel} ${r.status} — ${String(j?.error?.message || JSON.stringify(j)).slice(0, 160)}`,
          fallback: stubReply(p.id, user) };
      }
      const text = String(j.choices?.[0]?.message?.content || "").trim();
      return { mode: "ai", pipeline: p.id, provider: useProvider, model: useModel, text };
    } catch (e) {
      return { mode: "error", pipeline: p.id, provider: useProvider, model: useModel,
        text: `AI error: ${String(e.message || e).slice(0, 140)}`, fallback: stubReply(p.id, user) };
    }
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
