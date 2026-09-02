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

// OpenAI-compatible chat endpoints, used ONLY for a provider the registry gives
// no baseURL for. A provider WITH a baseURL is routed by the registry (see
// callVision) — never from here, or this table silently becomes a second,
// drifting source of truth for where a provider's money is.
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
//
// THE REGISTRY OWNS THE ENDPOINT. This file used to decide a provider's host from
// its own OPENAI_BASE table, and that table drifted from the registry: it sent
// Z.AI to paas/v4 (the pay-as-you-go wallet) while store.js routes Z.AI to
// api.z.ai/api/anthropic (the Coding Plan, where this account's balance actually
// lives). The wallet answers 429 "insufficient balance", the page failed, and the
// failover below then spent ANTHROPIC's wallet finishing a job the operator had
// pointed at Z.AI — the one thing the provider rule forbids.
//
// Same test as ai.js, and the protocol is NOT the test: a provider carrying a
// baseURL speaks the Anthropic wire format at ITS OWN host, with ITS OWN key.
export async function callVision(provider, key, model, system, userText, images) {
  const prov = (loadConfig().providers || {})[provider] || {};
  if (provider === "anthropic" || prov.baseURL) {
    const client = new Anthropic({ apiKey: key, baseURL: prov.baseURL || undefined });
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

  // THE OPERATOR'S CHOICE IS THE CHOICE. This used to second-guess the configured
  // model against a hardcoded table and silently substitute one — set glm-4.6 in
  // the Vault and the call quietly went out as glm-4.5v, so the pipeline screen
  // and reality disagreed. The registered provider/model is now used verbatim;
  // the table is consulted ONLY when nothing is configured, or as a named
  // fallback after a real failure (reported, never silent).
  let provider = prefer || p.provider;
  let model = p.model;
  if (!provider || !getApiKey(provider)) {
    const alt = pickVisionProvider(provider);
    if (!alt) return { text: "", provider: "", model: "", mode: "stub" };
    provider = alt; model = VISION_MODEL[alt];
  } else if (!model) {
    model = VISION_MODEL[provider] || "";     // nothing configured → a sane default
    if (!model) return { text: "", provider, model: "", mode: "stub" };
  }
  const system = p.prompt || "Transcribe this document page image to faithful Markdown. Reproduce all text and tables exactly; never summarise. Output only the Markdown.";
  const prompt = userText || "Document parsing — transcribe this page fully and faithfully into Markdown.";

  // FAILOVER. One provider being rate-limited or out of balance must never cost a
  // page: 24 pages of a 38-page lease were lost to a single 429 "insufficient
  // balance". Try the routed provider, then every other keyed vision provider.
  // Falling back CROSSES A BILLING BOUNDARY — it finishes the job on a different
  // company's wallet than the operator chose. That is worth doing to save a
  // 38-page lease, but never worth doing silently: every hop is recorded in
  // `tried` and the result carries fellBack + billedTo so the caller can say so.
  const chain = [[provider, model], ...VISION_PREF
    .filter((alt) => alt !== provider && VISION_MODEL[alt] && getApiKey(alt))
    .map((alt) => [alt, VISION_MODEL[alt]])];
  let lastErr = "";
  const tried = [];
  for (const [prov, mdl] of chain) {
    tried.push(`${prov}:${mdl}`);
    const key = getApiKey(prov);
    if (!key) continue;
    try {
      const text = await Promise.race([
        callVision(prov, key, mdl, system, prompt, images),
        new Promise((_, rej) => setTimeout(() => rej(new Error("vision timed out (240s)")), 240000)),
      ]);
      if (String(text || "").trim()) return { text, provider: prov, model: mdl, mode: "ai", fellBack: prov !== provider, billedTo: prov, chosen: provider, tried };
      lastErr = `${prov} returned nothing`;
    } catch (e) {
      lastErr = `${prov}: ${String(e.message || e).slice(0, 120)}`;
      // a hard auth/quota failure on this provider — move to the next one
    }
  }
  return { text: "", provider, model, mode: "error", tried, error: `${lastErr} (tried ${tried.join(", ")})`.slice(0, 240) };
}


