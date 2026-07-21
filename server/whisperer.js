// Whisperer backend — Journey 1 (mock-first): candidates → ClientMind → cohort →
// Hunger → Feed Stories. Every AI step runs through a gated pipeline (runPipeline)
// with a deterministic MOCK fallback so the whole journey works with no key.
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";
import { getIntegrationKey, publicIntegrations } from "./store.js";

const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
const enabled = (id) => { try { return !!publicIntegrations()[id]?.enabled && !!getIntegrationKey(id); } catch { return false; } };
const timeout = (p, ms = 9000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms))]);

// ---- Feed collection (real when a source's key is enabled; else []) ---------
async function fetchYouTube(topic) {
  const key = getIntegrationKey("youtube"); if (!key) return [];
  const r = await timeout(fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=4&regionCode=IN&relevanceLanguage=en&q=${encodeURIComponent(topic)}&key=${encodeURIComponent(key)}`));
  const j = await r.json(); return (j.items || []).map((i) => ({ source: "youtube", external_id: i.id?.videoId, title: i.snippet?.title, url: `https://youtube.com/watch?v=${i.id?.videoId}`, body: i.snippet?.description }));
}
async function fetchReddit(topic) {
  const pair = getIntegrationKey("reddit"); if (!pair || !pair.includes(":")) return [];
  const [cid, secret] = pair.split(":");
  const tok = await timeout(fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${cid}:${secret}`).toString("base64"), "content-type": "application/x-www-form-urlencoded", "user-agent": "qansr-whisperer/1.0" }, body: "grant_type=client_credentials" }));
  const tj = await tok.json(); if (!tj.access_token) return [];
  const r = await timeout(fetch(`https://oauth.reddit.com/search?q=${encodeURIComponent(topic)}&limit=4&sort=relevance&t=month`, { headers: { authorization: `Bearer ${tj.access_token}`, "user-agent": "qansr-whisperer/1.0" } }));
  const j = await r.json(); return (j.data?.children || []).map((c) => ({ source: "reddit", external_id: c.data?.id, title: c.data?.title, url: "https://reddit.com" + c.data?.permalink, body: (c.data?.selftext || "").slice(0, 400) }));
}
async function fetchNews(topic) {
  const key = getIntegrationKey("newsapi"); if (!key) return [];
  const r = await timeout(fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&language=en&pageSize=4&sortBy=publishedAt&apiKey=${encodeURIComponent(key)}`));
  const j = await r.json(); return (j.articles || []).map((a) => ({ source: "news", title: a.title, url: a.url, body: a.description }));
}
async function fetchSerpNews(topic) {
  const key = getIntegrationKey("serpapi"); if (!key) return [];
  const r = await timeout(fetch(`https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(topic)}&gl=in&hl=en&api_key=${encodeURIComponent(key)}`));
  const j = await r.json(); return (j.news_results || []).slice(0, 4).map((n) => ({ source: "serpapi", title: n.title, url: n.link, body: n.snippet }));
}
async function collectFeed(topics) {
  const out = [];
  for (const topic of (topics || []).slice(0, 3)) {
    const batches = await Promise.allSettled([fetchYouTube(topic), fetchReddit(topic), fetchNews(topic), fetchSerpNews(topic)]);
    for (const b of batches) if (b.status === "fulfilled") out.push(...(b.value || []));
  }
  // dedupe by url, persist
  const seen = new Set(); const uniq = out.filter((x) => x.url && !seen.has(x.url) && seen.add(x.url));
  for (const it of uniq) await q(`insert into wh_feed_item(source,external_id,title,url,body) values($1,$2,$3,$4,$5) on conflict do nothing`, [it.source, it.external_id || null, it.title || "", it.url, it.body || ""]).catch(() => {});
  return uniq;
}

// ---- Research / validation (Tavily → Serper → Perplexity, whichever enabled) -
async function researchTopic(topic) {
  try {
    if (enabled("tavily")) { const r = await timeout(fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: getIntegrationKey("tavily"), query: `${topic} India 2025 trends`, max_results: 5, include_answer: true }) })); const j = await r.json(); return { answer: j.answer, refs: (j.results || []).map((x) => ({ title: x.title, url: x.url })) }; }
    if (enabled("serper")) { const r = await timeout(fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": getIntegrationKey("serper"), "content-type": "application/json" }, body: JSON.stringify({ q: `${topic} India trends`, gl: "in", hl: "en" }) })); const j = await r.json(); return { answer: (j.answerBox?.answer || j.knowledgeGraph?.description || ""), refs: (j.organic || []).slice(0, 5).map((x) => ({ title: x.title, url: x.link })) }; }
    if (enabled("perplexity")) { const r = await timeout(fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { authorization: `Bearer ${getIntegrationKey("perplexity")}`, "content-type": "application/json" }, body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: `Research "${topic}" for India English audience: key recent facts + why trending. Cite sources.` }], max_tokens: 500 }) })); const j = await r.json(); return { answer: j.choices?.[0]?.message?.content, refs: (j.citations || []).map((u) => ({ title: u, url: u })) }; }
  } catch { /* */ }
  return null;
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

  // ---- Feed Stories (heading + topic guide; classified + justified) --------
  // gap proxy per topic (demand ÷ quality-of-supply) — the brief's core signal
  const GAP = { "Keywords and resume": 0.9, "Salary negotiation": 0.85, "Using AI to get better jobs": 0.82, "Landing your dream job": 0.7, "Skills to get a new job": 0.6, "Which coding tool to use": 0.6, "Emerging": 0.75 };
  const ANGLES = ["core", "contrarian", "insider-data"];

  app.post("/api/wh/feedstories/:cohortId", async (req, res) => {
    const id = Number(req.params.cohortId);
    const co = (await wq(`select * from wh_cohort where id=$1`, [id])).rows?.[0];
    if (!co) return res.status(404).json({ error: "cohort not found" });
    const hunger = co.hunger_story || {};
    // the approved 6 demand topics + franchise routing (skip Emerging for generation)
    const topicRows = (await wq(`select name, franchise, format_home, strategic_weight, question from wh_demand_topic where active and name<>'Emerging' order by id`)).rows;
    const regs = (await wq(`select name from wh_emotional_register where active`)).rows.map((r) => r.name);
    const oneups = ["Contrarian take", "Insider data", "Do-this-now"];
    // historical acceptance per franchise (feedback loop → ranking)
    const hist = {}; for (const r of (await wq(`select franchise, count(*) filter(where feedback='used') u, count(*) filter(where feedback is not null) t from wh_feed_story group by franchise`)).rows) hist[r.franchise] = Number(r.t) ? Number(r.u) / Number(r.t) : 0;

    const feed = await collectFeed(topicRows.map((t) => t.name)).catch(() => []);
    const made = [];
    for (const t of topicRows) {
      const research = await researchTopic(t.name).catch(() => null);
      const items = feed.filter((f) => (f.title || "").toLowerCase().includes(t.name.split(" ")[0].toLowerCase())).slice(0, 5);
      const velocity = Math.min(1, 0.4 + items.length * 0.1);
      const strategic = Math.min(1, (Number(t.strategic_weight) || 1) / 1.5);
      const franchiseHist = hist[t.franchise] || 0;
      for (let a = 0; a < 3; a++) {                       // 3 ideas / topic → ~18 total
        const grounding = (items.length || research) ? `\nReal feed: ${JSON.stringify(items.map((x) => ({ src: x.source, title: x.title, url: x.url })))}\nResearch: ${JSON.stringify(research || {}).slice(0, 2000)}` : "";
        const contra = a === 1 || t.name === "Keywords and resume";
        const { j } = await ai("feedstory-generate", `Create ONE content idea (heading + topic guide brief only — NOT finished copy) for Talent500's '${t.franchise}' franchise. Angle: ${ANGLES[a]}. ${contra ? "This is a CONTRADICTION idea — push against a popular but wrong belief; state the belief. " : ""}Ground it in the real feed + research when given; evidence must be specific.`, `Demand topic: ${t.name} (underlying question: ${t.question})\nFranchise: ${t.franchise} · format: ${t.format_home}\nCohort: ${JSON.stringify(hunger).slice(0, 1200)}\nPick 1-up from ${JSON.stringify(oneups)}, register from ${JSON.stringify(regs)}.${grounding}`);
        const srcRefs = [...items.map((x) => ({ title: x.title, url: x.url, source: x.source })), ...((research?.refs) || [])].slice(0, 6);
        const s = j || {
          heading: `${t.name}: the ${["truth", "myth everyone repeats", "numbers"][a]} no one tells you`,
          summary: `A ${regs[a % regs.length] || "steady"} take on ${t.name.toLowerCase()} — ${t.franchise}.`,
          topic_guide: { take: `Reframe "${t.question}" around what this cohort actually feels.`, beats: ["Open with the tension", "One insider data point", "A concrete do-this-now"], proof: ["a benchmark stat", "a real comment/thread"] },
          why_now: items.length ? `${items.length} fresh items on this across YouTube/Reddit this month.` : "Recurring demand across India GCC talent this month.",
          why_relevant: `Answers "${t.question}" directly.`, why_cohort: `This cohort (${co.nl_query || co.name}) over-indexes on ${(hunger.motivations || ["growth"])[0]}.`,
          evidence: items.length ? `Grounded in ${items.length} live items` : "demand signal from cohort chips",
          one_up: oneups[a % oneups.length], emotional_framework: "", emotional_register: regs[a % regs.length],
          contradiction: contra, contradiction_of: contra ? "popular ATS/resume advice that's factually wrong" : null,
          platform: t.format_home,
        };
        const gap = GAP[t.name] ?? 0.6;
        const score = Math.round((0.35 * gap + 0.25 * velocity + 0.20 * strategic + 0.20 * franchiseHist) * 1000) / 1000;
        const breakdown = { gap, velocity, strategic, historical: Math.round(franchiseHist * 100) / 100 };
        const r = await wq(`insert into wh_feed_story(cohort_id,demand_topic,franchise,platform,one_up,emotional_register,heading,topic_guide,summary,why_now,why_relevant,why_cohort,evidence,contradiction,contradiction_of,source_refs,score,score_breakdown,status)
          values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,'draft') returning id`,
          [id, t.name, t.franchise, s.platform || t.format_home, s.one_up, s.emotional_register, s.heading, JSON.stringify(s.topic_guide || {}), s.summary, s.why_now, s.why_relevant, s.why_cohort, s.evidence || "", !!s.contradiction, s.contradiction_of || null, JSON.stringify(srcRefs), score, JSON.stringify(breakdown)]);
        made.push(r.rows?.[0]?.id);
      }
    }
    res.json({ ok: true, made: made.length });
  });

  app.get("/api/wh/feedstories/:cohortId", async (req, res) => {
    const fr = req.query.franchise; const args = [Number(req.params.cohortId)];
    let sql = `select * from wh_feed_story where cohort_id=$1 and status<>'deleted'`;
    if (fr && fr !== "all") { sql += ` and franchise=$2`; args.push(fr); }
    sql += ` order by score desc nulls last, id desc`;   // ranked
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
  app.get("/api/wh/topics", async (_req, res) => res.json({ topics: (await wq(`select name, question, franchise, format_home, strategic_weight, notes, active from wh_demand_topic order by id`)).rows }));

  // 1Up franchises (routing targets) — config, editable
  app.get("/api/wh/franchises", async (_req, res) => res.json({ franchises: (await wq(`select * from wh_franchise order by id`)).rows }));
  app.post("/api/wh/franchise", async (req, res) => {
    const { name, stage, format_home, active } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" });
    await wq(`insert into wh_franchise(name,stage,format_home,active) values($1,$2,$3,coalesce($4,true)) on conflict(name) do update set stage=coalesce(excluded.stage,wh_franchise.stage), format_home=coalesce(excluded.format_home,wh_franchise.format_home), active=coalesce(excluded.active,wh_franchise.active)`, [name, stage || null, format_home || null, active]);
    res.json({ ok: true });
  });
  // set a topic's franchise routing
  app.post("/api/wh/topic/route", async (req, res) => { await wq(`update wh_demand_topic set franchise=$2, format_home=coalesce($3,format_home) where name=$1`, [req.body?.topic, req.body?.franchise, req.body?.format_home || null]); res.json({ ok: true }); });

  // SEO research workspace — a 2nd write source (paste keyword/GSC/competitor/trend research)
  app.get("/api/wh/seo", async (_req, res) => res.json({ inputs: (await wq(`select id, kind, content, created_at from wh_seo_input order by id desc limit 50`)).rows }));
  app.post("/api/wh/seo", async (req, res) => { const { kind, content } = req.body || {}; if (!content) return res.status(400).json({ error: "content required" }); await wq(`insert into wh_seo_input(kind, content) values($1,$2)`, [kind || "keywords", content]); res.json({ ok: true }); });
  app.post("/api/wh/seo/:id/delete", async (req, res) => { await wq(`delete from wh_seo_input where id=$1`, [Number(req.params.id)]); res.json({ ok: true }); });
}
