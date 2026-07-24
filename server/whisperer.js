// Whisperer backend — Journey 1 (mock-first): candidates → ClientMind → cohort →
// Hunger → Feed Stories. Every AI step runs through a gated pipeline (runPipeline)
// with a deterministic MOCK fallback so the whole journey works with no key.
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";
import { getIntegrationKey, publicIntegrations } from "./store.js";

const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const enabled = (id) => { try { return !!publicIntegrations()[id]?.enabled && !!getIntegrationKey(id); } catch { return false; } };
const timeout = (p, ms = 9000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);

// ---- Business rules per integration (editable in Settings; "80% no code") ---
// Each: how we query it (collection) + the AI prompt + a model override
// (""=use the pipeline default) + a gate. Stored in wh_business_rule(name=id).
const RULE_DEFAULTS = {
  youtube:    { app: "RayDar", pipeline: "trend-detect", collection: { regionCode: "IN", relevanceLanguage: "en", publishedDays: 30, maxResults: 20, commentsTopVideos: 5, commentsPerVideo: 20 }, prompt: "Classify each YouTube item → demand topic (1–6 / Emerging), 1Up franchise, 4-register distribution, and the underlying question. Comments carry the real feeling — weight them.", model: "", enabled: true },
  reddit:     { app: "RayDar", pipeline: "trend-detect", collection: { subreddits: ["developersIndia", "IndianWorkplace", "IndiaCareers", "cscareerquestions", "leetcode"], topPosts: 50, timeframe: "month", commentTrees: 10, commentsPerPost: 100 }, prompt: "Classify each Reddit post/comment → topic, franchise, registers, underlying question. Comment trees are the highest-value signal.", model: "", enabled: true },
  newsapi:    { app: "RayDar", pipeline: "trend-detect", collection: { language: "en", pageSize: 20, sortBy: "publishedAt" }, prompt: "Summarise each article's relevance to the demand topics.", model: "", enabled: true },
  serpapi:    { app: "RayDar", pipeline: "trend-detect", collection: { gl: "in", hl: "en", num: 5 }, prompt: "Extract trending headlines relevant to the demand topics.", model: "", enabled: true },
  tavily:     { app: "RayDar", pipeline: "feedstory-generate", collection: { max_results: 5, search_depth: "basic", include_answer: true }, prompt: "Use for VALIDATION — pull facts + cite source URLs. Flag claims that conflict with the feed.", model: "", enabled: true },
  serper:     { app: "RayDar", pipeline: "feedstory-generate", collection: { gl: "in", hl: "en", num: 5 }, prompt: "Use for grounding + validation; cite links.", model: "", enabled: true },
  perplexity: { app: "RayDar", pipeline: "feedstory-generate", collection: { model: "sonar", max_tokens: 500 }, prompt: "Research + validate with citations; India English context.", model: "", enabled: true },
};
// tag the above as integrations, add the rest of the catalog + journey + scoring rules
for (const k of Object.keys(RULE_DEFAULTS)) RULE_DEFAULTS[k].category = "integration";
Object.assign(RULE_DEFAULTS, {
  exa:       { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { numResults: 5, useAutoprompt: true }, prompt: "Neural search for validation — pull the most relevant sources + cite URLs.", model: "", enabled: false },
  brave:     { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { count: 5, country: "in", search_lang: "en" }, prompt: "Web search for grounding + validation; cite links.", model: "", enabled: false },
  factcheck: { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { languageCode: "en" }, prompt: "Check claims against published fact-checks; flag anything contradicted — never assert independently.", model: "", enabled: false },
  wikidata:  { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { limit: 3 }, prompt: "Ground entities and definitions against Wikipedia / Wikidata.", model: "", enabled: false },
  // ---- journey steps (the Hunger routes) ----
  trend_spotting: { app: "RayDar", category: "journey", pipeline: "hunger-generate", collection: { topics: 6, include_emerging: true }, prompt: "From the chosen demand topics, frame the cohort's hunger — what they search, watch and complain about — and return the demand topics to sweep.", model: "", enabled: true },
  seo_inputs:     { app: "RayDar", category: "journey", pipeline: "hunger-generate", collection: { max_inputs: 50 }, prompt: "Parse pasted SEO research (keywords / GSC / competitor gaps) → demand signals mapped to the 6 topics; extract the highest-intent queries.", model: "", enabled: true },
  talentmind:     { app: "RayDar", category: "journey", pipeline: "cohort-nl-query", collection: { tenure_max_years: 2, job_seekers_only: true }, prompt: "Job seekers only, under 2 years tenure per company. Parse each corpus into TalentMind chips, cohort them, read their hunger.", model: "", enabled: true },
  // ---- scoring (composite rank weights + gap map) ----
  scoring: { app: "RayDar", category: "scoring", pipeline: "raydar-rank",
    collection: { weights: { gap: 0.35, velocity: 0.25, strategic: 0.20, historical: 0.20 },
      gap_map: { "Keywords and resume": 0.9, "Salary negotiation": 0.85, "Using AI to get better jobs": 0.82, "Landing your dream job": 0.7, "Skills to get a new job": 0.6, "Which coding tool to use": 0.6, "Emerging": 0.75 } },
    prompt: "Composite rank = Σ(weight × signal). Signals: gap (demand ÷ supply quality), velocity (views ÷ days), strategic (topic weight), historical (Used acceptance per franchise).", model: "", enabled: true },
  // ---- guardrails (from the Talent500 brief — prepended to every idea prompt) ----
  guardrails: { app: "RayDar", category: "guardrails", pipeline: "feedstory-generate",
    collection: {
      language: "English", region: "India", locale: "en-IN",
      audience: "Indian job seekers · GCC / tech talent", brand: "Talent500", currency: "INR",
      idiom: ["hike", "notice period", "CTC", "package", "service company", "product company", "fresher", "campus placement", "on-site", "bench"],
      out_of_scope: ["Hindi / regional-language content (v2)"],
      caveats: ["Reddit is a leading indicator, not a census", "velocity is directional, not precise"],
    },
    prompt: "GUARDRAILS (Talent500 brief):\n• Audience — Indian job seekers (GCC / tech talent). Write India English; use Indian workplace idiom (hike, notice period, CTC, package, service/product company, fresher, campus placement, on-site, bench). Use INR for money.\n• Voice — the whisperer posture: sound like you read the reader's mind before they spoke. Never hype, never generic. Be the only adult in the room. Do NOT replicate what's already out there — bring an original angle.\n• Output — a HEADING + topic-guide brief for a writer. NEVER finished copy.\n• Evidence must be specific (cite comment counts / sources), never vague.\n• Contradictions — you PROPOSE, you never ASSERT. Flag any 'this is wrong' for human verification; never assert independently.\n• Treat Reddit as a leading indicator (not a census) and velocity as directional (not precise).",
    model: "", enabled: true },
});
const mergeRule = (id, r) => { const d = RULE_DEFAULTS[id] || {}; return { ...d, ...(r || {}), collection: { ...(d.collection || {}), ...((r || {}).collection || {}) } }; };
async function getRule(id) { try { const r = (await q(`select rule from wh_business_rule where name=$1`, [id])).rows?.[0]?.rule; return mergeRule(id, r); } catch { return mergeRule(id, null); } }

// ---- Feed collection (real when a source's key is enabled; else []) ---------
// YouTube: search → video stats (views + publishedAt) → top-N comments. The
// comments are the demand signal; views÷age is velocity. All params from the rule.
async function fetchYouTube(topic) {
  const key = getIntegrationKey("youtube"); if (!key) return [];
  const c = (await getRule("youtube")).collection || {};
  const publishedAfter = new Date(Date.now() - (c.publishedDays || 30) * 864e5).toISOString();
  const s = await timeout(fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${Math.min(c.maxResults || 20, 25)}&regionCode=${c.regionCode || "IN"}&relevanceLanguage=${c.relevanceLanguage || "en"}&order=${c.order || "viewCount"}&publishedAfter=${encodeURIComponent(publishedAfter)}&q=${encodeURIComponent(topic)}&key=${encodeURIComponent(key)}`));
  const sj = await s.json();
  const vids = (sj.items || []).map((i) => ({ id: i.id?.videoId, title: i.snippet?.title, body: i.snippet?.description, publishedAt: i.snippet?.publishedAt })).filter((v) => v.id);
  if (!vids.length) return [];
  const stats = {};
  try {
    const st = await timeout(fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${vids.map((v) => v.id).join(",")}&key=${encodeURIComponent(key)}`));
    const stj = await st.json();
    for (const it of (stj.items || [])) stats[it.id] = { views: Number(it.statistics?.viewCount || 0), comments: Number(it.statistics?.commentCount || 0), publishedAt: it.snippet?.publishedAt };
  } catch { /* stats optional */ }
  const topN = Math.min(c.commentsTopVideos || 5, vids.length), perVid = c.commentsPerVideo || 20;
  const cmts = {};
  await Promise.allSettled(vids.slice(0, topN).map(async (v) => {
    try {
      const cr = await timeout(fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${v.id}&maxResults=${perVid}&order=relevance&key=${encodeURIComponent(key)}`));
      const cj = await cr.json(); cmts[v.id] = (cj.items || []).map((x) => x.snippet?.topLevelComment?.snippet?.textDisplay || "").filter(Boolean);
    } catch { /* comments optional */ }
  }));
  const now = Date.now();
  return vids.map((v) => {
    const st = stats[v.id] || {}; const pub = st.publishedAt || v.publishedAt;
    const ageDays = pub ? Math.max(1, Math.round((now - new Date(pub).getTime()) / 864e5)) : null;
    return { source: "youtube", external_id: v.id, title: v.title, url: `https://youtube.com/watch?v=${v.id}`, body: v.body, meta: { views: st.views || 0, ageDays, comments: cmts[v.id] || [] } };
  });
}
// Reddit: search posts → walk comment trees on the top-N. Comment trees are the
// highest-value demand signal; params (subreddits/topPosts/commentTrees) from the rule.
async function fetchReddit(topic) {
  const pair = getIntegrationKey("reddit"); if (!pair || !pair.includes(":")) return [];
  const [cid, secret] = pair.split(":");
  const tok = await timeout(fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${cid}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded", "user-agent": "qansr-whisperer/1.0" }, body: "grant_type=client_credentials" }));
  const tj = await tok.json(); if (!tj.access_token) return [];
  const H = { authorization: `Bearer ${tj.access_token}`, "user-agent": "qansr-whisperer/1.0" };
  const rule = (await getRule("reddit")).collection || {};
  const r = await timeout(fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(topic)}&limit=${Math.min(rule.topPosts || 10, 15)}&sort=relevance&t=${rule.timeframe || "month"}`, { headers: H }));
  const j = await r.json(); const posts = (j.data?.children || []).map((c) => c.data).filter(Boolean);
  const topN = Math.min(rule.commentTrees || 10, posts.length), perPost = rule.commentsPerPost || 100;
  const cmts = {};
  await Promise.allSettled(posts.slice(0, topN).map(async (p) => {
    try {
      const cr = await timeout(fetch(`https://oauth.reddit.com/comments/${p.id}?limit=${perPost}&depth=4`, { headers: H }));
      const cj = await cr.json(); const arr = [];
      const walk = (node) => { for (const ch of (node?.data?.children || [])) { if (ch.kind === "t1" && ch.data?.body) { arr.push(ch.data.body); walk(ch.data.replies); } } };
      if (Array.isArray(cj)) walk(cj[1]); cmts[p.id] = arr.slice(0, perPost);
    } catch { /* comments optional */ }
  }));
  const now = Date.now();
  return posts.map((p) => {
    const ageDays = p.created_utc ? Math.max(1, Math.round((now / 1000 - p.created_utc) / 86400)) : null;
    return { source: "reddit", external_id: p.id, title: p.title, url: "https://reddit.com" + p.permalink, body: (p.selftext || "").slice(0, 400), meta: { score: p.score, ageDays, comments: cmts[p.id] || [] } };
  });
}
async function fetchNews(topic) {
  const key = getIntegrationKey("newsapi"); if (!key) return [];
  const c = (await getRule("newsapi")).collection || {};
  const r = await timeout(fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&language=${c.language||"en"}&pageSize=${c.pageSize||10}&sortBy=${c.sortBy||"publishedAt"}&apiKey=${encodeURIComponent(key)}`));
  const j = await r.json(); return (j.articles || []).map((a) => ({ source: "news", title: a.title, url: a.url, body: a.description }));
}
async function fetchSerpNews(topic) {
  const key = getIntegrationKey("serpapi"); if (!key) return [];
  const c = (await getRule("serpapi")).collection || {};
  const r = await timeout(fetch(`https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(topic)}&gl=${c.gl||"in"}&hl=${c.hl||"en"}&api_key=${encodeURIComponent(key)}`));
  const j = await r.json(); return (j.news_results || []).slice(0, c.num || 5).map((n) => ({ source: "serpapi", title: n.title, url: n.link, body: n.snippet }));
}
// topics may be strings or {name, terms[]}. Each concept's terms are the actual
// search queries fired at YouTube/Reddit/News; items are tagged with the concept.
async function collectFeed(topics) {
  const out = [];
  for (const t of (topics || []).slice(0, 6)) {
    const name = typeof t === "string" ? t : t.name;
    const terms = (typeof t === "object" && Array.isArray(t.terms) && t.terms.length) ? t.terms : [name];
    for (const term of terms.slice(0, 4)) {
      const batches = await Promise.allSettled([fetchYouTube(term), fetchReddit(term), fetchNews(term), fetchSerpNews(term)]);
      for (const b of batches) if (b.status === "fulfilled") for (const it of (b.value || [])) out.push({ ...it, topic: name, term });
    }
  }
  // dedupe by url, persist (incl. metrics meta)
  const seen = new Set(); const uniq = out.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url));
  for (const it of uniq) await q(`insert into wh_feed_item(source,external_id,title,url,body,meta) values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing`, [it.source, it.external_id || null, it.title || "", it.url, it.body || "", JSON.stringify(it.meta || {})]).catch(() => {});
  return uniq;
}

// ---- Stage 3 · Gap Analysis — real signals from the collected feed ----------
// demand  = question-like comments/posts on the topic (comment trees weighted)
// supply  = how much fresh content already answers it (count + top-item age)
// velocity = views ÷ days since publish (YouTube), normalised
// Falls back to the configured gap_map + item-count when no live metrics exist.
const isQuestion = (t) => /\?|\bhow\b|\bwhy\b|\bwhat\b|\bwhich\b|\bwhen\b|\bcan i\b|\bshould i\b|worth it|vs\b/i.test(String(t || ""));

// Rank the raw collected feed items (videos/posts) by velocity (views ÷ days),
// with a plain-English "why" — the snapshot behind the results page's "top
// videos that scored high" block. Only items with a real signal survive.
function rankFeedSignal(items) {
  return (items || []).filter((f) => f.url).map((f) => {
    const m = f.meta || {};
    const views = Number(m.views || 0), ageDays = m.ageDays || null;
    const vRaw = ageDays ? views / Math.max(1, ageDays) : 0;
    const velocity = vRaw > 0 ? Math.min(1, Math.log10(vRaw + 1) / 5) : 0;
    const comments = Array.isArray(m.comments) ? m.comments : [];
    const questions = comments.filter(isQuestion).length;
    return { source: f.source, title: f.title || "", url: f.url, topic: f.topic || null,
      franchise: f.tags?.franchise || null, views, ageDays, comments: comments.length, questions, score: Number(m.score || 0),
      velocity: Math.round(velocity * 100) / 100 };
  }).filter((x) => x.views > 0 || x.comments > 0 || x.source === "reddit")
    .sort((a, b) => b.velocity - a.velocity || b.views - a.views || b.comments - a.comments)
    .slice(0, 15);
}
function topicSignals(items, gapMapVal) {
  const withMeta = items.filter((x) => x.meta && (x.meta.comments || x.meta.views != null));
  // velocity — top views/day across matched videos, log-normalised (~100k/day → 1)
  const vps = withMeta.map((x) => (x.meta.views || 0) / Math.max(1, x.meta.ageDays || 30)).filter((v) => v > 0);
  const velocity = vps.length ? Math.min(1, Math.log10(Math.max(...vps) + 1) / 5) : null;
  // demand — question-like comments + question-like titles
  const comments = withMeta.flatMap((x) => x.meta.comments || []);
  const questions = comments.filter(isQuestion).length + items.filter((x) => isQuestion(x.title)).length;
  // supply — count + freshness (top item age)
  const ages = withMeta.map((x) => x.meta.ageDays).filter((a) => a != null);
  const topAge = ages.length ? Math.min(...ages) : null;
  const stale = topAge != null && topAge > 365;
  const haveSignal = comments.length > 0 || velocity != null;
  let gap = gapMapVal ?? 0.6, gapType = null;
  if (haveSignal) {
    const demandN = Math.min(1, questions / 20);                 // 20 unanswered Qs → saturate
    const supplyQ = Math.min(1, items.length / 10) * (stale ? 0.5 : 1);
    gap = Math.max(0.1, Math.min(1, demandN / Math.max(0.15, supplyQ)));
    gapType = stale ? "stale"
      : (velocity != null && velocity >= 0.7 && items.length <= 3) ? "emerging"
      : (questions >= items.length * 3) ? "unanswered"
      : (items.length <= 1) ? "thin" : "unanswered";
  }
  return { velocity, gap, gapType, demand: questions, supply: items.length, topAgeDays: topAge, live: haveSignal };
}

// ---- Contradiction & Evidence — validate an idea against the research --------
// Runs the raydar-contradiction pipeline (gated by key). Returns {evidence[],
// contradictions[]} or null (mock → generation keeps its heuristic flag).
async function validateIdea(s, research) {
  if (!research) return null;
  try {
    // provider/model come from the raydar-contradiction pipeline config (swappable in Admin)
    const out = await runPipeline("raydar-contradiction", {
      system: "Validate the content idea against the research. Return STRICT JSON {\"evidence\":[{\"claim\":\"...\",\"source\":\"url\"}],\"contradictions\":[{\"claim\":\"...\",\"conflict\":\"what the belief is\"}]}. Only cite what the research supports; never assert independently.",
      user: `Idea: ${s.heading}\nSummary: ${s.summary}\nTake: ${JSON.stringify(s.topic_guide || {}).slice(0, 600)}\nResearch: ${JSON.stringify(research).slice(0, 2500)}`,
      maxTokens: 800,
    });
    if (out.mode === "ai" && out.text) return jsonFrom(out.text);
  } catch { /* no validation → no contradiction claim */ }
  return null;
}

// ---- Fact-check (Stage 6b): query Google Fact Check Tools for the idea's claim.
// Returns published claim-reviews (publisher + rating + url) or null (unkeyed).
const DISPUTE_RE = /false|misleading|incorrect|inaccurate|no evidence|unproven|unsupported|pants on fire|distort|debunk|mostly false|not true/i;
async function factCheckIdea(s) {
  if (!enabled("factcheck")) return null;
  const key = getIntegrationKey("factcheck"); if (!key) return null;
  const rule = await getRule("factcheck"); const lang = rule.collection?.languageCode || "en";
  const query = String(s.heading || s.summary || "").slice(0, 200);
  try {
    const r = await timeout(fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(query)}&languageCode=${lang}&pageSize=5&key=${encodeURIComponent(key)}`));
    const j = await r.json();
    const reviews = (j.claims || []).flatMap((c) => (c.claimReview || []).map((cr) => ({ claim: c.text, rating: cr.textualRating || "", publisher: cr.publisher?.name || cr.publisher?.site || "", url: cr.url || "" }))).filter((x) => x.rating);
    return { checked: query, count: reviews.length, reviews: reviews.slice(0, 4) };
  } catch { return null; }
}
// Confidence score (0–100) that an idea's claim holds up: grounded in evidence/
// sources, penalised for flagged contradictions + any published fact-check disputes.
function scoreFactCheck(s, srcRefs, research, fc) {
  let score = 60; const why = [];
  if (s.evidence && String(s.evidence).trim()) { score += 12; why.push("cited evidence"); }
  if (srcRefs.length) { score += Math.min(18, srcRefs.length * 4); why.push(`${srcRefs.length} source${srcRefs.length === 1 ? "" : "s"} linked`); }
  if (research && (research.refs || []).length) score += 8;
  if (s.contradiction) { score -= 25; why.push("flags a contested belief"); }
  const disputed = (fc?.reviews || []).filter((r) => DISPUTE_RE.test(r.rating));
  if (fc && fc.count) {
    if (disputed.length) { score -= 35; why.push(`${disputed.length} fact-check dispute${disputed.length === 1 ? "" : "s"} found`); }
    else { score += 12; why.push("no fact-check disputes"); }
  } else if (fc) { why.push("no matching fact-checks"); }
  else if (!enabled("factcheck")) { why.push("fact-check not keyed"); }
  score = Math.max(5, Math.min(98, Math.round(score)));
  const label = score >= 80 ? "well-grounded" : score >= 60 ? "plausible" : score >= 40 ? "check" : "disputed";
  return { score, label, why: why.join(" · "), reviews: fc?.reviews || [] };
}

// ---- Classify (Stage 2): tag each source's items with THAT integration's -----
// business-rule prompt + model + gate. This is how every collected call is
// channelled through the editable prompts. No-op in mock mode (empty feed).
async function classifyFeed(items) {
  const bySrc = {};
  for (const it of (items || [])) (bySrc[it.source] ||= []).push(it);
  for (const [src, arr] of Object.entries(bySrc)) {
    const rule = await getRule(src);
    if (rule.enabled === false || !arr.length) continue;              // gate
    const [prov, mdl] = (rule.model || "").includes("::") ? rule.model.split("::") : [undefined, undefined];
    try {
      const payload = JSON.stringify(arr.map((x, i) => ({ i, title: x.title, body: (x.body || "").slice(0, 300) }))).slice(0, 6000);
      const out = await runPipeline("raydar-classify", {
        system: `${rule.prompt}\nReturn STRICT JSON {"items":[{"i":<index>,"topic":"1..6|Emerging","franchise":"...","registers":{"FOMO":0-1,"Anxiety":0-1,"Optimism":0-1,"Ambition":0-1},"question":"..."}]}.`,
        user: payload, provider: prov, model: mdl, maxTokens: 1500,
      });
      if (out.mode === "ai" && out.text) {
        const tags = jsonFrom(out.text);
        for (const t of (Array.isArray(tags?.items) ? tags.items : [])) if (arr[t.i]) arr[t.i].tags = t;
      }
    } catch { /* best-effort; generation still runs on raw items */ }
  }
  return items;
}

// ---- Research / validation — query ALL enabled research sources, combine ----
// Every call reads its own business rule (query params + prompt + model) — no
// hardcoded models/queries. Each ref is tagged with its source for attribution.
async function researchTopic(topic) {
  const runs = [];
  const key = (id) => getIntegrationKey(id);
  if (enabled("tavily")) runs.push((async () => { const c = (await getRule("tavily")).collection || {}; const r = await timeout(fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key("tavily"), query: topic, max_results: c.max_results || 5, search_depth: c.search_depth || "basic", include_answer: c.include_answer !== false }) })); const j = await r.json(); return { source: "tavily", answer: j.answer, refs: (j.results || []).map((x) => ({ title: x.title, url: x.url, source: "tavily" })) }; })());
  if (enabled("serper")) runs.push((async () => { const c = (await getRule("serper")).collection || {}; const r = await timeout(fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key("serper"), "content-type": "application/json" }, body: JSON.stringify({ q: topic, gl: c.gl || "in", hl: c.hl || "en" }) })); const j = await r.json(); return { source: "serper", answer: j.answerBox?.answer || j.knowledgeGraph?.description || "", refs: (j.organic || []).slice(0, c.num || 5).map((x) => ({ title: x.title, url: x.link, source: "serper" })) }; })());
  if (enabled("perplexity")) runs.push((async () => { const rule = await getRule("perplexity"); const c = rule.collection || {}; const r = await timeout(fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key("perplexity")}`, "content-type": "application/json" }, body: JSON.stringify({ model: c.model || "sonar", messages: [{ role: "user", content: `${rule.prompt || "Research + cite sources."}\nTopic: ${topic}` }], max_tokens: c.max_tokens || 500 }) })); const j = await r.json(); return { source: "perplexity", answer: j.choices?.[0]?.message?.content, refs: (j.citations || []).map((u) => ({ title: String(u), url: String(u), source: "perplexity" })) }; })());
  if (enabled("exa")) runs.push((async () => { const c = (await getRule("exa")).collection || {}; const r = await timeout(fetch("https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": key("exa"), "content-type": "application/json" }, body: JSON.stringify({ query: topic, numResults: c.numResults || 5, useAutoprompt: c.useAutoprompt !== false }) })); const j = await r.json(); return { source: "exa", answer: "", refs: (j.results || []).map((x) => ({ title: x.title, url: x.url, source: "exa" })) }; })());
  if (enabled("brave")) runs.push((async () => { const c = (await getRule("brave")).collection || {}; const r = await timeout(fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(topic)}&count=${c.count || 5}&country=${c.country || "in"}`, { headers: { "X-Subscription-Token": key("brave") } })); const j = await r.json(); return { source: "brave", answer: j.web?.results?.[0]?.description || "", refs: (j.web?.results || []).slice(0, 5).map((x) => ({ title: x.title, url: x.url, source: "brave" })) }; })());
  if (!runs.length) return null;
  const out = { answer: "", refs: [], sources: [] };
  for (const s of await Promise.allSettled(runs)) if (s.status === "fulfilled" && s.value) { if (s.value.answer && !out.answer) out.answer = s.value.answer; out.refs.push(...(s.value.refs || [])); if (s.value.refs?.length || s.value.answer) out.sources.push(s.value.source); }
  return (out.refs.length || out.answer) ? out : null;
}
async function ai(pipeline, system, user, maxTokens = 1200) {
  try { const out = await runPipeline(pipeline, { system, user, maxTokens }); if (out.mode === "ai" && out.text) return { j: jsonFrom(out.text), model: out.model }; } catch { /* */ }
  return { j: null, model: null };
}

// ---- mock candidates (stand in for Talent500) ------------------------------
const MOCK = [
  { ext_id: "t500-1", name: "Asha Menon", meta: { domain: "Data Engineering", years_exp: 8, location: "Bengaluru", tenure: [3, 2, 3] } },
  { ext_id: "t500-2", name: "Rohan Gupta", meta: { domain: "Product Management", years_exp: 6, location: "Gurgaon", tenure: [1.5, 1, 1.5, 2] } },
  { ext_id: "t500-3", name: "Priya Nair", meta: { domain: "Cloud / DevOps", years_exp: 10, location: "Hyderabad", tenure: [5, 5] } },
  { ext_id: "t500-4", name: "Vikram Rao", meta: { domain: "Cybersecurity", years_exp: 4, location: "Pune", tenure: [1, 1.5, 1.5] } },
  { ext_id: "t500-5", name: "Sneha Iyer", meta: { domain: "AI / ML", years_exp: 5, location: "Bengaluru", tenure: [2, 1.5, 1.5] } },
  { ext_id: "t500-6", name: "Arjun Shah", meta: { domain: "Finance / GCC Ops", years_exp: 12, location: "Mumbai", tenure: [6, 6] } },
  { ext_id: "t500-7", name: "Neha Kapoor", meta: { domain: "UX Design", years_exp: 7, location: "Bengaluru", tenure: [2, 2, 3] } },
  { ext_id: "t500-8", name: "Karthik Reddy", meta: { domain: "Data Engineering", years_exp: 3, location: "Chennai", tenure: [1, 1, 1] } },
  { ext_id: "t500-9", name: "Divya Menon", meta: { domain: "Product Management", years_exp: 9, location: "Hyderabad", tenure: [4, 5] } },
  { ext_id: "t500-10", name: "Sameer Khan", meta: { domain: "AI / ML", years_exp: 6, location: "Gurgaon", tenure: [1.5, 2, 2] } },
];
const maxTenure = (m) => Math.max(0, ...((m.tenure) || [0]));

// deterministic mock ClientMind chips from meta (used when no AI key)
function mockChips(m) {
  const chips = [
    { kind: "domain", value: m.domain, weight: 1 },
    { kind: "career_pattern", value: maxTenure(m) < 2 ? "frequent mover (<2y tenure)" : "long-tenure / loyal", weight: .9 },
    { kind: "skill", value: m.domain.split(/[\/ ]/)[0], weight: .8 },
    { kind: "aspiration", value: m.years_exp >= 8 ? "leadership / architect track" : "senior IC growth", weight: .7 },
    { kind: "motivation", value: maxTenure(m) < 2 ? "faster growth + variety" : "stability + depth", weight: .7 },
    { kind: "interest", value: "GCC opportunities in " + m.location, weight: .6 },
  ];
  return chips;
}

export function mountWhisperer(app, slug) {
  const wq = (t, p) => q(t, p).catch(() => ({ rows: [] }));

  // seed mock candidates + a ClientMind for each
  app.post("/api/wh/seed", async (_req, res) => {
    for (const c of MOCK) {
      await wq(`insert into wh_candidate(ext_id,name,meta,source) values($1,$2,$3::jsonb,'mock') on conflict(ext_id) do update set name=excluded.name, meta=excluded.meta, updated_at=now()`, [c.ext_id, c.name, JSON.stringify(c.meta)]);
    }
    res.json({ ok: true, seeded: MOCK.length });
  });

  app.get("/api/wh/candidates", async (_req, res) => {
    const r = await wq(`select c.id, c.ext_id, c.name, c.meta, (cm.candidate_id is not null) as has_mind, coalesce(jsonb_array_length(cm.chips),0) as chips
                        from wh_candidate c left join wh_client_mind cm on cm.candidate_id=c.id order by c.id`);
    res.json({ candidates: r.rows });
  });

  // build ClientMind for ALL (weekly-refresh proxy) — MUST precede :id route
  app.post("/api/wh/clientmind/refresh-all", async (_req, res) => {
    const ids = (await wq(`select id from wh_candidate`)).rows.map((r) => r.id);
    let n = 0;
    for (const id of ids) {
      const c = (await wq(`select * from wh_candidate where id=$1`, [id])).rows[0]; if (!c) continue;
      const chips = mockChips(c.meta || {});
      const master = `# ${c.name}\n- Domain: ${c.meta?.domain}\n- ${c.meta?.years_exp}y · ${c.meta?.location}`;
      await wq(`insert into wh_client_mind(candidate_id,master_md,chips,model,refreshed_at) values($1,$2,$3::jsonb,'mock',now()) on conflict(candidate_id) do update set chips=excluded.chips, refreshed_at=now()`, [id, master, JSON.stringify(chips)]);
      n++;
    }
    res.json({ ok: true, refreshed: n });
  });

  // ClientMind for one candidate (AI parse → chips; mock fallback)
  app.post("/api/wh/clientmind/:id", async (req, res) => {
    const id = Number(req.params.id);
    const c = (await wq(`select * from wh_candidate where id=$1`, [id])).rows?.[0];
    if (!c) return res.status(404).json({ error: "candidate not found" });
    const docs = (await wq(`select doc_type, coalesce(md, raw, '') as body from wh_candidate_doc where candidate_id=$1`, [id])).rows || [];
    const { j, model } = await ai("clientmind-parse", "Parse this candidate.", `Candidate: ${c.name}\nMeta: ${JSON.stringify(c.meta)}\nDocuments: ${JSON.stringify(docs).slice(0, 40000)}`);
    const chips = j?.chips?.length ? j.chips : mockChips(c.meta || {});
    const master = j?.master_md || `# ${c.name}\n- Domain: ${c.meta?.domain}\n- Experience: ${c.meta?.years_exp}y · ${c.meta?.location}\n- Tenure pattern: ${(c.meta?.tenure || []).join(", ")}y (max ${maxTenure(c.meta || {})}y)`;
    await wq(`insert into wh_client_mind(candidate_id,master_md,chips,model,refreshed_at) values($1,$2,$3::jsonb,$4,now())
              on conflict(candidate_id) do update set master_md=excluded.master_md, chips=excluded.chips, model=excluded.model, refreshed_at=now()`, [id, master, JSON.stringify(chips), model || "mock"]);
    res.json({ ok: true, candidate: c.name, chips, master_md: master, ai: !!j });
  });

  // ---- cohorts (filters + NL query) ----------------------------------------
  app.get("/api/wh/cohorts", async (_req, res) => res.json({ cohorts: (await wq(`select id,name,nl_query,array_length(member_ids,1) as members, (hunger_story is not null) as has_hunger, created_at from wh_cohort order by id desc`)).rows }));

  app.post("/api/wh/cohort", async (req, res) => {
    const { name, nl_query, domain } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const cands = (await wq(`select id, name, meta from wh_candidate`)).rows || [];
    // NL query (AI → rules; mock: understand a couple of common intents)
    const { j } = await ai("cohort-nl-query", "Convert to filter.", nl_query || "");
    const matches = (c) => {
      const m = c.meta || {};
      if (domain && domain !== "any" && m.domain !== domain) return false;
      const nq = (nl_query || "").toLowerCase();
      if (/2\s*year|two year|never stayed|job hopper|frequent/.test(nq) && !(maxTenure(m) < 2)) return false;
      if (/senior|8\+|lead|architect/.test(nq) && !((m.years_exp || 0) >= 8)) return false;
      // AI rules (best-effort)
      for (const r of j?.rules || []) {
        if (r.field === "meta.years_exp" && r.op && r.value != null) {
          const v = m.years_exp || 0; if (r.op === ">" && !(v > r.value)) return false; if (r.op === "<" && !(v < r.value)) return false; if (r.op === ">=" && !(v >= r.value)) return false;
        }
      }
      return true;
    };
    const members = cands.filter(matches).map((c) => c.id);
    const r = await wq(`insert into wh_cohort(name,nl_query,filter_def,member_ids) values($1,$2,$3::jsonb,$4) returning id`, [name, nl_query || "", JSON.stringify({ domain: domain || "any" }), members]);
    res.json({ ok: true, id: r.rows?.[0]?.id, members: members.length, member_ids: members });
  });

  // Batch = the demand seed (Hunger step). Combine routes: trend topics + SEO +
  // (optionally) a TalentMind-simulation cohort. Saved with name + timestamp.
  app.post("/api/wh/batch", async (req, res) => {
    const { name, trend_topics, talentmind_cohort_id, seo, prompt } = req.body || {};
    const nm = name || `Batch ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const extra = (prompt || "").trim();
    const routes = { trend: !!(trend_topics || []).length, seo: !!seo, talentmind: !!talentmind_cohort_id, prompt: !!extra };
    let cohortId = null, hunger = null, topics = [], source = "trend";
    if (talentmind_cohort_id) {                          // reuse the simulation cohort (has its hunger)
      cohortId = Number(talentmind_cohort_id); source = "talentmind";
      const co = (await wq(`select * from wh_cohort where id=$1`, [cohortId])).rows?.[0];
      hunger = co?.hunger_story || {}; topics = hunger.demand_topics || [];
      await wq(`update wh_cohort set name=$2 where id=$1`, [cohortId, nm]).catch(() => {});
    } else {
      topics = (trend_topics || []).length ? trend_topics : (await wq(`select name from wh_demand_topic where active and name<>'Emerging' order by id`)).rows.map((r) => r.name);
      source = routes.trend && routes.seo ? "mixed" : routes.seo ? "seo" : "trend";
      hunger = { who: `Batch seeded from ${[routes.trend ? "Trend Spotting" : "", routes.seo ? "SEO inputs" : ""].filter(Boolean).join(" + ") || "all topics"}.`, demand_topics: topics, cares_about: topics.slice(0, 4), motivations: ["growth"], routes };
    }
    if (extra) hunger.extra_prompt = extra;              // the user's free-text sweep brief (context + feed query)
    const b = await wq(`insert into wh_batch(name,source,routes,demand_topics,cohort_id,hunger,status) values($1,$2,$3::jsonb,$4,$5,$6::jsonb,'draft') returning id`,
      [nm, source, JSON.stringify(routes), topics, cohortId, JSON.stringify(hunger)]);
    res.json({ ok: true, id: b.rows?.[0]?.id, name: nm });
  });
  // list saved batches (history)
  app.get("/api/wh/batches", async (_req, res) => res.json({ batches: (await wq(`select id,name,source,routes,demand_topics,status,story_count,created_at,swept_at from wh_batch order by id desc`)).rows }));

  // ---- Hunger (Hunt Outcome) ------------------------------------------------
  app.post("/api/wh/hunger/:cohortId", async (req, res) => {
    const id = Number(req.params.cohortId);
    const co = (await wq(`select * from wh_cohort where id=$1`, [id])).rows?.[0];
    if (!co) return res.status(404).json({ error: "cohort not found" });
    const chips = (await wq(`select cm.chips from wh_client_mind cm where cm.candidate_id = any($1)`, [co.member_ids || []])).rows.flatMap((r) => r.chips || []);
    const agg = {}; for (const ch of chips) agg[ch.value] = (agg[ch.value] || 0) + (ch.weight || .5);
    const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v]) => v);
    const { j, model } = await ai("hunger-generate", "Write the Hunt Outcome.", `Cohort: ${co.name} (${(co.member_ids || []).length} people). NL: ${co.nl_query}. Top chips: ${JSON.stringify(top)}`);
    const hunger = j || {
      who: `A ${(co.member_ids || []).length}-strong cohort — ${co.nl_query || co.name}.`,
      cares_about: top.slice(0, 4), likely_searches: ["how to switch domains", "GCC salary bands", "is job-hopping bad"],
      motivations: ["faster growth", "variety", "recognition"], emotional_drivers: ["ambition", "impatience", "fear of stagnation"],
      demand_topics: ["Career growth in GCCs", "Switching domains", "Salary benchmarking"],
    };
    await wq(`update wh_cohort set hunger_story=$2::jsonb where id=$1`, [id, JSON.stringify(hunger)]);
    res.json({ ok: true, hunger, ai: !!j, model });
  });

  app.post("/api/wh/hunger/:cohortId/save", async (req, res) => { await wq(`update wh_cohort set hunger_story=$2::jsonb where id=$1`, [Number(req.params.cohortId), JSON.stringify(req.body?.hunger || {})]); res.json({ ok: true }); });

  // ---- Feed Stories (Stage 3 gap → 4 ideate → 5 rank) ----------------------
  const ANGLES = ["core", "contrarian", "insider-data"];

  app.post("/api/wh/feedstories/:batchId", async (req, res) => {
    const bid = Number(req.params.batchId);
    const batch = (await wq(`select * from wh_batch where id=$1`, [bid])).rows?.[0];
    if (!batch) return res.status(404).json({ error: "batch not found" });
    const hunger = batch.hunger || {}; const cohortId = batch.cohort_id;
    // scoring weights + gap map from the editable business rule
    const sc = (await getRule("scoring")).collection || {};
    const guard = await getRule("guardrails");                  // audience · language · region (editable)
    const guardPrompt = guard.enabled === false ? "" : (guard.prompt || "");
    const W = sc.weights || { gap: 0.35, velocity: 0.25, strategic: 0.20, historical: 0.20 };
    const GAPMAP = sc.gap_map || {};
    // the approved 6 demand topics + franchise routing (skip Emerging for generation)
    let topicRows = (await wq(`select name, franchise, format_home, strategic_weight, question, terms from wh_demand_topic where active and name<>'Emerging' order by id`)).rows;
    // restrict to the batch's chosen demand topics when set
    const chosen = (batch.demand_topics && batch.demand_topics.length) ? batch.demand_topics : (hunger.demand_topics || []);
    if (chosen.length) { const sel = topicRows.filter((t) => chosen.includes(t.name)); if (sel.length) topicRows = sel; }
    const regs = (await wq(`select name from wh_emotional_register where active`)).rows.map((r) => r.name);
    const oneups = ["Contrarian take", "Insider data", "Do-this-now"];
    // historical acceptance per franchise (feedback loop → ranking)
    const hist = {}; for (const r of (await wq(`select franchise, count(*) filter(where feedback='used') u, count(*) filter(where feedback is not null) t from wh_feed_story group by franchise`)).rows) hist[r.franchise] = Number(r.t) ? Number(r.u) / Number(r.t) : 0;

    const extra = (hunger.extra_prompt || "").trim();    // the user's free-text sweep brief
    const feedTopics = topicRows.map((t) => ({ name: t.name, terms: t.terms }));
    if (extra) feedTopics.push({ name: "__extra__", terms: [extra] });   // also search the user's prompt
    const feed = await collectFeed(feedTopics).catch(() => []);
    await classifyFeed(feed).catch(() => {});            // Stage 2 — channel through each source's rule prompt
    await wq(`update wh_batch set feed_signal=$2::jsonb where id=$1`, [bid, JSON.stringify(rankFeedSignal(feed))]).catch(() => {}); // results-page "top videos" snapshot
    const made = [];
    for (const t of topicRows) {
      const research = await researchTopic(extra ? `${t.name} — ${extra}` : t.name).catch(() => null);
      const items = feed.filter((f) => f.topic === t.name || f.topic === "__extra__" || (f.title || "").toLowerCase().includes(t.name.split(" ")[0].toLowerCase())).slice(0, 5);
      const sig = topicSignals(items, GAPMAP[t.name]);          // Stage 3 — real demand/supply/velocity when live
      const velocity = sig.velocity != null ? sig.velocity : Math.min(1, 0.4 + items.length * 0.1);
      const strategic = Math.min(1, (Number(t.strategic_weight) || 1) / 1.5);
      const franchiseHist = hist[t.franchise] || 0;
      const gap = sig.gap;
      for (let a = 0; a < 3; a++) {                       // 3 ideas / topic → ~18 total
        const grounding = (items.length || research) ? `\nReal feed: ${JSON.stringify(items.map((x) => ({ src: x.source, title: x.title, url: x.url, tags: x.tags })))}\nResearch: ${JSON.stringify(research || {}).slice(0, 2000)}` : "";
        const contra = a === 1;
        const { j } = await ai("feedstory-generate", `${guardPrompt ? guardPrompt + "\n\n" : ""}Create ONE content idea (heading + topic guide brief only — NOT finished copy) for the '${t.franchise}' franchise. Angle: ${ANGLES[a]}. ${contra ? "This is a CONTRADICTION idea — push against a popular but wrong belief; state the belief. " : ""}Ground it in the real feed + research when given; evidence must be specific.`, `Demand topic: ${t.name} (underlying question: ${t.question})\nFranchise: ${t.franchise} · format: ${t.format_home}\nCohort: ${JSON.stringify(hunger).slice(0, 1200)}${extra ? `\nUser's extra brief for this sweep (weight it heavily): ${extra}` : ""}\nPick 1-up from ${JSON.stringify(oneups)}, register from ${JSON.stringify(regs)}.${grounding}`);
        // LLM-only — no dummy fallback. If the model didn't return a usable idea, skip it.
        if (!j || !j.heading) continue;
        const s = j;
        s.topic_guide = s.topic_guide || {};
        if (s.title && String(s.title).trim()) s.topic_guide.title = String(s.title).trim();
        s.platform = s.platform || t.format_home;
        s.emotional_register = s.emotional_register || regs[a % regs.length] || "";
        s.one_up = s.one_up || oneups[a % oneups.length];
        s.contradiction = !!s.contradiction;
        s.contradiction_of = s.contradiction ? (s.contradiction_of || null) : null;
        // No TalentMind cohort on this batch → don't fabricate a cohort reason (nil).
        if (!cohortId) s.why_cohort = null;
        const srcRefs = [...items.map((x) => ({ title: x.title, url: x.url, source: x.source })), ...((research?.refs) || [])].slice(0, 8);
        // Contradiction & Evidence — validate this idea against the research (real when keyed)
        const val = await validateIdea(s, research).catch(() => null);
        if (val) {
          if (Array.isArray(val.contradictions) && val.contradictions.length) { s.contradiction = true; s.contradiction_of = val.contradictions[0].conflict || val.contradictions[0].claim || s.contradiction_of; }
          if (Array.isArray(val.evidence) && val.evidence.length) s.evidence = val.evidence.map((e) => e.claim).filter(Boolean).join("; ").slice(0, 300) || s.evidence;
        }
        const fc = await factCheckIdea(s).catch(() => null);   // Stage 6b — published fact-checks (real when keyed)
        const fact_check = scoreFactCheck(s, srcRefs, research, fc);
        const score = Math.round((W.gap * gap + W.velocity * velocity + W.strategic * strategic + W.historical * franchiseHist) * 1000) / 1000;
        const sources = [...new Set([...srcRefs.map((r) => r.source), ...((research && research.sources) || [])])].filter(Boolean);
        const breakdown = { gap: Math.round(gap * 100) / 100, velocity: Math.round(velocity * 100) / 100, strategic: Math.round(strategic * 100) / 100, historical: Math.round(franchiseHist * 100) / 100, weights: W, demand: sig.demand, supply: sig.supply, live: sig.live, sources, fact_check };
        const gapType = s.contradiction ? "wrong" : (sig.gapType || (velocity >= 0.8 ? "emerging" : gap >= 0.8 ? "unanswered" : items.length <= 1 ? "thin" : "stale"));
        const r = await wq(`insert into wh_feed_story(batch_id,cohort_id,demand_topic,franchise,platform,one_up,emotional_register,heading,topic_guide,summary,why_now,why_relevant,why_cohort,evidence,contradiction,contradiction_of,source_refs,score,score_breakdown,angle,gap_type,in_library,status)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb,$20,$21,true,'draft') returning id`,
          [bid, cohortId, t.name, t.franchise, s.platform || t.format_home, s.one_up, s.emotional_register, s.heading, JSON.stringify(s.topic_guide || {}), s.summary, s.why_now, s.why_relevant, s.why_cohort, s.evidence || "", !!s.contradiction, s.contradiction_of || null, JSON.stringify(srcRefs), score, JSON.stringify(breakdown), ANGLES[a], gapType]);
        made.push(r.rows?.[0]?.id);
      }
    }
    await wq(`update wh_batch set story_count=$2, status='swept', swept_at=now() where id=$1`, [bid, made.length]);
    res.json({ ok: true, made: made.length });
  });

  // the results-page "top videos that scored high" block — ranked feed snapshot for this sweep
  app.get("/api/wh/feed/:batchId", async (req, res) => {
    const b = (await wq(`select feed_signal from wh_batch where id=$1`, [Number(req.params.batchId)])).rows?.[0];
    res.json({ feed: b?.feed_signal || [] });
  });

  app.get("/api/wh/feedstories/:batchId", async (req, res) => {
    const fr = req.query.franchise; const args = [Number(req.params.batchId)];
    let sql = `select * from wh_feed_story where batch_id=$1 and status<>'deleted'`;
    if (fr && fr !== "all") { sql += ` and franchise=$2`; args.push(fr); }
    sql += ` order by score desc nulls last, id desc`;   // ranked
    res.json({ stories: (await wq(sql, args)).rows });
  });

  // ---- Library: every generated story across all batches -------------------
  app.get("/api/wh/library", async (req, res) => {
    const { franchise, feedback, batch } = req.query; const args = []; const w = ["s.status<>'deleted'", "s.in_library"];
    if (franchise && franchise !== "all") { args.push(franchise); w.push(`s.franchise=$${args.length}`); }
    if (feedback && feedback !== "all") { args.push(feedback); w.push(`s.feedback=$${args.length}`); }
    if (batch) { args.push(Number(batch)); w.push(`s.batch_id=$${args.length}`); }
    const sql = `select s.*, b.name as batch_name from wh_feed_story s left join wh_batch b on b.id=s.batch_id where ${w.join(" and ")} order by s.score desc nulls last, s.id desc limit 300`;
    res.json({ stories: (await wq(sql, args)).rows });
  });

  // which sources are live (enabled + keyed) → the journey shows real vs mock
  app.get("/api/wh/feed/status", (_req, res) => {
    let ig = {}; try { ig = publicIntegrations(); } catch { /* */ }
    const live = (ids) => ids.filter((id) => ig[id]?.enabled && ig[id]?.hasKey);
    const feed = live(["youtube", "reddit", "newsapi", "serpapi"]);
    const research = live(["tavily", "serper", "perplexity", "exa", "brave"]);
    res.json({ feed, research, live: feed.length > 0 || research.length > 0, mock: feed.length === 0 && research.length === 0 });
  });
  // manual feed collection (scheduler proxy)
  app.post("/api/wh/feed/collect", async (req, res) => {
    const topics = req.body?.topics?.length ? req.body.topics : (await wq(`select name from wh_demand_topic where active order by id limit 3`)).rows.map((r) => r.name);
    const items = await collectFeed(topics).catch(() => []);
    res.json({ ok: true, collected: items.length, sources: [...new Set(items.map((i) => i.source))] });
  });

  // Review CRUD — Used / Rejected / Saved (+ rejection reason) + edit + delete.
  // The feedback drives ranking (historical acceptance per franchise).
  app.post("/api/wh/feedstory/:id/action", async (req, res) => {
    const id = Number(req.params.id), a = req.body?.action;
    if (a === "used") await wq(`update wh_feed_story set feedback='used', status='approved' where id=$1`, [id]);
    else if (a === "rejected") await wq(`update wh_feed_story set feedback='rejected', reject_reason=$2 where id=$1`, [id, req.body?.reason || null]);
    else if (a === "saved") await wq(`update wh_feed_story set feedback='saved', status='banked' where id=$1`, [id]);
    else if (a === "clear") await wq(`update wh_feed_story set feedback=null, reject_reason=null, status='draft' where id=$1`, [id]);
    else if (a === "select") await wq(`update wh_feed_story set selected = not selected where id=$1`, [id]);
    else if (a === "delete") await wq(`update wh_feed_story set status='deleted' where id=$1`, [id]);
    else if (a === "edit") await wq(`update wh_feed_story set heading=coalesce($2,heading), summary=coalesce($3,summary), topic_guide=coalesce($4::jsonb,topic_guide) where id=$1`, [id, req.body?.heading ?? null, req.body?.summary ?? null, req.body?.topic_guide ? JSON.stringify(req.body.topic_guide) : null]);
    res.json({ ok: true });
  });

  // ---- settings: properties (demand topics, 1-ups, frameworks, registers) ---
  const PROP = { "demand-topics": "wh_demand_topic", "one-ups": "wh_one_up", "frameworks": "wh_emotional_framework", "registers": "wh_emotional_register" };
  app.get("/api/wh/props/:kind", async (req, res) => { const t = PROP[req.params.kind]; if (!t) return res.status(404).json({ error: "unknown" }); res.json({ items: (await wq(`select * from ${t} order by id`)).rows }); });
  app.post("/api/wh/props/:kind", async (req, res) => {
    const t = PROP[req.params.kind]; if (!t) return res.status(404).json({ error: "unknown" });
    const { name, definition } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" });
    const src = t === "wh_demand_topic" ? ", source" : ""; const srcv = t === "wh_demand_topic" ? ", 'admin'" : "";
    await wq(`insert into ${t}(name, definition${src}) values($1,$2${srcv}) on conflict(name) do update set definition=excluded.definition`, [name, definition || ""]);
    res.json({ ok: true });
  });

  // demand topics with franchise routing (for the initial journey + settings)
  app.get("/api/wh/topics", async (_req, res) => res.json({ topics: (await wq(`select id, name, question, franchise, format_home, strategic_weight, terms, notes, active from wh_demand_topic order by id`)).rows }));
  // create / update a Trend Spotting concept (+ its search terms)
  app.post("/api/wh/topic", async (req, res) => {
    const { name, question, franchise, format_home, strategic_weight, terms, old_name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const arr = Array.isArray(terms) ? terms : String(terms || "").split(",").map((t) => t.trim()).filter(Boolean);
    const key = old_name || name;
    const exists = (await wq(`select 1 from wh_demand_topic where name=$1`, [key])).rows.length;
    if (exists) await wq(`update wh_demand_topic set name=$2, question=coalesce($3,question), franchise=coalesce($4,franchise), format_home=coalesce($5,format_home), strategic_weight=coalesce($6,strategic_weight), terms=$7 where name=$1`,
      [key, name, question || null, franchise || null, format_home || null, strategic_weight != null ? Number(strategic_weight) : null, arr]);
    else await wq(`insert into wh_demand_topic(name, question, franchise, format_home, strategic_weight, terms, active) values($1,$2,$3,$4,$5,$6,true)`,
      [name, question || "", franchise || "Emerging", format_home || "", strategic_weight != null ? Number(strategic_weight) : 1, arr]);
    res.json({ ok: true });
  });
  app.post("/api/wh/topic/:name/delete", async (req, res) => { await wq(`delete from wh_demand_topic where name=$1 and name<>'Emerging'`, [req.params.name]); res.json({ ok: true }); });

  // 1Up franchises (routing targets) — config, editable
  app.get("/api/wh/franchises", async (_req, res) => res.json({ franchises: (await wq(`select * from wh_franchise order by id`)).rows }));
  app.post("/api/wh/franchise", async (req, res) => {
    const { name, stage, format_home, active } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" });
    await wq(`insert into wh_franchise(name,stage,format_home,active) values($1,$2,$3,coalesce($4,true)) on conflict(name) do update set stage=coalesce(excluded.stage,wh_franchise.stage), format_home=coalesce(excluded.format_home,wh_franchise.format_home), active=coalesce(excluded.active,wh_franchise.active)`, [name, stage || null, format_home || null, active]);
    res.json({ ok: true });
  });
  // set a topic's franchise routing
  app.post("/api/wh/topic/route", async (req, res) => { await wq(`update wh_demand_topic set franchise=$2, format_home=coalesce($3,format_home) where name=$1`, [req.body?.topic, req.body?.franchise, req.body?.format_home || null]); res.json({ ok: true }); });

  // Business rules per integration — collection params + prompt + model + gate.
  app.get("/api/wh/rules", async (_req, res) => {
    const saved = {}; for (const r of (await wq(`select name, rule from wh_business_rule`)).rows) saved[r.name] = r.rule;
    const out = {}; for (const id of Object.keys(RULE_DEFAULTS)) out[id] = mergeRule(id, saved[id]);
    res.json({ rules: out });
  });
  app.post("/api/wh/rules/:id", async (req, res) => {
    const id = req.params.id; if (!RULE_DEFAULTS[id]) return res.status(404).json({ error: "unknown integration" });
    const merged = mergeRule(id, req.body || {});
    await wq(`insert into wh_business_rule(name, rule) values($1,$2::jsonb) on conflict(name) do update set rule=excluded.rule`, [id, JSON.stringify(merged)]);
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('admin','raydar.rule','integration',$1,$2::jsonb)`, [id, JSON.stringify({ model: merged.model, enabled: merged.enabled })]).catch(() => {});
    res.json({ ok: true, rule: merged });
  });

  // SEO research workspace — a 2nd write source (paste keyword/GSC/competitor/trend research)
  app.get("/api/wh/seo", async (_req, res) => res.json({ inputs: (await wq(`select id, kind, content, created_at from wh_seo_input order by id desc limit 50`)).rows }));
  app.post("/api/wh/seo", async (req, res) => { const { kind, content } = req.body || {}; if (!content) return res.status(400).json({ error: "content required" }); await wq(`insert into wh_seo_input(kind, content) values($1,$2)`, [kind || "keywords", content]); res.json({ ok: true }); });
  app.post("/api/wh/seo/:id/delete", async (req, res) => { await wq(`delete from wh_seo_input where id=$1`, [Number(req.params.id)]); res.json({ ok: true }); });
}
