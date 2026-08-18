// RayDar · JOURNEY — the high-involvement lane, alongside the express sweep.
//
//   01 Radar → 02 Shortlist → 03 Dump → 04 Brief → 05 Assign → 06 Live
//
// Design rules this file obeys:
//  · The express journey (Hunger → Sweep → Ideas) is NOT touched. A story with
//    stage IS NULL stays a classic sweep idea; setting a stage enrols it here.
//  · RayDar never performs keyword research. Station 03 READS research that SEO
//    already produced elsewhere (Dump AI, Munshi method).
//  · Every act — human or machine — writes one wh_story_event row. That append-
//    only table is the whole tracking spine.
//  · Every station carries its own explainable-AI copy (why / what / who) served
//    from STATIONS below, so the content team is self-service.
import { rmSync } from "node:fs";
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";
import { extractFile } from "./extract.js";

const jq = (t, p) => q(t, p).catch(() => ({ rows: [] }));
const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

export const STAGES = ["radar", "shortlist", "dump", "brief", "assign", "live"];

// ---------------------------------------------------------------------------
// EXPLAINABLE AI — the station handbook. One source of truth, served to the UI
// so the copy on screen and the copy in the docs can never drift apart.
// Each station answers, in the operator's own language:
//   why   — why this step exists at all (what goes wrong without it)
//   does  — what actually happens when you're standing here
//   ai    — what the machine decides vs what YOU decide (the honesty line)
//   human — the gate: what you must do before it moves on
// ---------------------------------------------------------------------------
export const STATIONS = [
  {
    id: "radar", n: "01", title: "Radar", owner: "Content", short: "what the world is saying",
    why: "You can't pick topics from a blank page. Radar reads what job seekers are actually watching, asking and complaining about — so the shortlist starts from evidence instead of a hunch.",
    does: "Runs the same sweep as the express lane (YouTube, Reddit, News per your concept search terms), classifies every item to a demand concept and a 1Up franchise, then measures demand against supply per topic. It stops at CANDIDATE TOPICS — no ideas are written yet, so nothing is spent on topics you'd have killed.",
    ai: "The machine clusters and scores. It does NOT decide what you publish — it hands you a ranked candidate list and shows the score breakdown behind every one.",
    human: "Nothing to do here. Run a sweep, then pull the candidates into Shortlist.",
    pipelines: ["trend-detect", "raydar-classify", "raydar-gap", "raydar-rank"],
    steps: [
      "Go to the New Sweep tab and run a sweep (tick a few concepts, press Run the sweep).",
      "Come back here. The topics it found are sitting below as CANDIDATES.",
      "Press ‘Auto-promote the top candidates’ — or tick the ones you like and press ‘Promote ticked’.",
    ],
    you_get: "A shortlist of topics, each with a score and the reason behind it.",
    then: "Nothing has been written or committed yet — you're just choosing what to look at properly.",
  },
  {
    id: "shortlist", n: "02", title: "Shortlist", owner: "Content", short: "you decide what lives",
    why: "This is the cheapest place to say no. Killing a weak topic here costs nothing; killing it after a brief has been written costs a person's afternoon.",
    does: "Every candidate gets a verdict — keep, kill, merge, park, or refresh-existing. You can add your own topic that the radar never saw. Bulk-select to clear a screen in one click.",
    ai: "The machine only proposes an order — every verdict is yours, and each one is recorded with your name and the time on the topic's timeline. (It does NOT yet cross-check what you've already published; that arrives when Search Console is connected.)",
    human: "GATE — a topic only moves to Dump when you mark it keep or refresh.",
    pipelines: ["raydar-rank"],
    steps: [
      "Read down the list. Each row is one topic idea.",
      "Give every row a verdict: Keep (we'll do this), Refresh (we've done it — update it), Merge (same as another), Park (later), Kill (no).",
      "To clear several at once: tick the boxes, then press the verdict button at the top.",
      "Missing something obvious? Press ‘+ Add a topic the radar missed’ and type it in yourself.",
    ],
    you_get: "Only the topics you said Keep or Refresh move on. Everything else stops here.",
    then: "Your Keeps land at station 03, where SEO adds their research.",
  },
  {
    id: "dump", n: "03", title: "Dump", owner: "SEO", short: "drop your research in",
    why: "SEO already does demand validation in their own tools. RayDar shouldn't buy a second keyword API and do it again badly — it should read what you already made.",
    does: "Drop an export — Ahrefs, Semrush, Search Console, a SERP snapshot, a PAA list, even a PDF audit. Dump AI works out which column is which, pulls typed rows (keyword, volume, difficulty, intent, position, URL) and attaches them to the right shortlisted topic.",
    ai: "A format it recognises is parsed by rules — deterministic, instant, no model call, no cost. Only a NEW format costs one call, and what it learns is saved so that format is free forever after. Anything it can't confidently match to a topic is put in front of you rather than guessed.",
    human: "GATE — confirm the low-confidence attachments. Everything else is already done.",
    pipelines: ["raydar-dump"],
    steps: [
      "Open whatever research SEO already has — an Ahrefs or Semrush export, a Search Console download, a SERP screenshot list, a PDF audit.",
      "Either paste it into the box, or press the ⤒ button and pick the file. Don't tidy it up first — messy is fine.",
      "Press ‘Read this dump’. RayDar tells you what it found and which topic it attached it to.",
      "If it says it wasn't sure, pick the right topic from the dropdown next to that dump. That's the only thing it needs from you.",
    ],
    you_get: "Your keywords, volumes, difficulty and positions, attached to the right topic — not sitting in someone's Downloads folder.",
    then: "Once a topic has research on it, press ‘Build the brief →’ and station 04 writes it up.",
  },
  {
    id: "brief", n: "04", title: "Brief", owner: "SEO", short: "the handover artifact",
    why: "This is the thing Content is actually waiting for. Until it's approved and dated, a topic isn't work — it's a good intention.",
    does: "Assembles the brief from the dumped research plus the feed signal: primary and secondary keywords, search intent, FAQs, People-Also-Ask, AI-Overview opportunity, related searches, competitor gaps, must-cover points, metadata and internal links. You edit anything before approving.",
    ai: "Every keyword and number comes from YOUR dump — if the dump has no volumes, the brief shows none rather than inventing them. The machine arranges; it does not research.",
    human: "GATE — approve the brief. That stamps it with a time and an owner and releases it to Content.",
    pipelines: ["raydar-brief", "raydar-contradiction"],
    steps: [
      "Read the brief below — keywords, questions to answer, what competitors missed, the meta title and description.",
      "Not right? Press ‘↻ Rebuild from the dump’, or dump more research at station 03 and rebuild.",
      "Happy? Press ‘✓ Approve — release to Content’.",
    ],
    you_get: "A dated, owned brief a writer can pick up without asking anyone a single question.",
    then: "It moves to station 05, where you put a name and a date on it.",
  },
  {
    id: "assign", n: "05", title: "Assign", owner: "Content", short: "who's writing it, by when",
    why: "A brief with no name against it is where content pipelines quietly die. This is the only station with a clock.",
    does: "Put a writer and a due date on the brief and track it to done. RayDar deliberately does not write the piece — the craft stays with your team.",
    ai: "None. This station is pure tracking, on purpose.",
    human: "Assign a writer and a date; mark it done when it's filed.",
    pipelines: [],
    steps: [
      "Press ‘Assign a writer’ and type their name.",
      "Add a due date (or leave it blank).",
      "When the piece goes live, press ‘It's live →’ and paste the URL.",
    ],
    you_get: "A clear view of who owes what, and by when.",
    then: "The published URL goes into station 06 and starts teaching the radar.",
  },
  {
    id: "live", n: "06", title: "Live + Learn", owner: "SEO", short: "did the bet pay?",
    why: "Without this, the ranking never actually learns — it just claims to. This is the step that turns last quarter's results into next month's better shortlist.",
    does: "Capture the published URL. Performance (clicks, impressions, position) is read back from your own-content index and feeds the historical term of the composite score.",
    ai: "Deterministic arithmetic, no model call. Connect Search Console and this fills itself; until then you can paste the numbers.",
    human: "Paste the URL when it goes live.",
    pipelines: ["raydar-performance"],
    steps: [
      "Nothing to do — pieces land here when you mark them live at station 05.",
      "Later, add the clicks and impressions from Search Console (or connect it once and it fills itself).",
    ],
    you_get: "A record of what you published and how it did.",
    then: "Next month's sweep knows you've already covered these, and pushes the topics that actually worked.",
  },
];

// ---------------------------------------------------------------------------
// DUMP AI — deterministic first, model only for genuinely new shapes.
// ---------------------------------------------------------------------------
const NUM = (v) => { const n = Number(String(v ?? "").replace(/[,%\s₹$]/g, "")); return Number.isFinite(n) ? n : null; };
const splitRow = (line) => line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)|\||;/).map((c) => c.trim().replace(/^["']|["']$/g, "").trim());

// Read the header row and see whether it matches a shape we already know.
// Returns {shape_id, label, colmap, confidence} or null when nothing fits.
function matchShape(header, shapes) {
  const heads = header.map((h) => h.toLowerCase().trim()).filter(Boolean);
  let best = null;
  for (const s of shapes) {
    const sig = (s.signature || []).map((x) => String(x).toLowerCase());
    if (!sig.length) continue;
    const hit = sig.filter((tok) => heads.some((h) => h === tok || h.includes(tok))).length;
    const conf = hit / sig.length;
    if (conf >= 0.5 && (!best || conf > best.confidence)) best = { shape_id: s.shape_id, label: s.label, colmap: s.colmap || {}, confidence: Number(conf.toFixed(2)) };
  }
  return best;
}

// Apply a known colmap to the table → typed rows. No model call, ever.
function rowsFromColmap(header, lines, colmap) {
  const heads = header.map((h) => h.toLowerCase().trim());
  const idx = {};
  for (const [field, col] of Object.entries(colmap || {})) {
    const i = heads.findIndex((h) => h === String(col).toLowerCase() || h.includes(String(col).toLowerCase()));
    if (i >= 0) idx[field] = i;
  }
  if (idx.keyword === undefined && idx.question === undefined) return [];
  const out = [];
  for (const line of lines) {
    const c = splitRow(line);
    const kw = c[idx.keyword ?? idx.question];
    if (!kw || kw.length < 3) continue;
    const row = { keyword: kw.toLowerCase() };
    if (idx.volume !== undefined) row.volume = NUM(c[idx.volume]);
    if (idx.kd !== undefined) row.kd = NUM(c[idx.kd]);
    if (idx.position !== undefined) row.position = NUM(c[idx.position]);
    if (idx.clicks !== undefined) row.clicks = NUM(c[idx.clicks]);
    if (idx.impressions !== undefined) row.impressions = NUM(c[idx.impressions]);
    if (idx.intent !== undefined && c[idx.intent]) row.intent = c[idx.intent];
    if (idx.url !== undefined && c[idx.url]) row.url = c[idx.url];
    out.push(row);
    if (out.length >= 500) break;
  }
  return out;
}

// The full read: try a known shape (free) → else ask the model once and LEARN
// the shape so the next file of this kind is free too.
export async function readDump(text) {
  const lines = String(text || "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], shape_id: null, confidence: 0, learned: false };
  const shapes = (await jq(`select shape_id,label,signature,colmap from wh_dump_shape`)).rows;

  // header is usually the first line that splits into >1 cell
  const hIdx = lines.findIndex((l) => splitRow(l).length > 1);
  if (hIdx >= 0) {
    const header = splitRow(lines[hIdx]);
    const m = matchShape(header, shapes);
    if (m) {
      const rows = rowsFromColmap(header, lines.slice(hIdx + 1), m.colmap);
      if (rows.length) {
        await jq(`update wh_dump_shape set uses = uses + 1 where shape_id=$1`, [m.shape_id]);
        return { rows, shape_id: m.shape_id, label: m.label, confidence: m.confidence, learned: false, mode: "deterministic" };
      }
    }
  }

  // unknown shape → one model call, then write the shape back for next time
  const sample = lines.slice(0, 40).join("\n").slice(0, 6000);
  const out = await runPipeline("raydar-dump", { user: sample, maxTokens: 1600 });
  const j = out.mode === "ai" ? jsonFrom(out.text) : null;
  if (!j) {
    // last resort: keep the phrases so the dump is never silently lost
    const rows = lines.flatMap(splitRow)
      .map((c) => c.toLowerCase().trim())
      .filter((c) => { const w = c.split(/\s+/); return w.length >= 2 && w.length <= 7 && c.length >= 5 && c.length <= 70 && /[a-z]/i.test(c) && !/^https?:|^www\./i.test(c) && !/^[\d.,%$₹\s]+$/.test(c); })
      .slice(0, 200).map((keyword) => ({ keyword }));
    return { rows: [...new Map(rows.map((r) => [r.keyword, r])).values()], shape_id: null, confidence: rows.length ? 0.3 : 0, learned: false, mode: out.mode === "ai" ? "fallback" : out.mode };
  }
  const rows = Array.isArray(j.rows) ? j.rows.filter((r) => r && r.keyword).slice(0, 500) : [];
  const questions = Array.isArray(j.questions) ? j.questions.slice(0, 60) : [];
  let shapeId = null, learned = false;
  if (j.shape?.colmap && Object.keys(j.shape.colmap).length) {
    shapeId = String(j.shape.label || "learned").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "learned";
    await jq(`insert into wh_dump_shape(shape_id,label,signature,colmap,learned_by,uses) values($1,$2,$3,$4::jsonb,'ai',1)
              on conflict (shape_id) do update set colmap=excluded.colmap, uses=wh_dump_shape.uses+1`,
      [shapeId, j.shape.label || "Learned export", Object.values(j.shape.colmap).map(String), JSON.stringify(j.shape.colmap)]);
    learned = true;
  }
  return { rows, questions, shape_id: shapeId, label: j.shape?.label, confidence: Number(j.confidence) || 0.6, learned, mode: "ai" };
}

// Attach parsed keywords to the shortlisted topic they best belong to. Scores
// by term overlap against the topic's own search terms + heading. Anything weak
// goes to the confirm queue instead of being guessed into the wrong topic.
function bestTopic(rows, stories) {
  const words = new Set(rows.slice(0, 120).flatMap((r) => String(r.keyword || "").split(/\s+/)).filter((w) => w.length > 3));
  let best = null;
  for (const s of stories) {
    const hay = `${s.heading || ""} ${s.demand_topic || ""} ${(s.terms || []).join(" ")}`.toLowerCase();
    const hits = [...words].filter((w) => hay.includes(w)).length;
    const conf = words.size ? hits / Math.min(words.size, 25) : 0;
    if (!best || conf > best.confidence) best = { story_id: s.id, heading: s.heading, confidence: Number(Math.min(1, conf).toFixed(2)) };
  }
  return best;
}

// ---------------------------------------------------------------------------
export function mountJourney(app, upload) {
  // one helper — every act is journalled, nothing writes state without a trace
  const ev = (story_id, batch_id, action, extra = {}) =>
    jq(`insert into wh_story_event(story_id,batch_id,actor,action,from_stage,to_stage,field,before_val,after_val,note)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [story_id || null, batch_id || null, extra.actor || "operator", action, extra.from || null, extra.to || null,
       extra.field || null, extra.before == null ? null : String(extra.before), extra.after == null ? null : String(extra.after), extra.note || null]);

  // ---- THEMES — described in the team's words, compiled into pipeline logic
  // The content team never writes search syntax. They describe the theme; this
  // turns the description into the terms the sweep fires, the sub-series it
  // routes to, and what counts as on/off-theme. Nothing saves without a human
  // pressing save — the compile step only PROPOSES.
  app.get("/api/wh/themes", async (_req, res) => {
    const themes = (await jq(`select id, name, question, description, definition, franchise, series, format_home,
                                     strategic_weight, terms, compiled, compiled_at, notes, active
                                from wh_demand_topic order by active desc, id`)).rows;
    const series = (await jq(`select name, parent, stage, format_home, blurb, active from wh_franchise order by (parent is not null), id`)).rows;
    res.json({ themes, series });
  });

  // describe → compile. Returns a PROPOSAL; the UI shows it for confirmation.
  app.post("/api/wh/theme/compile", async (req, res) => {
    const { name, description, franchise } = req.body || {};
    if (!description || !String(description).trim()) return res.status(400).json({ error: "describe the theme first — a sentence or two in your own words" });
    const series = (await jq(`select name, parent, blurb from wh_franchise where active`)).rows;
    const user = [
      `THEME: ${name || "(unnamed)"}`,
      franchise ? `ROUTES TO (the team's pick): ${franchise}` : "",
      "",
      "THE CONTENT TEAM DESCRIBES IT AS:",
      String(description).trim(),
      "",
      "AVAILABLE SUB-SERIES TO ROUTE TO:",
      series.map((s) => `· ${s.name}${s.parent ? ` (part of ${s.parent})` : ""} — ${s.blurb || ""}`).join("\n"),
    ].filter(Boolean).join("\n");

    const out = await runPipeline("raydar-theme-compile", { user, maxTokens: 1400 });
    const j = out.mode === "ai" ? jsonFrom(out.text) : null;
    if (!j) {
      // no key / disabled → a deterministic starting point from their own words,
      // so the screen is never a dead end. Clearly labelled as not-AI.
      const words = String(description).toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
      const stop = new Set("the a an and or for with that this what how why you your they them their are is be of to in on at it its as from into over about very more most just only than then when which who whom whose there here".split(" "));
      const keys = [...new Set(words.filter((w) => !stop.has(w) && w.length > 3))].slice(0, 8);
      // NEVER invent queries here. The old fallback emitted "<word> india" for
      // every distinctive word, which produced terms like "number india" and
      // "asking india" — and those pulled viral Indian cricket and comedy into
      // the feed. A bad search term is worse than none: say so and stop.
      return res.json({
        ok: true, mode: out.mode,
        compiled: { terms: [], franchise: franchise || null, question: null, registers: [], on_theme: keys, off_theme: [],
          why: "No AI model is enabled, so RayDar cannot work out the search terms from your description. Type them yourself below — short phrases a job seeker would actually search, e.g. \"salary negotiation india\", \"ats resume format\". Guessed terms do more harm than none." },
      });
    }
    res.json({ ok: true, mode: out.mode, compiled: { ...j, terms: (j.terms || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 12) } });
  });

  // save the confirmed theme — the compiled TERMS become what the sweep fires
  app.post("/api/wh/theme/save", async (req, res) => {
    const { old_name, name, description, franchise, series, question, strategic_weight, terms, compiled, active } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    const arr = Array.isArray(terms) ? terms : String(terms || "").split(",").map((t) => t.trim()).filter(Boolean);
    const key = old_name || name;
    const exists = (await jq(`select 1 from wh_demand_topic where name=$1`, [key])).rows.length;
    if (exists) {
      await jq(`update wh_demand_topic set name=$2, description=$3, franchise=coalesce($4,franchise), series=coalesce($5,series),
                       question=coalesce($6,question), strategic_weight=coalesce($7,strategic_weight), terms=$8,
                       compiled=coalesce($9::jsonb,compiled), compiled_at=case when $9 is null then compiled_at else now() end,
                       active=coalesce($10,active)
                 where name=$1`,
        [key, name, description || null, franchise || null, series || null, question || null,
         strategic_weight != null ? Number(strategic_weight) : null, arr,
         compiled ? JSON.stringify(compiled) : null, active == null ? null : !!active]);
    } else {
      await jq(`insert into wh_demand_topic(name, description, franchise, series, question, strategic_weight, terms, compiled, compiled_at, source, active)
                values($1,$2,$3,$4,$5,$6,$7,$8::jsonb, case when $8 is null then null else now() end, 'user', true)`,
        [name, description || null, franchise || null, series || "1Up", question || null,
         strategic_weight != null ? Number(strategic_weight) : 1, arr, compiled ? JSON.stringify(compiled) : null]);
    }
    res.json({ ok: true });
  });

  app.post("/api/wh/theme/:name/active", async (req, res) => {
    await jq(`update wh_demand_topic set active=$2 where name=$1`, [req.params.name, !!req.body?.active]);
    res.json({ ok: true });
  });

  // ---- the station handbook (explainable AI, one source of truth) ---------
  app.get("/api/wh/journey/stations", (_req, res) => res.json({ stations: STATIONS }));

  // ---- preset chips (season · push · verdict · owner · dumpkind) ----------
  app.get("/api/wh/journey/chips", async (_req, res) =>
    res.json({ chips: (await jq(`select kind,value,meta from wh_journey_chip where active order by id`)).rows }));
  app.post("/api/wh/journey/chip", async (req, res) => {
    const { kind, value, meta } = req.body || {};
    if (!kind || !value) return res.status(400).json({ error: "kind + value required" });
    await jq(`insert into wh_journey_chip(kind,value,meta) values($1,$2,$3::jsonb)
              on conflict (kind,value) do update set meta=excluded.meta, active=true`, [kind, value, JSON.stringify(meta || {})]);
    res.json({ ok: true });
  });
  app.post("/api/wh/journey/chip/delete", async (req, res) => {
    await jq(`update wh_journey_chip set active=false where kind=$1 and value=$2`, [req.body?.kind, req.body?.value]);
    res.json({ ok: true });
  });

  // ---- the board: every story in this batch, grouped by station ----------
  app.get("/api/wh/journey/:batchId", async (req, res) => {
    const batchId = Number(req.params.batchId);
    const stories = (await jq(
      `select s.id, s.heading, s.summary, s.demand_topic, s.franchise, s.stage, s.verdict, s.owner_team,
              s.assignee, s.due_at, s.published_url, s.brief, s.brief_at, s.score, s.score_breakdown,
              s.gap_type, s.emotional_register, s.status, s.selected, s.merged_into,
              -- ::int matters: count(*) is bigint, which node-postgres returns as a
              -- STRING. "0" is truthy in JS, so every count-based test silently
              -- inverted (the "dump research first" hint never showed, and every
              -- row read "1 dumps"). Cast here, once, rather than coerce per use.
              (select count(*) from wh_seo_input d where d.story_id = s.id)::int as dumps,
              (select count(*) from wh_story_event e where e.story_id = s.id)::int as events
         from wh_feed_story s
        where s.batch_id=$1 and s.stage is not null and s.status <> 'deleted'
        order by s.score desc nulls last, s.id`, [batchId])).rows;
    const candidates = (await jq(
      `select id, heading, summary, demand_topic, franchise, score, score_breakdown, gap_type
         from wh_feed_story
        where batch_id=$1 and stage is null and status <> 'deleted'
        order by score desc nulls last limit 60`, [batchId])).rows;
    const dumps = (await jq(
      `select id, kind, filename, shape_id, confidence, status, story_id,
              coalesce(jsonb_array_length(parsed->'rows'),0)::int as rows
         from wh_seo_input where batch_id=$1 order by id desc`, [batchId])).rows;
    const batch = (await jq(`select id,name,created_at,swept_at from wh_batch where id=$1`, [batchId])).rows[0] || null;
    const counts = Object.fromEntries(STAGES.map((s) => [s, stories.filter((x) => x.stage === s).length]));
    res.json({ batch, stations: STATIONS, stories, candidates, dumps, counts });
  });

  // ---- 01 → 02 · promote sweep candidates into the shortlist -------------
  app.post("/api/wh/journey/:batchId/promote", async (req, res) => {
    const batchId = Number(req.params.batchId);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    let rows = [];
    if (ids.length) {
      rows = (await jq(`update wh_feed_story set stage='shortlist', owner_team='Content'
                         where batch_id=$1 and id = any($2::int[]) and stage is null returning id`, [batchId, ids])).rows;
    } else {
      // shortcut: auto-promote the top N over the score floor, per the journey rule
      const rule = (await jq(`select rule from wh_business_rule where name='journey_lane'`)).rows[0]?.rule || {};
      const ap = rule.auto_promote || {};
      rows = (await jq(`update wh_feed_story set stage='shortlist', owner_team='Content'
                         where id in (select id from wh_feed_story
                                       where batch_id=$1 and stage is null and status <> 'deleted'
                                         and coalesce(score,0) >= $2
                                       order by score desc nulls last limit $3) returning id`,
        [batchId, Number(ap.min_score ?? 0.35), Number(ap.top_n ?? 12)])).rows;
    }
    for (const r of rows) await ev(r.id, batchId, "promote", { to: "shortlist", actor: "raydar", note: ids.length ? "picked by operator" : "auto-promoted over the score floor" });
    res.json({ ok: true, promoted: rows.length });
  });

  // ---- 02 · add your own topic (the radar can't see everything) ----------
  app.post("/api/wh/journey/:batchId/topic", async (req, res) => {
    const batchId = Number(req.params.batchId);
    const { heading, demand_topic, franchise, note } = req.body || {};
    if (!heading) return res.status(400).json({ error: "heading required" });
    const r = (await jq(`insert into wh_feed_story(batch_id, heading, demand_topic, franchise, stage, owner_team, status, summary, score)
                         values($1,$2,$3,$4,'shortlist','Content','draft',$5,0) returning id`,
      [batchId, heading, demand_topic || null, franchise || null, note || "Added by the content team — not from the radar."])).rows[0];
    if (r) await ev(r.id, batchId, "promote", { to: "shortlist", note: "added by hand — outside the radar" });
    res.json({ ok: true, id: r?.id });
  });

  // ---- 02 · verdict (single or bulk) ------------------------------------
  app.post("/api/wh/journey/verdict", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    const v = String(req.body?.verdict || "");
    if (!ids.length || !v) return res.status(400).json({ error: "ids + verdict required" });
    const advances = v === "keep" || v === "refresh";
    for (const id of ids) {
      const cur = (await jq(`select stage, verdict, batch_id from wh_feed_story where id=$1`, [id])).rows[0] || {};
      if (v === "kill") await jq(`update wh_feed_story set verdict='kill', status='deleted', selected=false where id=$1`, [id]);
      else await jq(`update wh_feed_story set verdict=$2, stage=$3, owner_team=$4, selected=false where id=$1`,
        [id, v, advances ? "dump" : cur.stage || "shortlist", advances ? "SEO" : "Content"]);
      await ev(id, cur.batch_id, "verdict", { from: cur.stage, to: advances ? "dump" : cur.stage, field: "verdict", before: cur.verdict, after: v, note: req.body?.note || null });
    }
    res.json({ ok: true, updated: ids.length });
  });

  // ---- bulk select toggle (shortcut) ------------------------------------
  app.post("/api/wh/journey/select", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    await jq(`update wh_feed_story set selected=$2 where id = any($1::int[])`, [ids, !!req.body?.on]);
    res.json({ ok: true });
  });

  // ---- 03 · the DUMP: paste or upload research, Dump AI reads it ---------
  const ingest = async (batchId, { text, filename, kind }) => {
    const read = await readDump(text);
    const stories = (await jq(
      `select s.id, s.heading, s.demand_topic, coalesce(t.terms,'{}') as terms
         from wh_feed_story s left join wh_demand_topic t on t.name = s.demand_topic
        where s.batch_id=$1 and s.stage in ('dump','brief') and s.status <> 'deleted'`, [batchId])).rows;
    const match = read.rows.length && stories.length ? bestTopic(read.rows, stories) : null;
    // confident match attaches itself; a weak one waits for a human
    const attach = match && match.confidence >= 0.25 ? match : null;
    const parsed = { rows: read.rows, questions: read.questions || [], mode: read.mode, learned: read.learned, label: read.label || null, match };
    const r = (await jq(
      `insert into wh_seo_input(kind, content, batch_id, story_id, filename, shape_id, parsed, confidence, status)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) returning id`,
      [kind || "Keyword export", read.rows.map((x) => x.keyword).join("\n").slice(0, 20000), batchId,
       attach?.story_id || null, filename || null, read.shape_id, JSON.stringify(parsed),
       attach?.confidence ?? match?.confidence ?? 0, attach ? "attached" : "confirm"])).rows[0];
    if (attach) await ev(attach.story_id, batchId, "dump-attach", { actor: "raydar", note: `${read.rows.length} rows from ${filename || "paste"} · ${read.mode}${read.shape_id ? ` · shape ${read.shape_id}` : ""}` });
    return { id: r?.id, ...read, match, attached: !!attach };
  };

  app.post("/api/wh/journey/:batchId/dump", async (req, res) => {
    const { content, kind } = req.body || {};
    if (!content) return res.status(400).json({ error: "content required" });
    try { res.json({ ok: true, ...(await ingest(Number(req.params.batchId), { text: content, kind })) }); }
    catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 140) }); }
  });

  app.post("/api/wh/journey/:batchId/dump-file", upload.single("file"), async (req, res) => {
    try {
      const f = req.file; if (!f) return res.status(400).json({ error: "no file" });
      const ex = await extractFile(f.path, f.originalname);
      const text = ex.text || (ex.sheets || []).map((s) => s.csv || "").join("\n");
      res.json({ ok: true, ...(await ingest(Number(req.params.batchId), { text, filename: f.originalname, kind: req.body?.kind })) });
    } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 140) }); }
    finally { if (req.file?.path) rmSync(req.file.path, { force: true }); }
  });

  // resolve the confirm queue — put a dump on the topic YOU say it belongs to
  app.post("/api/wh/journey/dump/:id/attach", async (req, res) => {
    const id = Number(req.params.id), storyId = Number(req.body?.story_id) || null;
    const d = (await jq(`select batch_id, filename from wh_seo_input where id=$1`, [id])).rows[0] || {};
    await jq(`update wh_seo_input set story_id=$2, status=$3 where id=$1`, [id, storyId, storyId ? "attached" : "confirm"]);
    if (storyId) await ev(storyId, d.batch_id, "dump-attach", { note: `confirmed by hand · ${d.filename || "paste"}` });
    res.json({ ok: true });
  });
  app.get("/api/wh/journey/dump/:id", async (req, res) =>
    res.json({ dump: (await jq(`select * from wh_seo_input where id=$1`, [Number(req.params.id)])).rows[0] || null }));

  // ---- 04 · build the brief FROM the dump (never from fresh research) ----
  app.post("/api/wh/journey/story/:id/brief", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select id, batch_id, heading, summary, demand_topic, franchise, emotional_register, why_now, stage from wh_feed_story where id=$1`, [id])).rows[0];
    if (!s) return res.status(404).json({ error: "unknown story" });
    const dumps = (await jq(`select filename, shape_id, parsed from wh_seo_input where story_id=$1`, [id])).rows;
    const rows = dumps.flatMap((d) => d.parsed?.rows || []);
    const questions = dumps.flatMap((d) => d.parsed?.questions || []);
    const rule = (await jq(`select rule from wh_business_rule where name='journey_lane'`)).rows[0]?.rule || {};
    if ((rule.dump_required_before_brief ?? true) && !rows.length)
      return res.status(400).json({ error: "no research dumped for this topic yet — station 03 feeds station 04" });

    const user = [
      `TOPIC: ${s.heading}`,
      s.demand_topic ? `DEMAND CONCEPT: ${s.demand_topic}` : "",
      s.franchise ? `1UP FRANCHISE: ${s.franchise}` : "",
      s.emotional_register ? `REGISTER: ${s.emotional_register}` : "",
      s.why_now ? `WHY NOW: ${s.why_now}` : "",
      "",
      `RESEARCH DUMP (${rows.length} rows${dumps.length ? ` from ${dumps.map((d) => d.filename || d.shape_id || "paste").join(", ")}` : ""}):`,
      rows.slice(0, 120).map((r) => [r.keyword, r.volume != null ? `vol ${r.volume}` : "", r.kd != null ? `kd ${r.kd}` : "", r.position != null ? `pos ${r.position}` : "", r.intent || ""].filter(Boolean).join(" · ")).join("\n"),
      questions.length ? `\nQUESTIONS FROM THE DUMP:\n${questions.slice(0, 40).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const out = await runPipeline("raydar-brief", { user, maxTokens: 2200 });
    const j = out.mode === "ai" ? jsonFrom(out.text) : null;
    // deterministic fallback so the station still produces a real artifact with
    // no key — built purely from the dump, nothing invented
    const brief = j || {
      primary_keyword: rows[0]?.keyword || s.heading,
      secondary_keywords: rows.slice(1, 12).map((r) => r.keyword),
      search_intent: rows[0]?.intent || null,
      faqs: questions.slice(0, 8),
      paa: questions.slice(0, 8),
      ai_overview: null,
      related_searches: rows.slice(12, 24).map((r) => r.keyword),
      competitor_gaps: [],
      must_cover: [],
      metadata: { title: String(s.heading || "").slice(0, 60), description: String(s.summary || "").slice(0, 155), slug: String(s.heading || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) },
      internal_links: [],
      _built: out.mode === "ai" ? "ai" : `${out.mode} — assembled from the dump only`,
    };
    brief._sources = dumps.map((d) => d.filename || d.shape_id || "paste");
    brief._rows = rows.length;
    await jq(`update wh_feed_story set brief=$2::jsonb, stage='brief', owner_team='SEO' where id=$1`, [id, JSON.stringify(brief)]);
    await ev(id, s.batch_id, "brief", { from: s.stage, to: "brief", actor: out.mode === "ai" ? "raydar" : "raydar", note: `built from ${rows.length} dumped rows · ${out.mode}` });
    res.json({ ok: true, brief, mode: out.mode });
  });

  // edit + approve the brief (the gate that releases it to Content)
  app.post("/api/wh/journey/story/:id/brief/save", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select batch_id from wh_feed_story where id=$1`, [id])).rows[0] || {};
    await jq(`update wh_feed_story set brief=$2::jsonb where id=$1`, [id, JSON.stringify(req.body?.brief || {})]);
    await ev(id, s.batch_id, "edit", { field: "brief", note: "brief edited by hand" });
    res.json({ ok: true });
  });
  app.post("/api/wh/journey/story/:id/approve", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select batch_id, stage from wh_feed_story where id=$1`, [id])).rows[0] || {};
    await jq(`update wh_feed_story set stage='assign', owner_team='Content', brief_at=now(), status='approved' where id=$1`, [id]);
    await ev(id, s.batch_id, "stage", { from: s.stage, to: "assign", note: "brief approved — released to Content" });
    res.json({ ok: true });
  });

  // ---- 05 · assign a writer + a date -----------------------------------
  app.post("/api/wh/journey/story/:id/assign", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select batch_id, assignee, stage from wh_feed_story where id=$1`, [id])).rows[0] || {};
    const { assignee, due_at } = req.body || {};
    await jq(`update wh_feed_story set assignee=$2, due_at=$3, stage='assign' where id=$1`, [id, assignee || null, due_at || null]);
    await ev(id, s.batch_id, "assign", { from: s.stage, to: "assign", field: "assignee", before: s.assignee, after: assignee, note: due_at ? `due ${String(due_at).slice(0, 10)}` : null });
    res.json({ ok: true });
  });

  // ---- 06 · it went live; performance flows back into the ranking -------
  app.post("/api/wh/journey/story/:id/publish", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select batch_id, stage, heading, demand_topic from wh_feed_story where id=$1`, [id])).rows[0] || {};
    const { url, clicks, impressions, position } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });
    await jq(`update wh_feed_story set published_url=$2, stage='live', feedback='used', status='approved' where id=$1`, [id, url]);
    await jq(`insert into wh_own_content(url, title, topic, clicks, impressions, position, published_at)
              values($1,$2,$3,$4,$5,$6, current_date)
              on conflict (url) do update set clicks=excluded.clicks, impressions=excluded.impressions,
                                              position=excluded.position, refreshed_at=now()`,
      [url, s.heading || null, s.demand_topic || null, clicks ?? null, impressions ?? null, position ?? null]);
    await ev(id, s.batch_id, "publish", { from: s.stage, to: "live", field: "published_url", after: url, note: "indexed into own-content — future sweeps will flag this as already covered" });
    res.json({ ok: true });
  });

  // ---- the timeline: every act on this topic, oldest first --------------
  app.get("/api/wh/journey/story/:id/events", async (req, res) =>
    res.json({ events: (await jq(`select actor,action,from_stage,to_stage,field,before_val,after_val,note,at
                                    from wh_story_event where story_id=$1 order by at, id`, [Number(req.params.id)])).rows }));

  // ---- THE DETAILED STORY OUTLINE ---------------------------------------
  // The deep layer under "why this story": a concrete, section-by-section
  // outline built from the REAL comments collected for this theme and the
  // storyline of the video already winning attention — with the evidence for
  // every claim quoted underneath. Generated on demand, stored, so opening it
  // twice is free and a sweep never pays for eighteen of them.
  app.post("/api/wh/story/:id/outline", async (req, res) => {
    const id = Number(req.params.id);
    const s = (await jq(`select id, batch_id, heading, summary, demand_topic, franchise, emotional_register,
                                why_now, why_relevant, evidence, topic_guide, outline, gap_type, score_breakdown, source_refs
                           from wh_feed_story where id=$1`, [id])).rows[0];
    if (!s) return res.status(404).json({ error: "unknown idea" });
    if (s.outline && !req.body?.regenerate) return res.json({ ok: true, outline: s.outline, cached: true });

    // the real audience voice + what is already winning, straight from the sweep
    const fs = (await jq(`select feed_signal from wh_batch where id=$1`, [s.batch_id])).rows[0]?.feed_signal;
    const kept = Array.isArray(fs) ? fs : (fs?.kept || []);
    // Grounding must not fail on an exact-match miss. Try narrowest first, then
    // widen: this theme's rows → the whole sweep's rows → the raw feed items for
    // this batch (which carry meta.comments even on sweeps predating `qs`).
    // START FROM THE VIDEOS THAT ACTUALLY MADE THIS HEADLINE. source_refs holds
    // the exact items this idea was grounded in, so their comments are the ones
    // that belong in its outline — a comment from an unrelated video in the same
    // sweep is not evidence for THIS story. Only widen if those carry nothing.
    const srcUrls = new Set((s.source_refs || []).map((r) => r && r.url).filter(Boolean));
    let mine = kept.filter((k) => srcUrls.has(k.url));
    let scope = "the videos behind this headline";
    if (!mine.some((k) => (k.qs || []).length)) {
      mine = kept.filter((k) => k.topic === s.demand_topic); scope = "this theme";
    }
    if (!mine.some((k) => (k.qs || []).length)) { mine = kept; scope = "this sweep"; }
    let comments = [...new Set(mine.flatMap((k) => k.qs || []))].slice(0, 30);
    if (!comments.length) {
      // last resort: read the comments straight off the collected items
      const isQ = (t) => /\?|\bhow\b|\bwhy\b|\bwhat\b|\bwhich\b|\bshould i\b|\bcan i\b/i.test(String(t || ""));
      const raw = (await jq(`select meta from wh_feed_item where meta ? 'comments' order by id desc limit 400`)).rows;
      comments = [...new Set(raw.flatMap((r) => (r.meta?.comments || []))
        .map((c) => String(c).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
        .filter((c) => isQ(c) && c.length > 12 && c.length < 220))].slice(0, 30);
      if (comments.length) scope = "the collected feed";
    }
    const winner = kept.filter((k) => srcUrls.has(k.url))[0] || kept.filter((k) => k.topic === s.demand_topic)[0] || kept[0] || null;

    const user = [
      `IDEA: ${s.heading}`,
      s.summary ? `SUMMARY: ${s.summary}` : "",
      `THEME: ${s.demand_topic} · SERIES: ${s.franchise}${s.emotional_register ? ` · REGISTER: ${s.emotional_register}` : ""}`,
      s.why_now ? `WHY NOW: ${s.why_now}` : "",
      s.topic_guide?.take ? `THE TAKE SO FAR: ${s.topic_guide.take}` : "",
      (s.topic_guide?.beats || []).length ? `BEATS SO FAR:\n${(s.topic_guide.beats).map((b) => `- ${b}`).join("\n")}` : "",
      "",
      srcUrls.size ? `THE VIDEOS THIS IDEA WAS BUILT FROM (its evidence — the comments below come from these):\n${(s.source_refs || []).filter((r) => r && r.url).slice(0, 6).map((r) => `- "${r.title || r.url}" (${r.source || "source"})`).join("\n")}` : "",
      "",
      winner ? `THE VIDEO CURRENTLY WINNING ON THIS SUBJECT:\n"${winner.title}" — ${winner.views} views in ${winner.ageDays} days${winner.questions ? `, ${winner.questions} question-comments` : ""}. ${winner.url}` : "No live winner captured for this theme.",
      "",
      comments.length
        ? `WHAT THE AUDIENCE ACTUALLY ASKED (verbatim, from the comments in ${scope} — ${comments.length} of them):\n${comments.map((c) => `- "${c}"`).join("\n")}`
        : "NO audience comments are available for this idea. Do NOT invent quotes, and do NOT write about the absence of comments — the reader does not need an apology. Build the outline from the idea, the take and the beats, and in evidence_summary give the argument for why this story stands on its own reasoning.",
      s.evidence ? `\nRESEARCH EVIDENCE ON FILE: ${s.evidence}` : "",
    ].filter(Boolean).join("\n");

    const out = await runPipeline("raydar-story-outline", { user, maxTokens: 3000 });
    const j = out.mode === "ai" ? jsonFrom(out.text) : null;
    if (!j) return res.status(502).json({
      error: out.mode === "error" ? `the model could not be reached — ${String(out.text || "").slice(0, 160)}`
        : out.mode === "disabled" ? "the Detailed Story Outline pipeline is switched off in Admin"
        : "no AI model is available for this step",
      mode: out.mode });

    j._grounding = { comments_used: comments.length, scope, winner: winner ? { title: winner.title, url: winner.url, views: winner.views } : null, model: out.model || null };
    await jq(`update wh_feed_story set outline=$2::jsonb, outline_at=now() where id=$1`, [id, JSON.stringify(j)]);
    res.json({ ok: true, outline: j, cached: false });
  });

  // ---- RECAP — "what actually went into this sweep" ---------------------
  // Reconstructed from what was PERSISTED at sweep time, not from the current
  // screen state, so re-opening an old batch recaps that batch honestly.
  // Used by the express sweep's results page AND by Journey station 01.
  app.get("/api/wh/journey/recap/:batchId", async (req, res) => {
    const batchId = Number(req.params.batchId);
    const b = (await jq(`select id,name,source,routes,demand_topics,hunger,feed_signal,created_at,swept_at,story_count from wh_batch where id=$1`, [batchId])).rows[0];
    if (!b) return res.status(404).json({ error: "unknown batch" });

    // the concepts armed + the exact search terms those concepts fire
    const names = b.demand_topics || [];
    const concepts = names.length
      ? (await jq(`select name, question, franchise, terms, strategic_weight from wh_demand_topic where name = any($1::text[]) order by id`, [names])).rows
      : [];

    // SEO research that was available to this sweep (pre-030 rows have no
    // batch_id — fall back to anything pasted before the batch was created)
    const seo = (await jq(
      `select id, kind, filename, shape_id, created_at,
              coalesce(jsonb_array_length(parsed->'rows'), 0) as rows,
              left(content, 400) as preview
         from wh_seo_input
        where batch_id = $1 or (batch_id is null and created_at <= $2)
        order by id desc limit 20`, [batchId, b.created_at])).rows;

    // which APIs were actually live for this sweep + what they returned
    const fs = b.feed_signal || {};
    const stats = fs.stats || {};
    const feed = {
      sources: stats.sources || {},
      collected: stats.collected ?? null, kept: stats.kept ?? null,
      dropped: stats.dropped ?? null, repeats: stats.repeats ?? null,
      terms_fired: stats.terms ?? null,
      views_analysed: stats.views_analysed ?? null,
      comments_read: stats.comments ?? null,
      questions_found: stats.questions ?? null,
      errors: stats.errors || [],
      dropped_reasons: (fs.dropped || []).reduce((a, d) => { const k = d.reason || "other"; a[k] = (a[k] || 0) + 1; return a; }, {}),
      top_terms: [...new Set((fs.kept || []).map((k) => k.term).filter(Boolean))].slice(0, 12),
    };

    const guard = ((await jq(`select rule from wh_business_rule where name='guardrails'`)).rows[0]?.rule || {}).collection || {};
    const out = (await jq(`select count(*)::int n, count(*) filter (where stage is not null)::int in_journey from wh_feed_story where batch_id=$1 and status<>'deleted'`, [batchId])).rows[0] || {};

    res.json({
      batch: { id: b.id, name: b.name, source: b.source, created_at: b.created_at, swept_at: b.swept_at },
      routes: b.routes || {},
      brief: b.hunger?.extra_prompt || null,        // the operator's free-text "anything more to add?"
      hunger_who: b.hunger?.who || null,
      concepts, seo, feed, guardrails: guard,
      output: { ideas: out.n || 0, in_journey: out.in_journey || 0 },
    });
  });

  // ---- own published inventory (kills the "already covered" rejection) --
  app.get("/api/wh/journey/own-content", async (_req, res) =>
    res.json({ items: (await jq(`select url,title,topic,clicks,impressions,position,published_at from wh_own_content order by published_at desc nulls last limit 200`)).rows }));
}
