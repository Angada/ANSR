// Whisperer backend — Journey 1 (mock-first): candidates → ClientMind → cohort →
// Hunger → Feed Stories. Every AI step runs through a gated pipeline (runPipeline)
// with a deterministic MOCK fallback so the whole journey works with no key.
import { rmSync } from "node:fs";
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";
import { mountJobs, startJob, setItem, finishJob } from "./jobs.js";
import { extractFile } from "./extract.js";
import { getIntegrationKey, publicIntegrations } from "./store.js";

// SEO research (pasted or Excel/CSV) → real search phrases. Splits lines/table
// rows, keeps 2-6 word query-like phrases (drops urls, numbers, headers), dedupes.
// These become actual YouTube/Reddit queries so SEO genuinely steers the sweep.
const SEO_HEADER = /^(keyword|volume|kd|query|clicks|impressions|ctr|position|difficulty|search volume|cpc|intent|url|page|topic|cluster|competition|trend)s?$/i;
function extractSeoTerms(text) {
  const out = [];
  // consider EVERY cell (keyword sheets often have several keyword columns side by side)
  for (const line of String(text || "").split(/[\r\n]+/)) {
    for (const raw of line.split(/\t|,|\||;/)) {
      const c = raw.trim().replace(/^["']|["']$/g, "").trim();
      const words = c.split(/\s+/);
      if (words.length >= 2 && words.length <= 7 && c.length >= 5 && c.length <= 70 && /[a-z]/i.test(c) && !SEO_HEADER.test(c) && !/^[#>]/.test(c) && !/^https?:|^www\.|@/i.test(c) && !/^[\d.,%$₹\s]+$/.test(c)) out.push(c.toLowerCase());
    }
  }
  return [...new Set(out)].slice(0, 80);
}

const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
// ---- FEED HEALTH -----------------------------------------------------------
// A dead or out-of-quota key used to fail silently: the source returned nothing
// and the sweep looked identical to "nothing matched your search". Every source
// now records WHY it returned nothing, and that reason travels to the results.
let FEED_ERRORS = [];
const feedReset = () => { FEED_ERRORS = []; };
const feedNote = (source, reason, detail) => {
  if (FEED_ERRORS.some((e) => e.source === source && e.reason === reason)) return;
  FEED_ERRORS.push({ source, reason, detail: String(detail || "").slice(0, 160) });
};
// Read an HTTP response and, if the API is refusing us, say so in plain words.
// Returns true when the call is healthy.
async function feedOk(source, r) {
  if (!r) { feedNote(source, "no response", "the request timed out or failed"); return false; }
  if (r.ok) return true;
  const body = await r.text().catch(() => "");
  const reason = r.status === 401 || r.status === 403
      ? (/quota|exceeded|limit/i.test(body) ? "out of quota" : "key rejected")
    : r.status === 429 ? "rate limited"
    : `HTTP ${r.status}`;
  feedNote(source, reason, body.replace(/\s+/g, " ").slice(0, 160));
  return false;
}

const enabled = (id) => { try { return !!publicIntegrations()[id]?.enabled && !!getIntegrationKey(id); } catch { return false; } };
const timeout = (p, ms = 9000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);
// India time (IST) stamp — "31-07-2026 14:30" in Asia/Kolkata (server runs UTC on Cloud Run)
const istStamp = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {}); return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`; };

// ---- Business rules per integration (editable in Settings; "80% no code") ---
// Each: how we query it (collection) + the AI prompt + a model override
// (""=use the pipeline default) + a gate. Stored in wh_business_rule(name=id).
const RULE_DEFAULTS = {
  youtube:    { app: "RayDar", pipeline: "trend-detect", collection: { regionCode: "IN", relevanceLanguage: "en", publishedDays: 30, maxResults: 20, commentsTopVideos: 12, commentsPerVideo: 60,   // comments cost 1 quota unit vs a search 100 — depth here is nearly free
      // the YouTube FILTER — enforced deterministically at collection (drops shown with reasons, quota never spent on their comments)
      excludeShorts: true, minDurationSec: 20,   // anything shorter is a Short/meme — editable in Settings
      minViews: 500, minComments: 0, blockChannels: [],   // quality floors + a permanent channel block list
      memeMarkers: ["meme", "memes", "funny", "comedy", "roast", "troll", "prank", "shitpost", "pov:", "wait for it", "😂", "🤣"],
      hinglishGuard: true },
    prompt: "Classify each YouTube item → demand topic (1–6 / Emerging), 1Up franchise, 4-register distribution, and the underlying question. Comments carry the real feeling — weight them." },
  reddit:     { app: "RayDar", pipeline: "trend-detect", collection: { subreddits: ["developersIndia", "IndianWorkplace", "IndiaCareers", "cscareerquestions", "leetcode"], topPosts: 50, timeframe: "month", commentTrees: 10, commentsPerPost: 100 }, prompt: "Classify each Reddit post/comment → topic, franchise, registers, underlying question. Comment trees are the highest-value signal." },
  newsapi:    { app: "RayDar", pipeline: "trend-detect", collection: { language: "en", pageSize: 20, sortBy: "publishedAt" }, prompt: "Summarise each article's relevance to the demand topics." },
  serpapi:    { app: "RayDar", pipeline: "trend-detect", collection: { gl: "in", hl: "en", num: 5 }, prompt: "Extract trending headlines relevant to the demand topics." },
  tavily:     { app: "RayDar", pipeline: "feedstory-generate", collection: { max_results: 5, search_depth: "basic", include_answer: true }, prompt: "Use for VALIDATION — pull facts + cite source URLs. Flag claims that conflict with the feed." },
  serper:     { app: "RayDar", pipeline: "feedstory-generate", collection: { gl: "in", hl: "en", num: 5 }, prompt: "Use for grounding + validation; cite links." },
  perplexity: { app: "RayDar", pipeline: "feedstory-generate", collection: { model: "sonar", max_tokens: 500 }, prompt: "Research + validate with citations; India English context." },
};
// tag the above as integrations, add the rest of the catalog + journey + scoring rules
for (const k of Object.keys(RULE_DEFAULTS)) RULE_DEFAULTS[k].category = "integration";
Object.assign(RULE_DEFAULTS, {
  exa:       { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { numResults: 5, useAutoprompt: true }, prompt: "Neural search for validation — pull the most relevant sources + cite URLs." },
  brave:     { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { count: 5, country: "in", search_lang: "en" }, prompt: "Web search for grounding + validation; cite links." },
  factcheck: { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { languageCode: "en" }, prompt: "Check claims against published fact-checks; flag anything contradicted — never assert independently." },
  wikidata:  { app: "RayDar", category: "integration", pipeline: "raydar-contradiction", collection: { limit: 3 }, prompt: "Ground entities and definitions against Wikipedia / Wikidata." },
  // ---- journey steps (the Hunger routes) ----
  trend_spotting: { app: "RayDar", category: "journey", pipeline: "hunger-generate", collection: { topics: 6, include_emerging: true, max_topics_per_sweep: 25, max_terms_per_topic: 4, cache_hours: 24 }, prompt: "From the chosen demand topics, frame the cohort's hunger — what they search, watch and complain about — and return the demand topics to sweep." },
  seo_inputs:     { app: "RayDar", category: "journey", pipeline: "hunger-generate", collection: { max_inputs: 50 }, prompt: "Parse pasted SEO research (keywords / GSC / competitor gaps) → demand signals mapped to the 6 topics; extract the highest-intent queries." },
  talentmind:     { app: "RayDar", category: "journey", pipeline: "cohort-nl-query", collection: { tenure_max_years: 2, job_seekers_only: true }, prompt: "Job seekers only, under 2 years tenure per company. Parse each corpus into TalentMind chips, cohort them, read their hunger." },
  // ---- scoring (composite rank weights + gap map) ----
  scoring: { app: "RayDar", category: "scoring", pipeline: "raydar-rank",
    collection: { weights: { gap: 0.35, velocity: 0.25, strategic: 0.20, historical: 0.20 },
      gap_map: { "Keywords and resume": 0.9, "Salary negotiation": 0.85, "Using AI to get better jobs": 0.82, "Landing your dream job": 0.7, "Skills to get a new job": 0.6, "Which coding tool to use": 0.6, "Emerging": 0.75 } },
    prompt: "Composite rank = Σ(weight × signal). Signals: gap (demand ÷ supply quality), velocity (views ÷ days), strategic (topic weight), historical (Used acceptance per franchise)." },
  // ---- LEVERS — the relevance dials (user-editable; default matches the code) --
  relevance: { app: "RayDar", category: "relevance", pipeline: "raydar-classify",
    collection: {
      ai_relevance: true,       // drop items the model marks off-topic for the audience
      min_keywords: 2,          // fallback strictness when no AI verdict — ≥N distinct keywords (or a 2-word phrase)
      noise_filter: true,       // enable the sport/celebrity/gaming blocklist
      // hard-drop blocklist — these never appear in a genuine India-tech career story
      noise_terms: ["football", "soccer", "nfl", "nba", "mlb", "nhl", "ufc", "mma", "boxing", "boxer", "knockout", "cricket", "ipl", "fifa", "wwe", "wrestling",
        "formula 1", "grand prix", "verstappen", "perez", "hamilton", "red bull racing", "liverpool", "arsenal", "chelsea", "barcelona",
        "messi", "ronaldo", "ronaldinho", "neymar", "mbappe", "cristiano", "lebron", "cooper flag",
        "bollywood", "hollywood", "tollywood", "actor", "actress", "movie", "cinema", "trailer", "rapper", "eminem", "50 cent",
        "kardashian", "spider-man", "spiderman", "marvel", "bigg boss",
        "roblox", "minecraft", "fortnite", "valorant", "free fire", "pubg", "gameplay", "speedrun", "mother-in-law"],
    },
    prompt: "Judge RELEVANCE for an India-English tech / GCC professional audience: set on_topic=false for anything NOT about a working professional's job, career, hiring, pay, skills or workplace — e.g. sport, celebrity, gaming, movies, school-exam / medical / other-domain content, or generic motivation. Give a short why." },
  // ---- guardrails (from the Talent500 brief — prepended to every idea prompt) ----
  guardrails: { app: "RayDar", category: "guardrails", pipeline: "feedstory-generate",
    collection: {
      language: "English", region: "India", locale: "en-IN",
      languages: ["en"], // ENFORCED deterministically on the feed (not just the prompt): only these ISO codes survive; ["all"] disables the filter
      // THE MASTER THEME. An item must be about work at all. Keyword overlap
      // alone let a single word carry a match — "negotiate" pulled in Modi, the
      // Ukraine war and Pattaya bar prices. Nothing survives collection unless
      // it also mentions one of these. Empty list = filter off.
      domain_terms: ["job", "jobs", "career", "careers", "hiring", "hire", "recruit", "recruiter", "recruitment",
        "salary", "salaries", "ctc", "pay", "package", "appraisal", "hike", "promotion", "raise", "offer",
        "resume", "cv", "portfolio", "interview", "interviewer", "hr", "shortlist", "applicant", "application",
        "fresher", "graduate", "intern", "internship", "placement", "campus", "onboarding", "notice period",
        "employee", "employer", "workplace", "office", "corporate", "manager", "team lead", "colleague",
        "skill", "skills", "upskill", "upskilling", "reskill", "certification", "course", "learn", "training",
        "layoff", "layoffs", "fired", "resign", "resignation", "quit", "switch", "attrition", "bench",
        "gcc", "startup", "mnc", "faang", "tech", "developer", "engineer", "analyst", "designer", "product",
        "remote", "hybrid", "wfh", "work from home", "linkedin", "naukri", "referral", "profile"],
      audience: "Indian job seekers · GCC / tech talent", brand: "Talent500", currency: "INR",
      idiom: ["hike", "notice period", "CTC", "package", "service company", "product company", "fresher", "campus placement", "on-site", "bench"],
      out_of_scope: ["Hindi / regional-language content (v2)"],
      caveats: ["Reddit is a leading indicator, not a census", "velocity is directional, not precise"],
    },
    prompt: "GUARDRAILS (Talent500 brief):\n• Audience — Indian job seekers (GCC / tech talent). Write India English; use Indian workplace idiom (hike, notice period, CTC, package, service/product company, fresher, campus placement, on-site, bench). Use INR for money.\n• Voice — the whisperer posture: sound like you read the reader's mind before they spoke. Never hype, never generic. Be the only adult in the room. Do NOT replicate what's already out there — bring an original angle.\n• Output — a HEADING + topic-guide brief for a writer. NEVER finished copy.\n• Evidence must be specific (cite comment counts / sources), never vague.\n• Contradictions — you PROPOSE, you never ASSERT. Flag any 'this is wrong' for human verification; never assert independently.\n• Treat Reddit as a leading indicator (not a census) and velocity as directional (not precise).",
  },
});
const mergeRule = (id, r) => { const d = RULE_DEFAULTS[id] || {}; return { ...d, ...(r || {}), collection: { ...(d.collection || {}), ...((r || {}).collection || {}) } }; };
async function getRule(id) { try { const r = (await q(`select rule from wh_business_rule where name=$1`, [id])).rows?.[0]?.rule; return mergeRule(id, r); } catch { return mergeRule(id, null); } }

// ---- Feed collection (real when a source's key is enabled; else []) ---------
// YouTube: search → video stats (views + publishedAt) → top-N comments. The
// comments are the demand signal; views÷age is velocity. All params from the rule.
// ISO-8601 duration ("PT1M32S") → seconds
const durSecs = (d) => { const m = String(d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : null; };
// A YouTube search costs 100 quota units. Re-running the same term the same day
// buys nothing but spends the day's budget, so every search is cached by term
// and served from the cache until it ages out (default 24h, editable).
async function ytCacheGet(term, hours) {
  if (!(hours > 0)) return null;
  const r = await q(`select payload from wh_search_cache where source='youtube' and term=$1 and fetched_at > now() - ($2 || ' hours')::interval`, [term, hours]).catch(() => null);
  return r?.rows?.[0]?.payload || null;
}
const ytCachePut = (term, payload) =>
  q(`insert into wh_search_cache(source, term, payload, fetched_at) values('youtube',$1,$2::jsonb, now())
     on conflict (source, term) do update set payload=excluded.payload, fetched_at=now()`, [term, JSON.stringify(payload)]).catch(() => {});

async function fetchYouTube(topic) {
  const key = getIntegrationKey("youtube"); if (!key) return [];
  const c = (await getRule("youtube")).collection || {};
  const cacheHours = Number(((await getRule("trend_spotting")).collection || {}).cache_hours ?? 24);
  const cached = await ytCacheGet(topic, cacheHours);
  if (cached) { feedNote("youtube", "served from cache", `"${topic}" was searched within the last ${cacheHours}h — no quota spent`); return cached; }
  const publishedAfter = new Date(Date.now() - (c.publishedDays || 30) * 864e5).toISOString();
  const s = await timeout(fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${Math.min(c.maxResults || 20, 25)}&regionCode=${c.regionCode || "IN"}&relevanceLanguage=${c.relevanceLanguage || "en"}&order=${c.order || "viewCount"}&publishedAfter=${encodeURIComponent(publishedAfter)}&q=${encodeURIComponent(topic)}&key=${encodeURIComponent(key)}`));
  if (!(await feedOk("youtube", s))) return [];
  const sj = await s.json();
  const vids = (sj.items || []).map((i) => ({ id: i.id?.videoId, title: i.snippet?.title, body: i.snippet?.description, publishedAt: i.snippet?.publishedAt, channel: i.snippet?.channelTitle || "" })).filter((v) => v.id);
  if (!vids.length) return [];
  const stats = {};
  try {
    const st = await timeout(fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${vids.map((v) => v.id).join(",")}&key=${encodeURIComponent(key)}`));
    const stj = await st.json();
    for (const it of (stj.items || [])) stats[it.id] = { views: Number(it.statistics?.viewCount || 0), comments: Number(it.statistics?.commentCount || 0), publishedAt: it.snippet?.publishedAt,
      durationSec: durSecs(it.contentDetails?.duration), audioLang: (it.snippet?.defaultAudioLanguage || it.snippet?.defaultLanguage || "").toLowerCase() };
  } catch { /* stats optional */ }
  // ---- the YouTube FILTER (rule-driven, enforced in code — not prompt-only) ----
  // Shorts, memes and wrong-audio-language videos are tagged with a drop_reason:
  // they stay visible in the results' "dropped" list (auditable) but never ground
  // an idea, and no comment quota is spent on them.
  const markers = (Array.isArray(c.memeMarkers) ? c.memeMarkers : []).map((m) => String(m).toLowerCase()).filter(Boolean);
  const dropReason = (v) => {
    const st = stats[v.id] || {}; const title = String(v.title || "");
    if (c.excludeShorts !== false) {
      if (st.durationSec != null && st.durationSec < (c.minDurationSec || 90)) return `short (${st.durationSec}s)`;
      if (/#shorts?\b/i.test(title)) return "short (#shorts)";
    }
    const tl = title.toLowerCase();
    const meme = markers.find((m) => tl.includes(m));
    if (meme) return `meme/entertainment ("${meme}")`;
    // quality floors — a six-view video is noise however long it is
    if (c.minViews && st.views != null && st.views < c.minViews) return `too few views (${st.views})`;
    if (c.minComments && st.comments != null && st.comments < c.minComments) return `no discussion (${st.comments} comments)`;
    // channel block list — kill a spam channel permanently, in one line
    const ch = String(v.channel || "").toLowerCase();
    const blocked = (Array.isArray(c.blockChannels) ? c.blockChannels : []).map((x) => String(x).toLowerCase()).filter(Boolean)
      .find((b) => ch && ch.includes(b));
    if (blocked) return `blocked channel ("${blocked}")`;
    return null;
  };
  for (const v of vids) v.drop_reason = dropReason(v);
  const keptVids = vids.filter((v) => !v.drop_reason);
  const topN = Math.min(c.commentsTopVideos || 5, keptVids.length), perVid = c.commentsPerVideo || 20;
  const cmts = {};
  await Promise.allSettled(keptVids.slice(0, topN).map(async (v) => {
    try {
      const cr = await timeout(fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${v.id}&maxResults=${perVid}&order=relevance&key=${encodeURIComponent(key)}`));
      const cj = await cr.json(); cmts[v.id] = (cj.items || []).map((x) => x.snippet?.topLevelComment?.snippet?.textDisplay || "").filter(Boolean);
    } catch { /* comments optional */ }
  }));
  const now = Date.now();
  const items = vids.map((v) => {
    const st = stats[v.id] || {}; const pub = st.publishedAt || v.publishedAt;
    const ageDays = pub ? Math.max(1, Math.round((now - new Date(pub).getTime()) / 864e5)) : null;
    return { source: "youtube", external_id: v.id, title: v.title, url: `https://youtube.com/watch?v=${v.id}`, body: v.body, drop_reason: v.drop_reason || null,
      meta: { views: st.views || 0, ageDays, comments: cmts[v.id] || [], durationSec: st.durationSec ?? null, audioLang: st.audioLang || null } };
  });
  if (items.length) await ytCachePut(topic, items);   // 100 quota units banked
  return items;
}
// Reddit requires a unique, descriptive User-Agent (platform:appID:version) — generic
// ones like "Python/urllib" are heavily throttled. Set REDDIT_UA env to append your
// "(by /u/username)" contact for full compliance with the Data API rules.
const REDDIT_UA = process.env.REDDIT_UA || "web:in.thekettleblack.qansr-raydar:v1.0";
// Reddit: search posts → walk comment trees on the top-N. Comment trees are the
// highest-value demand signal; params (subreddits/topPosts/commentTrees) from the rule.
async function fetchReddit(topic) {
  const pair = getIntegrationKey("reddit"); if (!pair || !pair.includes(":")) return [];
  const [cid, secret] = pair.split(":");
  const tok = await timeout(fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${cid}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded", "user-agent": REDDIT_UA }, body: "grant_type=client_credentials" }));
  const tj = await tok.json(); if (!tj.access_token) return [];
  const H = { authorization: `Bearer ${tj.access_token}`, "user-agent": REDDIT_UA };
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
// How much of a sweep we are willing to spend. YouTube search costs 100 quota
// units a call against a 10,000/day default. The cap is effectively OFF (25
// themes) because the team runs about one sweep a day, which fits the budget
// comfortably. Lower it in Settings if you start sweeping several times a day.
let COLLECT_CAP = { topics: 25, terms: 4 };
async function collectFeed(topics) {
  feedReset();
  const ts = (await getRule("trend_spotting")).collection || {};
  COLLECT_CAP = { topics: Number(ts.max_topics_per_sweep) || 25, terms: Number(ts.max_terms_per_topic) || 4 };
  if ((topics || []).length > COLLECT_CAP.topics)
    feedNote("youtube", "sweep capped", `${topics.length} themes picked but only the first ${COLLECT_CAP.topics} were swept — YouTube search costs 100 quota units a call. Raise the cap in Settings, or run the rest as a second sweep.`);
  const out = [];
  // Collection used to run strictly sequentially — up to 6 topics x 4 terms, each
  // round waiting on 4 APIs with a 9s timeout. Worst case that is ~24 serial
  // rounds, which outran the request timeout and left the sweep spinning. The
  // terms within a topic now run together, so a topic costs one round, not four.
  for (const t of (topics || []).slice(0, COLLECT_CAP.topics)) {
    const name = typeof t === "string" ? t : t.name;
    const terms = (typeof t === "object" && Array.isArray(t.terms) && t.terms.length) ? t.terms : [name];
    const rounds = await Promise.allSettled(terms.slice(0, COLLECT_CAP.terms).map(async (term) => {
      const batches = await Promise.allSettled([fetchYouTube(term), fetchReddit(term), fetchNews(term), fetchSerpNews(term)]);
      const got = [];
      for (const b of batches) if (b.status === "fulfilled") for (const it of (b.value || [])) got.push({ ...it, topic: name, term });
      return got;
    }));
    for (const r of rounds) if (r.status === "fulfilled") out.push(...r.value);
  }
  // dedupe by url within the sweep, then mark CROSS-SWEEP repeats: anything
  // already in wh_feed_item was surfaced by an earlier sweep — it stays in the
  // record (never removed) but is tagged so the results hide it as a repeat.
  const seen = new Set(); const uniq = out.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url));
  try {
    const prior = new Set((await q(`select url from wh_feed_item where url = any($1)`, [uniq.map((x) => x.url)])).rows.map((r) => r.url));
    for (const it of uniq) it.repeat = prior.has(it.url);
  } catch { /* repeat-marking is best-effort */ }
  for (const it of uniq) await q(`insert into wh_feed_item(source,external_id,title,url,body,meta) values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing`, [it.source, it.external_id || null, it.title || "", it.url, it.body || "", JSON.stringify(it.meta || {})]).catch(() => {});
  return uniq;
}

// ---- Stage 3 · Gap Analysis — real signals from the collected feed ----------
// demand  = question-like comments/posts on the topic (comment trees weighted)
// supply  = how much fresh content already answers it (count + top-item age)
// velocity = views ÷ days since publish (YouTube), normalised
// Falls back to the configured gap_map + item-count when no live metrics exist.
const isQuestion = (t) => /\?|\bhow\b|\bwhy\b|\bwhat\b|\bwhich\b|\bwhen\b|\bcan i\b|\bshould i\b|worth it|vs\b/i.test(String(t || ""));

// On-topic relevance: does the item title share a meaningful keyword with the
// topic/term it was collected under? Drops viral-but-off-topic hits (a K-drama,
// a game) that YouTube's viewCount sort surfaces for a loose query match.
// Words that must NEVER be the reason an item is considered on-topic. "india"
// belongs here: a term like "negotiate india" made every viral Indian video —
// cricket, comedy, protests — count as a keyword match, because they all say
// "India". Geography and generic filler cannot carry relevance on their own.
const FEED_STOP = new Set(("the a an of to for in on at and or your you my how why what which when get got new best top vs "
  + "is are be do this that with into make made using use need needs guide tips 2024 2025 2026 2027 "
  + "india indian bharat desi hindi english video videos latest full part episode ep shorts viral "
  + "number asking right thing things way ways life world people news today").split(" "));
const kwOf = (s) => (String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !FEED_STOP.has(w));
// returns the matched keyword (kept), "" (kept — nothing to match on), or null (off-topic → drop)
function relevanceMatch(row) {
  const keys = new Set([...kwOf(row.topic), ...kwOf(row.term)]);
  if (!keys.size) return "";
  const hay = (row.title || "").toLowerCase();
  for (const k of keys) if (hay.includes(k)) return k;
  return null;
}
// Fix 1a — high-confidence off-domain NOISE. YouTube's view-count sort surfaces
// viral sport/celebrity/gaming clips for any loose word match ("mistake",
// "turned", "career"). These markers never appear in a genuine India-tech career
// story, so a hit is a HARD drop (still logged in the audit trail).
// single source of truth — the editable default list lives on the `relevance` rule
const NOISE_TERMS = RULE_DEFAULTS.relevance.collection.noise_terms;
function noiseReason(title, body, terms = NOISE_TERMS) {
  const hay = `${title || ""} ${String(body || "").slice(0, 200)}`.toLowerCase();
  const hit = (terms || []).map((t) => String(t).toLowerCase()).find((t) => t && hay.includes(t));
  return hit ? `off-domain noise ("${hit}") — sport/celebrity/gaming, not a career story` : null;
}
// lev = the `relevance` rule's collection (user-editable in Settings → Levers)
function markNoise(feed, lev = {}) {
  if (lev.noise_filter === false) return;               // blocklist turned off in Settings
  const terms = (Array.isArray(lev.noise_terms) && lev.noise_terms.length) ? lev.noise_terms : NOISE_TERMS;
  for (const it of (feed || [])) if (!it.drop_reason) { const n = noiseReason(it.title, it.body, terms); if (n) it.drop_reason = n; }
}
// Fix 1b — keyword STRENGTH, used only as a fallback when the AI relevance
// verdict is unavailable: a single generic word ("career") is not enough — need
// ≥2 distinct topic/term keywords in the title, or a 2-word phrase from the term.
function relevanceStrength(row) {
  const keys = [...new Set([...kwOf(row.topic), ...kwOf(row.term)])];
  const hay = (row.title || "").toLowerCase();
  const hits = keys.filter((k) => hay.includes(k)).length;
  const tw = kwOf(row.term);
  const phrase = tw.length >= 2 && tw.slice(0, -1).some((w, i) => hay.includes(`${w} ${tw[i + 1]}`));
  return phrase ? 2 : hits;                 // a matched phrase counts as strong
}
// Fix 2 — apply the AI relevance verdict (classifyFeed sets tags.on_topic) plus
// the keyword fallback. Sets drop_reason on off-topic items so BOTH the evidence
// page AND the idea's cited sources exclude them (no more junk citations).
function gateRelevance(feed, lev = {}) {
  const aiOn = lev.ai_relevance !== false;                  // AI relevance gate (Settings → Levers)
  const minKw = Math.max(1, Number(lev.min_keywords) || 2); // fallback strictness
  for (const it of (feed || [])) {
    if (it.drop_reason) continue;                          // already noise-dropped
    const t = it.tags;
    if (aiOn && t && typeof t.on_topic === "boolean") {    // the AI judged it
      if (!t.on_topic) it.drop_reason = `off-topic — ${String(t.why || "not a working professional's career").slice(0, 80)}`;
      continue;                                            // on_topic → trust the AI, keep
    }
    if (relevanceStrength(it) < minKw) it.drop_reason = `weak match — under ${minKw} topic keywords`;  // no/OFF AI verdict → strict keyword
  }
}
// Regional-language guard: the audience is India-English (guardrails mark
// Hindi/regional content out of scope). Drop titles in an Indic script OR tagged
// with a regional-language name. Returns the detected language, or null if English.
const INDIC_RE = /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const LANG_TAG_RE = /\b(tamil|kannada|telugu|malayalam|hindi|marathi|bengali|punjabi|gujarati|urdu|odia|assamese)\b/i;
// Script → language. English only: every regional Indian script PLUS the wider
// Asian scripts (Thai, CJK, Korean, Arabic/Urdu, Cyrillic, Hebrew, Greek and the
// South-East Asian family). A title in any of these is dropped at collection.
const SCRIPT_LANG = [
  // Indian regional
  [/[஀-௿]/, "Tamil"], [/[ಀ-೿]/, "Kannada"], [/[ఀ-౿]/, "Telugu"], [/[ഀ-ൿ]/, "Malayalam"],
  [/[ऀ-ॿ]/, "Hindi/Devanagari"], [/[ঀ-৿]/, "Bengali"], [/[਀-੿]/, "Punjabi"],
  [/[઀-૿]/, "Gujarati"], [/[଀-୿]/, "Odia"], [/[඀-෿]/, "Sinhala"],
  // South-East Asian
  [/[฀-๿]/, "Thai"], [/[຀-໿]/, "Lao"], [/[ក-៿]/, "Khmer"],
  [/[က-႟]/, "Burmese"],
  // East Asian
  [/[぀-ヿ]/, "Japanese"], [/[가-힯ᄀ-ᇿ]/, "Korean"],
  [/[一-鿿㐀-䶿]/, "Chinese"],
  // Other non-Latin
  [/[؀-ۿݐ-ݿ]/, "Arabic/Urdu"], [/[Ѐ-ӿ]/, "Cyrillic"],
  [/[֐-׿]/, "Hebrew"], [/[Ͱ-Ͽ]/, "Greek"],
];
// Romanised-Hindi (Hinglish) heuristic: vernacular videos often carry an
// English-script title ("Job kaise paye", "Interview me kya bole") that the
// Indic-script check can't see. Two or more Hinglish function-words → vernacular.
const HINGLISH_WORDS = new Set("kaise kya hai hain mein nahi nahin karo kare karna paye paayein bolo bole batao bataya sikho seekho naukri paisa paise lakh crore wala wale ki ka ke ko se par aur bhi tarika tarike jaldi asaan puri pura sabse".split(" "));
function hinglishScore(title) {
  const words = String(title || "").toLowerCase().match(/[a-z]+/g) || [];
  return words.filter((w) => HINGLISH_WORDS.has(w)).length;
}
function regionalLang(title, { audioLang = null, hinglishGuard = true } = {}) {
  const t = String(title || "");
  for (const [re, name] of SCRIPT_LANG) if (re.test(t)) return name;
  const m = t.match(LANG_TAG_RE); if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  // YouTube's own audio-language tag (from the videos API) — authoritative when present
  if (audioLang && !/^en/.test(audioLang)) {
    const byCode = Object.entries(LANG_CODE).find(([, c]) => audioLang.startsWith(c));
    if (byCode) return byCode[0];
  }
  if (hinglishGuard && hinglishScore(t) >= 2) return "Hindi (romanised)";
  return null;
}
const LANG_CODE = { Tamil: "ta", Kannada: "kn", Telugu: "te", Malayalam: "ml", "Hindi/Devanagari": "hi", Bengali: "bn", Punjabi: "pa", Gujarati: "gu", Odia: "or", Hindi: "hi", Marathi: "mr", Urdu: "ur", Assamese: "as", Sinhala: "si",
  Thai: "th", Lao: "lo", Khmer: "km", Burmese: "my", Japanese: "ja", Korean: "ko", Chinese: "zh", "Arabic/Urdu": "ar", Cyrillic: "ru", Hebrew: "he", Greek: "el" };
// Deterministic guardrail enforcement (RULE-DRIVEN, not prompt-only): given the
// allowed-language codes from the business rule, return a drop-reason if this item
// violates it, else null. English/undetected always passes; ["all"] disables it.
function langExcludeReason(title, allowed, { audioLang = null, hinglishGuard = true } = {}) {
  const lang = regionalLang(title, { audioLang, hinglishGuard });
  if (!lang) return null;
  if (!allowed || allowed.includes("all")) return null;
  const code = LANG_CODE[lang] || lang.toLowerCase();
  return allowed.includes(code) ? null : `${lang} — not in allowed languages (${allowed.join(", ")})`;
}

// THE MASTER THEME. RayDar is about work — jobs, hiring, pay, skills.
// An item that mentions none of that is off-topic no matter which keyword it
// happened to share. Checks the title and the description, so a well-titled but
// unrelated video still fails. Returns a drop reason, or null to keep.
function offDomainReason(title, body, domainTerms) {
  const terms = (domainTerms || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  if (!terms.length) return null;                       // empty list = filter off
  const hay = `${title || ""} ${String(body || "").slice(0, 400)}`.toLowerCase();
  return terms.some((t) => hay.includes(t)) ? null : "not about jobs, hiring or careers";
}

// Rank collected feed items by velocity (views ÷ days), split into on-topic (kept)
// vs off-topic (dropped, with reason), and compute coverage stats — the auditable
// snapshot behind the results page's "top videos" block. Returns {kept,dropped,stats}.
let DOMAIN_TERMS = [];
function rankFeedSignal(items, allowedLangs = ["en"], domainTerms = DOMAIN_TERMS) {
  DOMAIN_TERMS = domainTerms || DOMAIN_TERMS;
  const rows = (items || []).filter((f) => f.url).map((f) => {
    const m = f.meta || {};
    const views = Number(m.views || 0), ageDays = m.ageDays || null;
    const vRaw = ageDays ? views / Math.max(1, ageDays) : 0;
    const velocity = vRaw > 0 ? Math.min(1, Math.log10(vRaw + 1) / 5) : 0;
    const comments = Array.isArray(m.comments) ? m.comments : [];
    const questions = comments.filter(isQuestion).length;
    return { source: f.source, title: f.title || "", url: f.url, topic: f.topic || null, term: f.term || null,
      franchise: f.tags?.franchise || null, views, ageDays, comments: comments.length, questions,
      // the actual question TEXT, not just the count — a gap is only persuasive
      // when you can read what people are asking and nobody is answering
      qs: comments.filter(isQuestion).map((c) => String(c).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()).filter((c) => c.length > 12 && c.length < 220).slice(0, 6),
      audioLang: m.audioLang || null, drop_reason: f.drop_reason || null, repeat: !!f.repeat,
      on_topic: (f.tags && typeof f.tags.on_topic === "boolean") ? f.tags.on_topic : null,  // AI relevance verdict
      body: f.body || "",   // the master-theme filter reads this; without it only the title was ever checked
      velocity: Math.round(velocity * 100) / 100 };
  }).filter((x) => x.views > 0 || x.comments > 0 || x.source === "reddit")
    .sort((a, b) => b.velocity - a.velocity || b.views - a.views || b.comments - a.comments);

  const kept = [], dropped = [], repeats = [];
  for (const r of rows) {
    // collection-time filter (shorts / memes) — rule-driven hard drop, reason kept for the audit trail
    if (r.drop_reason) { dropped.push({ ...r, reason: r.drop_reason, hard: true }); continue; }
    const langReason = langExcludeReason(r.title, allowedLangs, { audioLang: r.audioLang });
    if (langReason) { dropped.push({ ...r, reason: langReason, hard: true }); continue; } // rule-driven hard drop, never promoted back
    // AI said this IS about a working professional's career → trust it over the
    // keyword gates below (a real story like "IIT Delhi → Samsung Korea" has no
    // literal "job/career" word yet is exactly on-topic).
    if (r.on_topic !== true) {
      const domReason = offDomainReason(r.title, r.body, DOMAIN_TERMS);
      if (domReason) { dropped.push({ ...r, reason: domReason, hard: true }); continue; }   // master theme — never promoted back
      const m = relevanceMatch(r);
      if (m === null) { dropped.push({ ...r, reason: "no topic-keyword match" }); continue; }
      r.match = m || null;
    } else { r.match = "ai"; }
    // seen in a previous sweep → HIDDEN as a repeat (never removed; first sighting stays the record)
    if (r.repeat) repeats.push(r); else kept.push(r);
  }
  let keptF = kept, dropF = dropped;
  if (keptF.length < 3 && repeats.length) keptF = keptF.concat(repeats.splice(0, 3 - keptF.length)); // a thin sweep may resurface repeats rather than show nothing
  if (keptF.length < 3 && dropF.some((d) => !d.hard)) { // never near-empty the block (but never promote a hard drop)
    const promote = dropF.filter((d) => !d.hard).slice(0, 3 - keptF.length);
    const urls = new Set(promote.map((p) => p.url));
    keptF = keptF.concat(promote.map((d) => ({ ...d, match: null })));
    dropF = dropF.filter((d) => !urls.has(d.url));
  }
  const sources = {}; for (const r of rows) sources[r.source] = (sources[r.source] || 0) + 1;
  const stats = {
    errors: FEED_ERRORS.slice(),
    collected: rows.length, kept: keptF.length, dropped: dropF.length, repeats: repeats.length,
    terms: new Set(rows.map((r) => r.term).filter(Boolean)).size, sources,
    views_analysed: rows.reduce((s, r) => s + (r.views || 0), 0),
    questions: rows.reduce((s, r) => s + (r.questions || 0), 0),
    comments: rows.reduce((s, r) => s + (r.comments || 0), 0),
  };
  return { kept: keptF.slice(0, 15), dropped: dropF.slice(0, 12), repeats: repeats.slice(0, 20), stats };
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
  for (const it of (items || [])) if (!it.drop_reason) (bySrc[it.source] ||= []).push(it);  // don't spend tokens on noise
  const relPrompt = ((await getRule("relevance")).prompt || "").trim();   // editable relevance criteria (Settings → Levers)
  for (const [src, arr] of Object.entries(bySrc)) {
    const rule = await getRule(src);
    if (!arr.length) continue;
    // ONE registry owns provider/model/gate: the AI-pipeline registry (Admin →
    // AI & Pipelines). A business rule contributes the INSTRUCTION and the query
    // params only — it no longer carries a model override or a second gate,
    // which used to silently shadow the pipeline's own settings.
    try {
      const payload = JSON.stringify(arr.map((x, i) => ({ i, title: x.title, body: (x.body || "").slice(0, 300) }))).slice(0, 6000);
      const out = await runPipeline("raydar-classify", {
        system: `${rule.prompt}\n${relPrompt ? relPrompt + "\n" : ""}Return STRICT JSON {"items":[{"i":<index>,"topic":"1..6|Emerging","franchise":"...","registers":{"FOMO":0-1,"Anxiety":0-1,"Optimism":0-1,"Ambition":0-1},"question":"...","on_topic":true|false,"why":"..."}]}.`,
        user: payload, maxTokens: 1500,
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

export function mountWhisperer(app, slug, upload) {
  // Content generation and feed sweeps are long, batched work behind a held
  // connection — the same shape as an ingestion, so the same record.
  mountJobs("wh", app);   // RayDar serves under /api/wh/ — the routes must live inside its own prefix or the role cannot reach them
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
    const nm = name || `Batch ${istStamp()}`;
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
    // a batch describes ITSELF from what went into it — "Batch 01-08 17:44" is
    // useless three weeks later; the themes + research + brief are not.
    const desc = [
      topics.length ? topics.slice(0, 4).join(", ") + (topics.length > 4 ? ` +${topics.length - 4} more` : "") : "all active themes",
      routes.seo ? "with SEO research" : null,
      routes.talentmind ? "TalentMind cohort" : null,
      extra ? `“${extra.slice(0, 70)}${extra.length > 70 ? "…" : ""}”` : null,
    ].filter(Boolean).join(" · ");
    const b = await wq(`insert into wh_batch(name,source,routes,demand_topics,cohort_id,hunger,status,description) values($1,$2,$3::jsonb,$4,$5,$6::jsonb,'draft',$7) returning id`,
      [nm, source, JSON.stringify(routes), topics, cohortId, JSON.stringify(hunger), desc]);
    res.json({ ok: true, id: b.rows?.[0]?.id, name: nm, description: desc });
  });
  // list saved batches (history)
  app.get("/api/wh/batches", async (_req, res) => res.json({ batches: (await wq(`select b.id,b.name,b.description,b.source,b.routes,b.demand_topics,b.status,
      (select count(*) from wh_feed_story s where s.batch_id=b.id and s.status<>'deleted')::int as story_count,
      b.created_at,b.swept_at from wh_batch b order by b.id desc`)).rows }));
  // ---- PURGE old batches -------------------------------------------------
  // Destructive, so it is deliberately cautious: it NEVER removes a batch that
  // holds an idea you marked Used or Saved — that is accepted work. Call with
  // preview=true first to see exactly what would go before anything is deleted.
  app.post("/api/wh/batches/purge", async (req, res) => {
    const keepDays = Number(req.body?.keep_days) || 0;      // 0 = no age limit
    const keepLast = Number(req.body?.keep_last) || 0;       // 0 = no count limit
    const preview = req.body?.preview !== false;             // default: dry run
    // force = purge EVERYTHING, including sweeps holding accepted ideas. Off by
    // default: it has to be asked for explicitly, twice, from the UI.
    const force = req.body?.force === true;
    const w = force ? ["true"]
      : ["not exists (select 1 from wh_feed_story s where s.batch_id=b.id and s.feedback in ('used','saved'))"];
    const args = [];
    if (keepDays > 0) { args.push(keepDays); w.push(`b.created_at < now() - ($${args.length} || ' days')::interval`); }
    if (keepLast > 0) { args.push(keepLast); w.push(`b.id not in (select id from wh_batch order by id desc limit $${args.length})`); }
    const sel = `select b.id, b.name, b.created_at,
        (select count(*) from wh_feed_story s where s.batch_id=b.id)::int ideas
      from wh_batch b where ${w.join(" and ")} order by b.id`;
    const doomed = (await wq(sel, args)).rows;
    const kept = (await wq(`select count(*)::int n from wh_batch`)).rows[0]?.n || 0;
    if (preview) return res.json({ preview: true, would_delete: doomed.length, remaining: kept - doomed.length, batches: doomed });
    if (!doomed.length) return res.json({ ok: true, deleted: 0, remaining: kept });
    await wq(`delete from wh_batch where id = any($1::int[])`, [doomed.map((d) => d.id)]);
    // Repeat detection lives in wh_feed_item, NOT in wh_batch — it is the memory
    // of every URL ever collected. Deleting the sweeps left that memory intact,
    // so a "fresh start" immediately reported everything as "already surfaced in
    // an earlier sweep". If nothing is left, the memory must go too.
    // Two separate memories survive a batch delete, and both make a "fresh
    // start" a lie if they are left behind: wh_feed_item (every URL ever seen →
    // everything reports as a repeat) and wh_search_cache (the 24h search cache
    // → the same terms replay the same results without touching the API).
    let forgot = 0, uncached = 0;
    // `?? 0` here was backwards and dangerous: wq() swallows errors and returns
    // {rows:[]}, so a transient timeout on this COUNT read as "zero batches
    // left" and wiped every URL ever collected plus the whole search cache while
    // dozens of batches still existed. Unknown must mean "do not delete".
    const leftRow = (await wq(`select count(*)::int n from wh_batch`)).rows[0];
    const left = leftRow ? Number(leftRow.n) : null;      // null = we could not tell
    if (left === 0) {
      forgot = (await wq(`delete from wh_feed_item returning 1`)).rows.length;
      uncached = (await wq(`delete from wh_search_cache returning 1`)).rows.length;
    }
    res.json({ ok: true, deleted: doomed.length, remaining: kept - doomed.length, forgot, uncached, batches: doomed });
  });

  // rename / re-describe a batch by hand
  app.post("/api/wh/batch/:id/describe", async (req, res) => {
    await wq(`update wh_batch set name=coalesce($2,name), description=coalesce($3,description) where id=$1`,
      [Number(req.params.id), req.body?.name || null, req.body?.description || null]);
    res.json({ ok: true });
  });

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
    const guardPrompt = guard.prompt || "";
    const allowedLangs = (guard.collection && guard.collection.languages) || ["en"]; // rule-driven, code-enforced (not prompt-only)
    const W = sc.weights || { gap: 0.35, velocity: 0.25, strategic: 0.20, historical: 0.20 };
    // seasonal + business-push lifts that apply RIGHT NOW (IST month)
    const nowMonth = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", month: "numeric" }).format(new Date()));
    const chips = (await wq(`select kind, value, meta from wh_journey_chip where active and kind in ('season','push')`)).rows;
    const LIFTS = {
      season: chips.filter((c) => c.kind === "season" && (c.meta?.months || []).includes(nowMonth))
                   .map((c) => ({ value: c.value, lift: Number(c.meta?.lift) || 0 })),
      push:   chips.filter((c) => c.kind === "push").map((c) => ({ value: c.value, lift: Number(c.meta?.lift) || 0 })),
    };
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
    // SEO route → the uploaded/pasted research becomes real search queries (this is how SEO steers the sweep)
    let seoTerms = [];
    if (batch.routes && batch.routes.seo) {
      const seoText = (await wq(`select content from wh_seo_input order by id desc limit 20`)).rows.map((r) => r.content).join("\n");
      seoTerms = extractSeoTerms(seoText);
      if (seoTerms.length) feedTopics.push({ name: "__seo__", terms: seoTerms.slice(0, 8) });
    }
    const lev = (await getRule("relevance")).collection || {};  // user-editable relevance levers (Settings → Levers)
    const feed = await collectFeed(feedTopics).catch(() => []);
    markNoise(feed, lev);                                // Fix 1 — hard-drop sport/celebrity/gaming noise (editable blocklist)
    await classifyFeed(feed).catch(() => {});            // Stage 2 — channel through each source's rule prompt (+ relevance verdict)
    gateRelevance(feed, lev);                            // Fix 2 — apply AI on_topic verdict + strict-keyword fallback → drop_reason
    await wq(`update wh_batch set feed_signal=$2::jsonb where id=$1`, [bid, JSON.stringify(rankFeedSignal(feed, allowedLangs, (guard.collection || {}).domain_terms))]).catch(() => {}); // results-page "top videos" snapshot
    // SEO gets its OWN idea board, grounded ONLY in the SEO feed → visible in the output with ✨-tagged sources
    if (seoTerms.length && feed.some((f) => f.topic === "__seo__")) {
      topicRows = [...topicRows, { name: "SEO research", franchise: topicRows[0]?.franchise || "Emerging", format_home: "", strategic_weight: 1, question: `high-intent keywords from your SEO upload: ${seoTerms.slice(0, 8).join(", ")}`, terms: seoTerms, __seo: true }];
    }
    const made = []; let failedWrites = 0;

    // RECORD THE WORK BEFORE DOING IT. Cloud Run kills the request at 900s and this
    // sweep measured ~1,060s, so the generation regularly died mid-flight — leaving
    // no trace of what it had finished, a spinner that would never resolve, and no
    // way to continue except starting over and paying for the topics that already
    // succeeded. server/jobs.js was written for exactly this and had zero callers.
    // Each item carries the topic name, so a resume redoes only what never ran.
    const jobId = await startJob({
      app: "wh", kind: "sweep", label: `Sweep · batch ${bid}`, actor: req.acct?.user || null,
      meta: { batch_id: bid, topics: topicRows.length },
      items: topicRows.map((t) => ({ label: t.name, payload: { topic: t.name } })),
    }).catch(() => null);

    // A topic already generated on an earlier attempt is skipped: re-running the
    // whole sweep after a timeout used to re-pay for every topic that had worked.
    const alreadyDone = new Set((await wq(
      `select distinct demand_topic from wh_feed_story where batch_id=$1 and status<>'deleted'`, [bid]
    )).rows.map((r) => r.demand_topic));

    // THE OUTER LOOP WAS SERIAL. Topics are independent — nothing in one feeds
    // another — so N topics cost N x (research + 3 model calls) end to end, and the
    // generation phase alone accounted for ~928s of the 1,060s. Run a few at a time.
    // Bounded, not unbounded: research hits rate-limited external APIs, and firing
    // sixteen topics at once trades a timeout for a 429.
    const LANE = 3;
    const runTopic = async (t, ord) => {
      const research = await researchTopic(extra ? `${t.name} — ${extra}` : t.name).catch(() => null);
      const pool = (t.__seo
        ? feed.filter((f) => f.topic === "__seo__")   // SEO idea grounds ONLY on the SEO feed (all via_seo)
        : feed.filter((f) => f.topic === t.name || f.topic === "__extra__" || (f.title || "").toLowerCase().includes(t.name.split(" ")[0].toLowerCase()))
      ).filter((f) => !f.drop_reason && !langExcludeReason(f.title, allowedLangs, { audioLang: f.meta?.audioLang })); // rule-enforced: shorts/memes/excluded-language never ground an idea
      // fresh items first; cross-sweep repeats only fill the gap when the sweep is thin
      const items = [...pool.filter((f) => !f.repeat), ...pool.filter((f) => f.repeat)].slice(0, 5);
      const sig = topicSignals(items, GAPMAP[t.name]);          // Stage 3 — real demand/supply/velocity when live
      const velocity = sig.velocity != null ? sig.velocity : Math.min(1, 0.4 + items.length * 0.1);
      // Strategic weight now also carries SEASON and BUSINESS PUSH. Both were
      // seeded in wh_journey_chip and read by nothing — so a topic that matters
      // this month scored identically to one that doesn't. A season lifts every
      // topic while its months are current; a push lifts the series it names.
      const seasonLift = LIFTS.season.reduce((a, x) => a + x.lift, 0);
      const pushLift = LIFTS.push.filter((x) => x.value === t.franchise || x.value === t.series).reduce((a, x) => a + x.lift, 0);
      const strategic = Math.min(1, ((Number(t.strategic_weight) || 1) / 1.5) + seasonLift + pushLift);
      const franchiseHist = hist[t.franchise] || 0;
      const gap = sig.gap;
      // The three angles for a topic are INDEPENDENT — nothing in one feeds
      // another — so they ran 18 model calls end to end for no reason. Opus at
      // 2500 tokens is ~30s a call; that is ~9 minutes of pure waiting, which is
      // what actually hung the sweep (an exhausted YouTube key would have made
      // it FASTER, not slower — collection just returns empty). Run them together.
      await Promise.all([0, 1, 2].map(async (a) => {
        const grounding = (items.length || research) ? `\nReal feed: ${JSON.stringify(items.map((x) => ({ src: x.source, title: x.title, url: x.url, tags: x.tags })))}\nResearch: ${JSON.stringify(research || {}).slice(0, 2000)}` : "";
        const contra = a === 1;
        const { j } = await ai("feedstory-generate", `${guardPrompt ? guardPrompt + "\n\n" : ""}Create ONE content idea (heading + topic guide brief only — NOT finished copy) for the '${t.franchise}' franchise. Angle: ${ANGLES[a]}. ${contra ? "This is a CONTRADICTION idea — push against a popular but wrong belief; state the belief. " : ""}Ground it in the real feed + research when given; evidence must be specific.`, `Demand topic: ${t.name} (underlying question: ${t.question})\nFranchise: ${t.franchise} · format: ${t.format_home}\nCohort: ${JSON.stringify(hunger).slice(0, 1200)}${extra ? `\nUser's extra brief for this sweep (weight it heavily): ${extra}` : ""}\nPick 1-up from ${JSON.stringify(oneups)}, register from ${JSON.stringify(regs)}.${grounding}`, 2500); // room for the full idea JSON (opus is verbose → 1200 truncated → parse-fail → 0 ideas)
        // LLM-only — no dummy fallback. If the model didn't return a usable idea, skip it.
        if (!j || !j.heading) return;
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
        const srcRefs = [...items.map((x) => ({ title: x.title, url: x.url, source: x.source, via_seo: x.topic === "__seo__" ? x.term : undefined })), ...((research?.refs) || [])].slice(0, 8);
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
        const breakdown = { gap: Math.round(gap * 100) / 100, velocity: Math.round(velocity * 100) / 100, strategic: Math.round(strategic * 100) / 100, historical: Math.round(franchiseHist * 100) / 100, weights: W, demand: sig.demand, supply: sig.supply, live: sig.live, sources, fact_check, season: LIFTS.season.map((x) => x.value), push: LIFTS.push.map((x) => x.value) };
        const gapType = s.contradiction ? "wrong" : (sig.gapType || (velocity >= 0.8 ? "emerging" : gap >= 0.8 ? "unanswered" : items.length <= 1 ? "thin" : "stale"));
        const r = await wq(`insert into wh_feed_story(batch_id,cohort_id,demand_topic,franchise,platform,one_up,emotional_register,heading,topic_guide,summary,why_now,why_relevant,why_cohort,evidence,contradiction,contradiction_of,source_refs,score,score_breakdown,angle,gap_type,in_library,status)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb,$20,$21,true,'draft') returning id`,
          [bid, cohortId, t.name, t.franchise, s.platform || t.format_home, s.one_up, s.emotional_register, s.heading, JSON.stringify(s.topic_guide || {}), s.summary, s.why_now, s.why_relevant, s.why_cohort, s.evidence || "", !!s.contradiction, s.contradiction_of || null, JSON.stringify(srcRefs), score, JSON.stringify(breakdown), ANGLES[a], gapType]);
        const newId = r.rows?.[0]?.id;
        if (newId) made.push(newId); else failedWrites++;   // wq() swallows DB errors — an unchecked push counted ideas that were never stored
      }));
      if (jobId) await setItem(jobId, ord, { stage: "done", status: "ok" });
    };

    // run topicRows through LANE workers; a topic that throws must not take the
    // sweep with it — it is recorded as failed and the rest continue
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LANE, topicRows.length) }, async () => {
      for (;;) {
        const ord = next++;
        if (ord >= topicRows.length) return;
        const t = topicRows[ord];
        if (alreadyDone.has(t.name)) { if (jobId) await setItem(jobId, ord, { stage: "done", status: "ok", note: "already generated on an earlier attempt" }); continue; }
        if (jobId) await setItem(jobId, ord, { stage: "generating", attempt: true });
        try { await runTopic(t, ord); }
        catch (e) { if (jobId) await setItem(jobId, ord, { stage: "failed", status: "error", note: String(e?.message || e).slice(0, 200) }); }
      }
    }));
    if (jobId) await finishJob(jobId, "done");
    await wq(`update wh_batch set story_count=$2, status='swept', swept_at=now() where id=$1`, [bid, made.length]);
    // When a sweep writes nothing, say WHY. An empty result page is otherwise
    // indistinguishable from a broken one — the same failure mode as the silent
    // API key, one layer up.
    const diag = { topics: topicRows.length, collected: feed.length, feed_errors: FEED_ERRORS.slice() };
    res.json({ ok: true, made: made.length, failed: failedWrites, ...diag });
  });

  // the results-page "top videos that scored high" block — ranked feed snapshot for this
  // sweep. NB: distinct path from /api/wh/feed/status (which would shadow :batchId).
  app.get("/api/wh/feed-signal/:batchId", async (req, res) => {
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
    const { franchise, feedback, batch, stage, reason } = req.query; const args = []; const w = ["s.status<>'deleted'", "s.in_library"];
    if (franchise && franchise !== "all") { args.push(franchise); w.push(`s.franchise=$${args.length}`); }
    // 'unmarked' = never reviewed. Without this you cannot find what still needs a decision.
    if (feedback === "unmarked") w.push(`s.feedback is null`);
    else if (feedback && feedback !== "all") { args.push(feedback); w.push(`s.feedback=$${args.length}`); }
    if (reason && reason !== "all") { args.push(reason); w.push(`s.reject_reason=$${args.length}`); }
    // journey stage — 'none' = express-sweep only, never enrolled in the journey
    if (stage === "none") w.push(`s.stage is null`);
    else if (stage && stage !== "all") { args.push(stage); w.push(`s.stage=$${args.length}`); }
    if (batch && batch !== "all") { args.push(Number(batch)); w.push(`s.batch_id=$${args.length}`); }
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
  // AI helper: propose search terms for a concept (human confirms before save → terms stay deterministic config)
  app.post("/api/wh/topic/suggest-terms", async (req, res) => {
    const name = String(req.body?.name || "").trim(); if (!name) return res.status(400).json({ error: "name required" });
    const guard = await getRule("guardrails"); const aud = guard.collection?.audience || "Indian job seekers"; const langs = (guard.collection?.languages || ["en"]).join("/");
    const { j } = await ai("raydar-terms",
      `You propose YouTube/Reddit SEARCH TERMS for a demand concept. Audience: ${aud}. Language(s): ${langs}. Return 5-6 SHORT (2-5 words), high-intent queries a person would actually type — no hashtags, no quotes, no numbering. STRICT JSON {"terms":["...","..."]}.`,
      `Concept: ${name}`, 500);
    const terms = Array.isArray(j?.terms) ? [...new Set(j.terms.map((t) => String(t).trim().replace(/^["'#]+|["']+$/g, "")).filter(Boolean))].slice(0, 6) : [];
    res.json({ terms });
  });

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
  // "Tell it what you want" — plain English → a PROPOSED change to this rule's
  // params + instruction. Never applied silently: the operator sees the diff and
  // confirms. This is how a non-technical user edits the JSON without seeing JSON.
  app.post("/api/wh/rules/:id/ask", async (req, res) => {
    const id = req.params.id; if (!RULE_DEFAULTS[id]) return res.status(404).json({ error: "unknown rule" });
    const want = String(req.body?.want || "").trim().slice(0, 600);
    if (!want) return res.status(400).json({ error: "say what you want changed" });
    const rule = await getRule(id);
    const { j } = await ai("raydar-terms",
      `You edit ONE control block of a content-sweep engine. Given its current parameters and instruction, and what the operator wants in plain English, return the UPDATED block. Change only what the request implies; keep every other key exactly as-is; never invent keys that don't exist unless the request clearly needs one. Return STRICT JSON {"collection":{...the full updated params...},"prompt":"the updated instruction","changed":["one short line per change, in plain English"]}.`,
      `Control: ${id}\nCurrent parameters: ${JSON.stringify(rule.collection || {})}\nCurrent instruction: ${rule.prompt || ""}\n\nThe operator wants: ${want}`, 1200);
    if (!j || (!j.collection && !j.prompt)) return res.json({ ok: false, error: "no keyed model, or it couldn't read that — try rephrasing, or edit the fields directly" });
    res.json({ ok: true, proposal: { collection: j.collection || rule.collection, prompt: j.prompt || rule.prompt, changed: Array.isArray(j.changed) ? j.changed.slice(0, 8) : [] } });
  });

  app.post("/api/wh/rules/:id", async (req, res) => {
    const id = req.params.id; if (!RULE_DEFAULTS[id]) return res.status(404).json({ error: "unknown integration" });
    const merged = mergeRule(id, req.body || {});
    await wq(`insert into wh_business_rule(name, rule) values($1,$2::jsonb) on conflict(name) do update set rule=excluded.rule`, [id, JSON.stringify(merged)]);
    q(`insert into audit_log(actor,action,object_type,object_id,detail) values('admin','raydar.rule','integration',$1,$2::jsonb)`, [id, JSON.stringify({ collection: merged.collection })]).catch(() => {});
    res.json({ ok: true, rule: merged });
  });

  // SEO research workspace — a 2nd write source (paste keyword/GSC/competitor/trend research)
  app.get("/api/wh/seo", async (_req, res) => res.json({ inputs: (await wq(`select id, kind, content, created_at from wh_seo_input order by id desc limit 50`)).rows }));
  app.post("/api/wh/seo", async (req, res) => { const { kind, content } = req.body || {}; if (!content) return res.status(400).json({ error: "content required" }); await wq(`insert into wh_seo_input(kind, content) values($1,$2)`, [kind || "keywords", content]); res.json({ ok: true }); });
  // Excel/CSV upload → SheetJS extract → stored as an SEO input; returns the search phrases it found
  app.post("/api/wh/seo/upload", upload.single("file"), async (req, res) => {
    try {
      const f = req.file; if (!f) return res.status(400).json({ error: "no file" });
      const ex = await extractFile(f.path, f.originalname);
      // read EVERY sheet/tab: extract.js concatenates all sheets into ex.text (+ per-sheet csv)
      const text = ex.text || (ex.sheets && ex.sheets.length ? ex.sheets.map((s) => s.csv || "").join("\n") : "");
      const terms = extractSeoTerms(text);
      const sheetNames = (ex.sheets || []).map((s) => s.name);
      // store the extracted keywords (not raw text) so nothing is truncated + the sweep uses exactly these
      await wq(`insert into wh_seo_input(kind, content) values('excel',$1)`, [terms.length ? terms.join("\n") : text.slice(0, 20000)]);
      res.json({ ok: true, file: f.originalname, sheets: sheetNames, terms });
    } catch (e) { console.error("seo/upload:", e.message); res.status(500).json({ error: "could not read file" }); }
    finally { if (req.file?.path) rmSync(req.file.path, { force: true }); }
  });
  app.post("/api/wh/seo/:id/delete", async (req, res) => { await wq(`delete from wh_seo_input where id=$1`, [Number(req.params.id)]); res.json({ ok: true }); });
}
