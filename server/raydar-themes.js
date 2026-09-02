// RayDar — themes, the deep story outline, and the sweep recap.
//
// These six routes were the only LIVE ones in raydar-journey.js. The Journey lane
// around them (six gated stations, briefs, assignment, publishing, dump shapes)
// was switched off in the UI and is now deleted; these had to come out first or
// the express sweep would have gone with it — the results page reads the recap,
// Demand Setting reads and writes the themes, and "Generate deep idea" reads the
// outline.
//
// /api/wh/journey/recap/:batchId was renamed /api/wh/sweep/recap/:batchId — it
// describes the sweep, and nothing called "journey" survives.
import { q } from "./db/client.js";
import { runPipeline } from "./ai.js";

const jq = (t, p) => q(t, p).catch(() => ({ rows: [] }));
const jsonFrom = (text) => { const m = String(text || "").match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

export function mountThemes(app) {
  // ---- themes + series (Demand Setting AND Settings > Industry & Theme) ----
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

  // ---- the deep story outline ("Generate deep idea") -------------------
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

  // ---- RECAP — "what actually went into this sweep" -------------------
  // Reconstructed from what was PERSISTED at sweep time, not from the current
  // screen state, so re-opening an old batch recaps that batch honestly.
  app.get("/api/wh/sweep/recap/:batchId", async (req, res) => {
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
}
