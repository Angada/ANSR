// runPipeline — the single gated entry point for every AI call in Q&ANSR.
// Resolves a registered pipeline (provider/model/prompt/enabled gate), calls the
// provider (Anthropic-native or Anthropic-compatible e.g. Z.AI via baseURL), and
// falls back gracefully when there's no key / unsupported provider. Raw user text
// never reaches a model except through here.
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, getApiKey } from "./store.js";

function stubReply(id, user) {
  return `(${id} · no key) ${user ? `Re "${user.slice(0, 80)}": ` : ""}I'd answer with evidence + the calc trail + a clause reference. Add a provider key in Admin → AI Skills & Pipelines to switch on live answers.`;
}

export async function runPipeline(pipelineId, { system = "", user = "" } = {}) {
  const cfg = loadConfig();
  const p = cfg.pipelines[pipelineId];
  if (!p) return { mode: "error", text: `unknown pipeline: ${pipelineId}` };
  if (p.kind === "deterministic") return { mode: "deterministic", pipeline: p.id, text: "" };
  if (!p.enabled) return { mode: "disabled", pipeline: p.id, text: "This AI step is disabled in Admin." };

  const prov = cfg.providers[p.provider] || {};
  const key = getApiKey(p.provider);
  const anthropicCompat = p.provider === "anthropic" || !!prov.baseURL;
  if (!key || !anthropicCompat) {
    return { mode: "stub", pipeline: p.id, provider: p.provider, model: p.model, text: stubReply(p.id, user) };
  }
  try {
    const client = new Anthropic({ apiKey: key, baseURL: prov.baseURL || undefined });
    const r = await client.messages.create({
      model: p.model, max_tokens: 800,
      system: [p.prompt || "", system].filter(Boolean).join("\n\n"),
      messages: [{ role: "user", content: user || "" }],
    });
    const text = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return { mode: "ai", pipeline: p.id, provider: p.provider, model: p.model, text };
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
