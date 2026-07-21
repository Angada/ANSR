// Whisperer backend — Journey 1 (mock-first): candidates → ClientMind → cohort →
// Hunger → Feed Stories. Every AI step runs through a gated pipeline (runPipeline)
// with a deterministic MOCK fallback so the whole journey works with no key.
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";

const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
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
  app.post("/api/wh/feedstories/:cohortId", async (req, res) => {
    const id = Number(req.params.cohortId);
    const co = (await wq(`select * from wh_cohort where id=$1`, [id])).rows?.[0];
    if (!co) return res.status(404).json({ error: "cohort not found" });
    const hunger = co.hunger_story || {};
    const topics = (hunger.demand_topics || []).length ? hunger.demand_topics : (await wq(`select name from wh_demand_topic where active order by id limit 3`)).rows.map((r) => r.name);
    const oneups = (await wq(`select name from wh_one_up where active`)).rows.map((r) => r.name);
    const frames = (await wq(`select name from wh_emotional_framework where active`)).rows.map((r) => r.name);
    const regs = (await wq(`select name from wh_emotional_register where active`)).rows.map((r) => r.name);
    const made = [];
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const { j } = await ai("feedstory-generate", "Create a content idea (heading + brief only).", `Demand topic: ${topic}\nCohort: ${JSON.stringify(hunger).slice(0, 2000)}\nPick a 1-up from ${JSON.stringify(oneups)}, framework from ${JSON.stringify(frames)}, register from ${JSON.stringify(regs)}.`);
      const s = j || {
        heading: `${topic}: the ${["truth","playbook","numbers"][i % 3]} no one tells you`,
        summary: `A ${regs[i % regs.length] || "sharp"} take on ${topic.toLowerCase()} for this cohort.`,
        topic_guide: { take: `Reframe ${topic.toLowerCase()} around what this cohort actually feels.`, beats: ["Open with the tension", "One insider data point", "A concrete do-this-now"], proof: ["a benchmark stat", "a short anecdote"] },
        why_now: "Trending across Reddit + YouTube for India GCC talent this month.", why_relevant: `Directly answers what the cohort cares about (${(hunger.cares_about || [])[0] || topic}).`,
        why_cohort: `This cohort (${co.nl_query || co.name}) over-indexes on ${(hunger.motivations || ["growth"])[0]}.`,
        one_up: oneups[i % oneups.length], emotional_framework: frames[i % frames.length], emotional_register: regs[i % regs.length],
      };
      const r = await wq(`insert into wh_feed_story(cohort_id,demand_topic,one_up,emotional_framework,emotional_register,heading,topic_guide,summary,why_now,why_relevant,why_cohort,status)
        values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'draft') returning id`,
        [id, topic, s.one_up, s.emotional_framework, s.emotional_register, s.heading, JSON.stringify(s.topic_guide || {}), s.summary, s.why_now, s.why_relevant, s.why_cohort]);
      made.push(r.rows?.[0]?.id);
    }
    res.json({ ok: true, made: made.length });
  });

  app.get("/api/wh/feedstories/:cohortId", async (req, res) => res.json({ stories: (await wq(`select * from wh_feed_story where cohort_id=$1 and status<>'deleted' order by id desc`, [Number(req.params.cohortId)])).rows }));

  app.post("/api/wh/feedstory/:id/action", async (req, res) => {
    const id = Number(req.params.id), a = req.body?.action;
    if (a === "approve") await wq(`update wh_feed_story set status='approved' where id=$1`, [id]);
    else if (a === "bank") await wq(`update wh_feed_story set status='banked' where id=$1`, [id]);
    else if (a === "delete") await wq(`update wh_feed_story set status='deleted' where id=$1`, [id]);
    else if (a === "select") await wq(`update wh_feed_story set selected = not selected where id=$1`, [id]);
    else if (a === "edit") await wq(`update wh_feed_story set heading=coalesce($2,heading), summary=coalesce($3,summary) where id=$1`, [id, req.body?.heading ?? null, req.body?.summary ?? null]);
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
}
