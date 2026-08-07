// Vision transport — the gated multimodal call, ported from munshi3.
// Every OCR/vision call routes through here so it obeys the AI gate: the skill's
// registered provider/model is used (swappable in Admin), and if that provider
// has no key we fall back to the best keyed vision provider. Two wire formats:
// Anthropic image blocks (Claude) and OpenAI-compatible image_url (everything
// else — Z.AI/GLM-V, OpenAI, Gemini, xAI via their OpenAI-compat endpoints).
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig, getApiKey } from "./store.js";

// A known VISION-capable model per provider (the routed default may be text-only,
// e.g. glm-5.1) and the reader's preference order.
export const VISION_MODEL = {
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.5-flash",
  openai: "gpt-4o",
  zai: "glm-4.5v",
  xai: "grok-4",
};
// Preference order for the FALLBACK path. Anthropic first: a provider that has a
// key but no balance answers 429 "insufficient balance", and that used to lose
// pages silently — the reader must prefer the account that can actually pay.
export const VISION_PREF = ["anthropic", "openai", "google", "zai", "xai"];

// OpenAI-compatible chat endpoints per provider (for the image_url path).
const OPENAI_BASE = {
  openai: "https://api.openai.com/v1",
  zai: "https://api.z.ai/api/paas/v4",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
};

// First provider that BOTH has a key AND a known vision model. null = no vision.
export function pickVisionProvider(prefer) {
  const order = prefer ? [prefer, ...VISION_PREF.filter((p) => p !== prefer)] : VISION_PREF;
  for (const p of order) if (VISION_MODEL[p] && getApiKey(p)) return p;
  return null;
}

// Low-level: one multimodal completion. images: [{ data(base64), media_type }].
export async function callVision(provider, key, model, system, userText, images) {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: key });
    const content = [
      ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type || "image/png", data: im.data } })),
      { type: "text", text: userText },
    ];
    const r = await client.messages.create({ model, max_tokens: 4000, system, messages: [{ role: "user", content }] });
    return (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  }
  const base = OPENAI_BASE[provider];
  if (!base) throw new Error(`no vision endpoint for provider ${provider}`);
  const content = [
    { type: "text", text: userText },
    ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.media_type || "image/png"};base64,${im.data}` } })),
  ];
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`vision ${provider} ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return String(j.choices?.[0]?.message?.content || "").trim();
}

// Run a registered vision skill (a pipeline) on page image(s). Honours the
// pipeline's provider/model (the swap), falls back to any keyed vision provider.
// Returns { text, provider, model, mode }.
export async function runVisionSkill(skillId, images, { userText = "", prefer } = {}) {
  const cfg = loadConfig();
  const p = cfg.pipelines[skillId] || {};
  if (p.enabled === false) return { text: "", provider: "", model: "", mode: "disabled" };

  let provider = prefer || p.provider;
  let model = p.model;
  // if the routed provider can't do vision here (no key / no vision model), fall back
  if (!provider || !VISION_MODEL[provider] || !getApiKey(provider)) {
    const alt = pickVisionProvider(provider);
    if (!alt) return { text: "", provider: "", model: "", mode: "stub" };
    provider = alt; model = VISION_MODEL[alt];
  } else if (!model || model === p.model && !isVisionModel(provider, model)) {
    model = VISION_MODEL[provider]; // pin a vision model if the routed one is text-only
  }
  const system = p.prompt || "Transcribe this document page image to faithful Markdown. Reproduce all text and tables exactly; never summarise. Output only the Markdown.";
  const prompt = userText || "Document parsing — transcribe this page fully and faithfully into Markdown.";

  // FAILOVER. One provider being rate-limited or out of balance must never cost a
  // page: 24 pages of a 38-page lease were lost to a single 429 "insufficient
  // balance". Try the routed provider, then every other keyed vision provider.
  const chain = [[provider, model], ...VISION_PREF
    .filter((alt) => alt !== provider && VISION_MODEL[alt] && getApiKey(alt))
    .map((alt) => [alt, VISION_MODEL[alt]])];
  let lastErr = "";
  for (const [prov, mdl] of chain) {
    const key = getApiKey(prov);
    if (!key) continue;
    try {
      const text = await Promise.race([
        callVision(prov, key, mdl, system, prompt, images),
        new Promise((_, rej) => setTimeout(() => rej(new Error("vision timed out (240s)")), 240000)),
      ]);
      if (String(text || "").trim()) return { text, provider: prov, model: mdl, mode: "ai", fellBack: prov !== provider };
      lastErr = `${prov} returned nothing`;
    } catch (e) {
      lastErr = `${prov}: ${String(e.message || e).slice(0, 120)}`;
      // a hard auth/quota failure on this provider — move to the next one
    }
  }
  return { text: "", provider, model, mode: "error", error: lastErr.slice(0, 200) };
}

// crude check: is `model` a plausible vision model id for the provider?
function isVisionModel(provider, model) {
  const m = String(model || "").toLowerCase();
  return m.includes("4.5v") || m.includes("gpt-4o") || m.includes("gemini") || m.includes("sonnet") || m.includes("opus") || m.includes("grok") || m === (VISION_MODEL[provider] || "").toLowerCase();
}
