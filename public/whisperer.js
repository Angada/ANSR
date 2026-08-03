// RayDar — Talent Trend Radar. Standalone (no app.css / no q.js).
// Journey moves LEFT → RIGHT: [01 Hunger] → 02 Sweep(process) → [03 Ideas].
// Step 1 HUNGER = pick/combine 3 routes (Trend Spotting chips · SEO paste ·
// TalentMind sim) → Process → Step 3 ranked, franchise-routed Ideas.
// Talent = job seeker; TalentMind = parsed profile+chips. AI via gated
// pipelines with mock fallback. All endpoints preserved from the prior build.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
// India time (IST) — always show Asia/Kolkata regardless of the viewer's device
// India format, IST — "29-09-2026 · 2:09 pm" (platform standard)
const fmtDT = (ts) => { if (!ts) return ""; const p = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(ts)).reduce((a, x) => ((a[x.type] = x.value), a), {}); return `${p.day}-${p.month}-${p.year} · ${p.hour}:${p.minute} ${(p.dayPeriod || "").toLowerCase()}`; };

let ROUTES = { trend: false, seo: false, talentmind: false };
let TOPICS = [];        // selected trend-spotting demand topics (names)
let ALL_TOPICS = [];    // the 6 (+ Emerging)
let TM = null;          // TalentMind sim: { cohortId, members, hunger, name }
let BATCH = null, FR = "all";
let STAGE = 1;          // 1 hunger · 2 sweeping · 3 ideas
let VIEW = "sweep";     // sweep | batches | library
let FRANCHISES = [];
let EDIT_CONCEPTS = false;
let GUARD = null;       // guardrails (audience · language · region) from business rules
let SWEEP_PROMPT = "";  // the user's free-text "anything more to add?" brief
let RECAP = null;       // "what went into this sweep" — persisted inputs, per batch
let SHOW_DONE = false;
let SERIES_ON = null;   // only one content series may be armed at a time
let IDEA_TH = "all", IDEA_RG = "all", IDEA_GP = "all", IDEA_SORT = "score";  // judged ideas leave the working list (drawer, not deleted)
let JOURNEY = null;     // the Journey board (stations · stories · dumps) for BATCH
// ---- Journey lane: OFF ------------------------------------------------------
// The six-station tracked lane is built and working, but not wanted right now.
// Hidden, not deleted: the tab, the sub-nav entry and the CTA under the sweep
// results all key off this one flag. The server routes, schema and event log
// stay in place and are simply unused — flip to true to bring it all back.
const JOURNEY_ON = false;

// ---- journey rail (horizontal) ---------------------------------------------
// The rail is NAVIGATION, not decoration: three named steps you can click
// between at any time, with the one you're standing on clearly marked.
const STATIONS = [
  { t: "Demand Setting", s: "what to look for" },
  { t: "Sweep", s: "collect · classify · rank" },
  { t: "Content Ideas", s: "titles + justification" },
];
function rail() {
  $("#rail").innerHTML = STATIONS.map((n, i) => {
    const idx = i + 1;
    // step 3 is only reachable once a sweep has produced something
    const reachable = idx === 1 || idx === 2 || (idx === 3 && !!BATCH);
    const cls = "stn" + (idx === STAGE ? " on" : "") + (idx < STAGE ? " done" : "") + (reachable ? " go" : " locked");
    const goto = reachable ? `onclick="goStage(${idx})"` : "";
    const title = reachable ? "" : ` title="Run a sweep first"`;
    const node = `<div class="${cls}" ${goto}${title}>
      <div class="no">${idx < STAGE ? "✓" : String(idx).padStart(2, "0")}</div>
      <div class="meta"><span class="t">${n.t}</span><span class="s">${n.s}</span></div></div>`;
    const link = i < STATIONS.length - 1 ? `<div class="link ${idx < STAGE ? "lit" : ""}"></div>` : "";
    return node + link;
  }).join("");
}
// one mover for all three steps — 1 and 2 live on the input screen (2 is the
// run itself), 3 slides across to the results.
window.goStage = (n) => {
  if (n === 3 && !BATCH) return;
  STAGE = n;
  $("#track").classList.toggle("at-ideas", n === 3);
  rail();
  // scroll to the part of the page that step actually refers to: 1 = the feeds,
  // 2 = the run button / progress, 3 = the results. The rail itself is sticky-ish
  // at the top, so land just below it rather than flush against the viewport.
  // three real sections, one visible at a time — the step you click IS the page
  $("#stageHunger").hidden = n !== 1;
  $("#stageSweep").hidden = n !== 2;
  $("#stageIdeas").hidden = n !== 3;
  if (n === 2) renderSweepReport();
  const target = n === 1 ? $("#stageHunger") : n === 2 ? $("#stageSweep") : $("#stageIdeas");
  if (!target) return;
  requestAnimationFrame(() => {
    const y = target.getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  });
};
window.toHunger = () => goStage(1);
window.toIdeas = () => goStage(3);

// ---- sub-nav: New Sweep / Batches / Library / Settings ----------------------
function renderSubnav() {
  $("#subnav").innerHTML = [["sweep", "New Sweep"], ...(JOURNEY_ON ? [["journey", "Journey"]] : []), ["batches", "Batches"], ["library", "Library"], ["settings", "Settings"]]
    .map(([k, l]) => `<button class="${VIEW === k ? "on" : ""}" onclick="setView('${k}')">${l}</button>`).join("");
}
window.setView = (v) => {
  if (v === "rules") v = "settings";        // old deep-links land on Settings
  if (v === "journey" && !JOURNEY_ON) v = "sweep";   // lane is off — no dead end
  VIEW = v; renderSubnav();
  $("#view-sweep").hidden = v !== "sweep";
  $("#view-journey").hidden = v !== "journey";
  $("#view-batches").hidden = v !== "batches";
  $("#view-library").hidden = v !== "library";
  $("#view-rules").hidden = v !== "settings";
  window.scrollTo({ top: 0, behavior: "smooth" });   // every tab opens at its top
  if (v === "journey") renderJourney();
  if (v === "batches") renderBatches();
  if (v === "library") loadLibrary();
  if (v === "settings") renderBizRules();
};

// ==========================================================================
// BUSINESS RULES — RayDar's own dials, in the app (not a generic admin list).
// Every card says WHAT it controls and WHERE it fires; the key parameters are
// real labelled fields (the raw JSON stays available under "advanced"). Saved
// rules apply to the very next sweep — no deploy.
// ==========================================================================
// The app's SETTINGS = BUSINESS RULES only. Provider keys, the AI-pipeline
// registry (provider/model/gate) and the API integrations are PLATFORM-COMMON
// and live in Admin — one registry, no shadow copies. A business rule here
// carries the app's operating parameters + the instruction, nothing else.
let BR = null, BRCFG = null;
const BR_GROUPS = [
  ["guardrails", "Guardrails — who this is for", "Applied to EVERY idea prompt and enforced in code on the feed: items outside the allowed languages are dropped from the sweep, with the reason shown."],
  ["journey", "The sweep, step by step", "The dials of your hunger sweep — what gets swept when you start from Trend Spotting, whether SEO steers it (optional per batch), and who counts as the cohort."],
  ["integration", "Sources — how each API is called", "Per source: the exact query parameters, the prompt every batch of its items runs through, its model override and its on/off gate."],
  ["scoring", "Scoring — how ideas get ranked", "score = gap·w₁ + velocity·w₂ + strategic·w₃ + historical·w₄. Change the weights, change the ordering of every board."],
];
const BR_EXPLAIN = {
  guardrails: "The audience contract: India-English job seekers, INR, Indian workplace idiom. Languages here are ENFORCED — a Tamil/Kannada/Hinglish video is dropped at collection (reason shown in the sweep's dropped list), not just discouraged in the prompt.",
  trend_spotting: "Your INITIAL HUNGER SWEEP — starting from Trend Spotting, this frames the cohort's hunger and picks the demand topics that get swept.",
  seo_inputs: "The OPTIONAL SEO route. When a batch includes SEO, your pasted/uploaded research becomes real YouTube/Reddit search queries (and gets its own ✨ idea board). Not in the batch = not used.",
  talentmind: "The cohort route — when a sweep starts from TalentMind, this defines who counts (job seekers only, tenure cap) and how their corpus becomes chips.",
  youtube: "How YouTube is swept: region, look-back window, videos per term, whose comments we read (comments are the demand signal). THE FILTER lives here too — Shorts, memes and non-English-audio videos are dropped at collection with a reason, and no comment quota is spent on them.",
  reddit: "Which subreddits are searched, how many posts, and how deep the comment trees go — comment trees are the highest-value signal. The prompt below is EXACTLY what every batch of Reddit items is classified with.",
  newsapi: "News collection — language, page size, ordering for NewsAPI/GNews.",
  serpapi: "Google News via SerpApi — region/language and how many headlines.",
  tavily: "Research source — grounds ideas with facts + cited URLs during generation.",
  serper: "Google SERP research — grounding + validation with links.",
  perplexity: "Research + validation with citations; the prompt is sent with every research call.",
  exa: "Neural search for validation — most-relevant sources with URLs.",
  brave: "Web search for grounding + validation.",
  factcheck: "Published fact-checks (Google Fact Check Tools) — disputes lower an idea's confidence score.",
  wikidata: "Entity grounding against Wikipedia/Wikidata (no key needed).",
  scoring: "The composite rank behind every board. gap_map is the fallback demand map used when a topic has no live signal.",
};
// the labelled quick-fields per rule (k = key in collection). type: n(umber) | t(ext) | b(ool) | l(ist, comma-joined)
const BR_FIELDS = {
  youtube: [["publishedDays", "Look-back (days)", "n"], ["maxResults", "Videos per term", "n"], ["regionCode", "Region", "t"], ["commentsTopVideos", "Read comments from top-N", "n"], ["commentsPerVideo", "Comments per video", "n"],
    ["excludeShorts", "Drop Shorts", "b"], ["minDurationSec", "Min duration (sec)", "n"],
    ["minViews", "Min views (drop below)", "n"], ["minComments", "Min comments (drop below)", "n"],
    ["blockChannels", "Blocked channels — drop if name contains", "l"],
    ["memeMarkers", "Meme markers — drop if title contains", "l"], ["hinglishGuard", "Drop romanised-Hindi titles", "b"]],
  reddit: [["subreddits", "Subreddits searched", "l"], ["topPosts", "Posts per term", "n"], ["timeframe", "Timeframe", "t"], ["commentTrees", "Comment trees to walk", "n"], ["commentsPerPost", "Comments per post", "n"]],
  newsapi: [["language", "Language", "t"], ["pageSize", "Articles", "n"]],
  serpapi: [["gl", "Region", "t"], ["hl", "Language", "t"], ["num", "Headlines", "n"]],
  trend_spotting: [["topics", "Demand topics per sweep", "n"], ["include_emerging", "Include Emerging", "b"]],
  seo_inputs: [["max_inputs", "Max SEO inputs read", "n"]],
  talentmind: [["tenure_max_years", "Tenure cap (years)", "n"], ["job_seekers_only", "Job seekers only", "b"]],
  guardrails: [["languages", "Allowed languages (ISO codes — 'all' disables the filter)", "l"], ["audience", "Audience", "t"], ["region", "Region", "t"], ["currency", "Currency", "t"]],
};
async function renderBizRules() {
  const host = $("#view-rules");
  host.innerHTML = `<div class="empty" style="text-align:center;padding:40px;color:var(--dim)">reading the rules…</div>`;
  try {
    if (!BR) BR = (await (await fetch("/api/wh/rules")).json()).rules || {};
    if (!BRCFG) BRCFG = await (await fetch("/api/config")).json();
  } catch { host.innerHTML = `<p class="intro">could not load the rules</p>`; return; }
  const F = (id, r) => (BR_FIELDS[id] || []).map(([k, label, type]) => {
    const v = (r.collection || {})[k];
    const inp = type === "b" ? `<input type="checkbox" data-bf="${k}" data-t="b" ${v ? "checked" : ""} style="width:16px;height:16px">`
      : type === "l" ? `<input data-bf="${k}" data-t="l" value="${esc(Array.isArray(v) ? v.join(", ") : (v || ""))}" style="width:100%">`
      : `<input data-bf="${k}" data-t="${type}" value="${esc(v ?? "")}" style="width:${type === "n" ? "90px" : "180px"}">`;
    return `<label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--dim);${type === "l" ? "flex-basis:100%" : ""}">${esc(label)}${inp}</label>`;
  }).join("");
  const card = (id, r) => `
    <div class="brcard" data-rule="${id}" style="background:var(--panel,#101613);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
        <b style="font-size:14.5px">${esc((r.label || id).replace(/_/g, " "))}</b>
        <span style="font-family:var(--mono);font-size:10.5px;color:var(--dim2)">${esc(r.pipeline || "")}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--dim2)">model &amp; gate: Admin → AI &amp; Pipelines</span>
      </div>
      <p style="font-size:12.5px;color:var(--dim);line-height:1.55;margin:7px 0 10px">${esc(BR_EXPLAIN[id] || "")}</p>
      ${(BR_FIELDS[id] || []).length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px">${F(id, r)}</div>` : ""}
      <label style="font-size:11.5px;color:var(--dim)">The instruction — sent with every ${esc(id.replace(/_/g, " "))} call (edit freely)</label>
      <textarea data-pr rows="3" style="width:100%;font-size:12px;margin:4px 0 8px">${esc(r.prompt || "")}</textarea>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <input data-want placeholder="or just say it — “stop showing me shorts and hindi videos”, “read 200 comments per post”" style="flex:1;min-width:240px;font-size:12.5px"
          onkeydown="if(event.key==='Enter'){event.preventDefault();askBizRule('${id}')}">
        <button class="btn" onclick="askBizRule('${id}')">Apply my words ▸</button>
      </div>
      <div data-prop style="display:none;font-size:12px;border:1px solid var(--line);border-radius:9px;padding:10px 12px;margin-bottom:8px"></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" onclick="saveBizRule('${id}')">Save</button>
        <span data-msg style="font-size:12px;color:var(--grn)"></span>
        <details style="margin-left:auto;font-size:11px;color:var(--dim2)"><summary style="cursor:pointer">advanced (raw JSON)</summary>
          <textarea data-adv rows="6" style="width:340px;max-width:80vw;font-family:ui-monospace,monospace;font-size:11px;margin-top:6px">${esc(JSON.stringify(r.collection || {}, null, 2))}</textarea></details>
      </div>
    </div>`;
  const byCat = {}; for (const [id, r] of Object.entries(BR)) (byCat[r.category || "other"] ||= []).push([id, r]);
  host.innerHTML = `<p class="intro"><b>BUSINESS RULES</b> — RayDar's own dials. Nothing here is generic: these are the actual parameters of your sweep, the actual prompts each source runs through, and the filter that decides what gets dropped. Saved rules apply to the very next sweep.</p>`
    + BR_GROUPS.filter(([c]) => byCat[c]).map(([c, title, sub]) =>
      `<div style="margin:20px 0 4px"><b style="color:var(--grn);font-size:13px;letter-spacing:.06em;text-transform:uppercase">${esc(title)}</b>
        <p style="font-size:12px;color:var(--dim2);margin:3px 0 10px">${esc(sub)}</p></div>` + byCat[c].map(([id, r]) => card(id, r)).join("")).join("");
}
// plain English → a PROPOSED change (params + instruction), shown as a diff you confirm
window.askBizRule = async (id) => {
  const el = document.querySelector(`[data-rule="${id}"]`); if (!el) return;
  const want = el.querySelector("[data-want]").value.trim(); if (!want) return;
  const box = el.querySelector("[data-prop]");
  box.style.display = "block"; box.innerHTML = `<img class="potspin" src="/brand/assets/logos/pot.png" alt=""> reading what you want…`;
  try {
    const j = await (await fetch(`/api/wh/rules/${id}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ want }) })).json();
    if (!j.ok) { box.innerHTML = `<span style="color:var(--dim)">${esc(j.error || "could not read that")}</span>`; return; }
    window._RDPROP = { ...(window._RDPROP || {}), [id]: j.proposal };
    box.innerHTML = `<b>Proposed change</b> — nothing is saved until you accept.
      <ul style="margin:6px 0 8px;padding-left:18px;line-height:1.6">${(j.proposal.changed || []).map((c) => `<li>${esc(c)}</li>`).join("") || "<li>updated the parameters</li>"}</ul>
      <div style="display:flex;gap:8px"><button class="btn" onclick="acceptBizProp('${id}')">Accept</button>
        <button class="btn" onclick="this.closest('[data-prop]').style.display='none'">Discard</button></div>`;
  } catch (e) { box.innerHTML = `<span style="color:var(--dim)">${esc(String(e.message || e))}</span>`; }
};
window.acceptBizProp = (id) => {
  const p = (window._RDPROP || {})[id]; const el = document.querySelector(`[data-rule="${id}"]`); if (!p || !el) return;
  el.querySelector("[data-adv]").value = JSON.stringify(p.collection || {}, null, 2);   // fields re-read from here on save
  if (p.prompt) el.querySelector("[data-pr]").value = p.prompt;
  el.querySelectorAll("[data-bf]").forEach((f) => {                                     // reflect into the labelled fields
    const v = (p.collection || {})[f.dataset.bf];
    if (v === undefined) return;
    if (f.dataset.t === "b") f.checked = !!v; else if (f.dataset.t === "l") f.value = Array.isArray(v) ? v.join(", ") : String(v); else f.value = v;
  });
  el.querySelector("[data-prop]").innerHTML = `<span style="color:var(--grn)">applied to the fields — press <b>Save</b> to commit</span>`;
};
window.saveBizRule = async (id) => {
  const el = document.querySelector(`[data-rule="${id}"]`); if (!el) return;
  let collection = {};
  try { collection = JSON.parse(el.querySelector("[data-adv]").value || "{}"); }
  catch { el.querySelector("[data-msg]").textContent = "invalid JSON in advanced"; return; }
  el.querySelectorAll("[data-bf]").forEach((f) => {   // labelled fields win over the raw JSON
    const k = f.dataset.bf, t = f.dataset.t;
    collection[k] = t === "b" ? f.checked : t === "n" ? Number(f.value) : t === "l" ? f.value.split(",").map((x) => x.trim()).filter(Boolean) : f.value.trim();
  });
  const body = { collection, prompt: el.querySelector("[data-pr]").value };
  const r = await fetch(`/api/wh/rules/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  el.querySelector("[data-msg]").textContent = r.ok ? "saved ✓ — applies to the next sweep" : "error";
  BR = null; GUARD = null;
};

async function init() {
  renderSubnav(); rail(); renderBatchPick();
  ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || [];
  FRANCHISES = ((await (await fetch("/api/wh/franchises")).json()).franchises) || [];
  await loadThemes();
  try { GUARD = (((await (await fetch("/api/wh/rules")).json()).rules || {}).guardrails || {}).collection || {}; } catch { GUARD = {}; }
  renderHunger();
  renderIdeas(null);
  goStage(1);           // start on Demand Setting with the other steps hidden
}

// ---- STAGE 01 · HUNGER (3 combinable routes) -------------------------------
async function renderHunger() {
  const seo = (await (await fetch("/api/wh/seo")).json()).inputs || [];
  // ---- Feed 01 is now TWO levels ------------------------------------------
  // Level 1: CONTENT SERIES — the client's own families (1Up and its sub-series
  // Interview Lab · Resume Lab · Skill Up; Way Up). Picking a family auto-selects
  // every theme beneath it.
  // Level 2: THEMES — the detailed concepts, grouped under the series they belong
  // to, so you can see the mapping and deselect individual ones.
  const live = ALL_TOPICS.filter((t) => t.name !== "Emerging" && t.active !== false);
  const themesOf = (fname) => live.filter((t) => t.franchise === fname);
  // All content series are PEERS — 1Up, Skill Up, Interview Lab, Resume Lab sit
  // at the same level. No parent/child nesting: the team treats them equally.
  const parents = FRANCHISES.filter((f) => f.active !== false);
  const kidsOf = (p) => FRANCHISES.filter((f) => f.active !== false && f.parent === p);

  const seriesChip = (f, sub) => {
    const mine = themesOf(f.name).map((t) => t.name);
    const all = mine.length && mine.every((n) => TOPICS.includes(n));
    const some = !all && mine.some((n) => TOPICS.includes(n));
    return `<span class="chip pick series ${all ? "on" : some ? "part" : ""} ${sub ? "sub" : "top"}"
      onclick="toggleSeries('${esc(f.name).replace(/'/g, "\\'")}')"
      title="${esc(f.blurb || "")}${mine.length ? ` · ${mine.length} theme${mine.length === 1 ? "" : "s"}` : " · no themes yet"}">
      ${all ? "✓ " : some ? "– " : ""}${esc(f.name)}${mine.length ? `<b class="n">${mine.length}</b>` : ""}</span>`;
  };
  const seriesPicker = parents.map((p) => seriesChip(p, false)).join("");

  // themes grouped by the series they sit under, divider between each group
  const groups = parents.map((f) => [f, themesOf(f.name)]).filter(([, t]) => t.length);
  const orphans = live.filter((t) => !FRANCHISES.some((f) => f.name === t.franchise && f.active !== false));
  const themeChip = (t) => `<span class="chip pick ${TOPICS.includes(t.name) ? "on" : ""}"
      onclick="toggleTopic('${esc(t.name).replace(/'/g, "\\'")}')"
      title="${esc(t.description || t.definition || "")}">${TOPICS.includes(t.name) ? "✓ " : ""}${esc(t.name)}</span>`;
  const themeGroups = groups.map(([f, ts]) => `<div class="tgrp">
      <div class="tgrp-h"><span>${esc(f.name)}</span><i></i></div>
      <div class="chips">${ts.map(themeChip).join("")}</div></div>`).join("")
    + `<div class="tgrp"><div class="tgrp-h"><span>Others</span><i></i></div>
      <div class="chips">${orphans.length ? orphans.map(themeChip).join("")
        : `<span class="chip" style="border-style:dashed;color:var(--dim2)">nothing here yet — themes you add in &#9881; edit concepts appear here until you give them a series</span>`}
        <span class="chip pick" onclick="toggleConcepts()" title="add or edit themes">&#9881; edit concepts</span></div></div>`;

  const trendChips = `
    <div class="lvl"><span class="lvl-n">Step 1</span> Pick <b>one</b> content series <span class="lvl-s">— one at a time; picking another switches to it</span></div>
    <div class="fams">${seriesPicker || `<span class="chip" style="border-style:dashed">no series configured</span>`}</div>
    <div class="lvl" style="margin-top:14px"><span class="lvl-n">Step 2</span> Fine-tune the themes <span class="lvl-s">— ${SERIES_ON ? `within ${esc(SERIES_ON)}; one theme gives the sharpest sweep` : "pick a series above first"}</span></div>
    ${themeGroups}`;
  const seoChips = seo.length
    ? seo.map((s) => `<span class="chip">${esc(s.kind)} · ${esc((s.content || "").slice(0, 20))}…<a class="x" onclick="delSeo(${s.id});return false" href="#">✕</a></span>`).join("")
    : `<span class="chip" style="border-style:dashed">no research pasted</span>`;

  $("#stageHunger").innerHTML = `
    <p class="intro"><b>DEMAND SETTING</b> — tell RayDar what to look for. Arm one or more feeds, then run the sweep. Demand can come from what's <b>trending</b>, from your <b>SEO</b> research, or from the <b>talent</b> themselves.</p>
    <div class="panel1"><div class="routes">

      <div class="mod ${ROUTES.trend ? "sel" : ""}">
        <span class="idx">Feed 01</span>
        <h3><span class="tick" onclick="route('trend')">✓</span> Trend Spotting
          <a class="ceditlink" onclick="toggleConcepts()">${EDIT_CONCEPTS ? "done" : "⚙ edit concepts"}</a></h3>
        <p class="desc">Pick a <b>content series</b> to take everything under it, then fine-tune the individual <b>themes</b>. Each theme carries the <b>search terms</b> fired at YouTube and Reddit.</p>
        <div class="chips">${trendChips}</div>
      </div>

      <div class="mod ${ROUTES.seo ? "sel" : ""}">
        <span class="idx">Feed 02</span>
        <h3><span class="tick" onclick="route('seo')">✓</span> SEO Inputs</h3>
        <p class="desc">Paste raw research — keyword lists, GSC queries, competitor gaps, trend exports.</p>
        <textarea id="seoText" rows="3" placeholder="paste raw research…"></textarea>
        <div class="row" style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <button class="btn small" onclick="addSeo()">+ Add</button>
          <label class="btn small" style="cursor:pointer;margin:0">⤒ Excel / CSV<input type="file" id="seoFile" accept=".xlsx,.xls,.csv,.ods" style="display:none" onchange="uploadSeo(this.files[0])"></label>
        </div>
        <div class="chips" style="margin-top:10px">${seoChips}</div>
      </div>

      <div class="mod soon ${TM ? "sel" : ""}">
        <span class="idx">Feed 03</span>
        <h3>TalentMind ${TM ? `<span class="chip tag-grn" style="cursor:default">sim active</span>` : `<span class="badge-soon">soon · needs T500 + parse AI</span>`}</h3>
        <p class="desc">Demand seeded from the talent themselves — parse each job seeker's corpus into chips, cohort them, read their hunger.</p>

        <div id="tmSim"></div>
      </div>

    </div>

    <div class="sweepbox">
      <span class="idx">Your brief</span>
      <textarea id="sweepPrompt" rows="2" placeholder="anything more to add in your sweep?" oninput="setSweepPrompt(this.value)">${esc(SWEEP_PROMPT)}</textarea>
    </div>
    ${TOPICS.length ? `<div class="quota">
      <b>One content series at a time.</b> ${esc(SERIES_ON || "")}${SERIES_ON ? " is armed" : ""} — ${TOPICS.length} theme${TOPICS.length === 1 ? "" : "s"} selected.
      <b>For the sharpest results, run one theme at a time.</b> A sweep spread across many themes returns a broader, weaker feed;
      one theme gets the full search budget and the comments that actually answer it.
      Re-running a theme within 24 hours is served from cache and costs no quota.
    </div>` : ""}
    <div class="process"><button class="sweep-btn" onclick="onProcess()">◎ Run the sweep</button></div>
    <div id="procMeter"></div></div>
    ${EDIT_CONCEPTS ? conceptModal() : ""}`;
  rail();
}
// full-screen editor overlay — roomy columns, nothing else shifts; "Done" closes it
function conceptModal() {
  return `<div class="cmodal-ov" onclick="if(event.target===this)toggleConcepts()">
    <div class="cmodal">
      <div class="cmodal-h"><div><b>Your content themes</b><span class="cmodal-s">describe each theme — RayDar works out what to search · you confirm before it saves</span></div>
        <button class="btn small" onclick="toggleConcepts()">Done ✓</button></div>
      <div class="cmodal-b">${conceptEditor()}</div>
    </div></div>`;
}
window.setSweepPrompt = (v) => { SWEEP_PROMPT = v; };
window.route = (k) => { ROUTES[k] = !ROUTES[k]; renderHunger(); };
// ONE content series at a time. Picking a series REPLACES the selection rather
// than adding to it: a sweep aimed at a single family returns a far sharper
// feed than one spread across four, and it keeps the quota cost predictable.
window.toggleSeries = (fname) => {
  ROUTES.trend = true;
  const mine = ALL_TOPICS.filter((t) => t.franchise === fname && t.name !== "Emerging" && t.active !== false).map((t) => t.name);
  if (!mine.length) return rdAlert("No themes yet", `Nothing is mapped to "${fname}" yet. Add themes to it in \u2699 edit concepts.`);
  const alreadyThis = mine.every((n) => TOPICS.includes(n)) && TOPICS.length === mine.length;
  TOPICS = alreadyThis ? [] : mine;      // click again to clear
  SERIES_ON = alreadyThis ? null : fname;
  renderHunger();
};
window.toggleTopic = (name) => {
  ROUTES.trend = true;
  const t = ALL_TOPICS.find((x) => x.name === name);
  // picking a theme from a different series switches series rather than mixing
  if (SERIES_ON && t && t.franchise !== SERIES_ON) { SERIES_ON = t.franchise; TOPICS = [name]; return renderHunger(); }
  if (!SERIES_ON && t) SERIES_ON = t.franchise;
  TOPICS = TOPICS.includes(name) ? TOPICS.filter((x) => x !== name) : [...TOPICS, name];
  if (!TOPICS.length) SERIES_ON = null;
  renderHunger();
};
window.addSeo = async () => { const content = $("#seoText")?.value.trim(); if (!content) return; ROUTES.seo = true; await fetch("/api/wh/seo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "keywords", content }) }); renderHunger(); };
window.uploadSeo = async (file) => {
  if (!file) return;
  ROUTES.seo = true;
  const fd = new FormData(); fd.append("file", file);
  try {
    const j = await (await fetch("/api/wh/seo/upload", { method: "POST", body: fd })).json();
    if (j.ok) rdAlert("SEO file read", `${(j.sheets || []).length > 1 ? `Read ${j.sheets.length} tabs (${j.sheets.map(esc).join(", ")}). ` : ""}Pulled ${(j.terms || []).length} search keyword${(j.terms || []).length === 1 ? "" : "s"} from ${esc(j.file || file.name)}${(j.terms || []).length ? ` — e.g. ${(j.terms || []).slice(0, 3).map(esc).join(", ")}` : ""}. These become YouTube/Reddit queries on your next sweep.`);
    else rdAlert("Upload failed", j.error || "");
  } catch { rdAlert("Upload failed", "Try again."); }
  renderHunger();
};
window.delSeo = async (id) => { await fetch(`/api/wh/seo/${id}/delete`, { method: "POST" }); renderHunger(); };

// ---- THEME EDITOR — describe it in your words; RayDar compiles the logic ---
// The content team never writes search syntax. They write a sentence about what
// the theme IS; raydar-theme-compile turns that into the terms the sweep fires,
// the 1Up sub-series it routes to, and what counts as on/off-theme. Nothing is
// saved until they press Save — the compile only ever proposes.
let THEMES = [], SERIES = [], TDRAFT = {};
async function loadThemes() {
  try { const j = await (await fetch("/api/wh/themes")).json(); THEMES = j.themes || []; SERIES = j.series || []; }
  catch { THEMES = []; SERIES = []; }
}
function conceptEditor() {
  const active = THEMES.filter((t) => t.active && t.name !== "Emerging");
  const retired = THEMES.filter((t) => !t.active);
  const seriesOpts = (sel) => SERIES.filter((s) => s.active).map((s) => `<option ${sel === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const card = (t, i) => {
    const d = TDRAFT[t.name] || {};
    const c = d.compiled || t.compiled || null;
    return `<div class="tcard">
      <div class="tcard-h">
        <input id="tn-${i}" value="${esc(t.name)}" placeholder="theme name">
        <select id="tf-${i}">${seriesOpts(d.franchise || t.franchise)}</select>
        <input id="tw-${i}" value="${esc(t.strategic_weight ?? 1)}" title="how much this theme matters to the business" style="width:56px;text-align:center">
      </div>
      <label class="fld">Describe it — what is this theme, in your own words?</label>
      <textarea id="td-${i}" rows="3" placeholder="e.g. Resume tips and fixes — framing over content. How the resume is structured and worded, and the keywords that get it read.">${esc(d.description ?? t.description ?? "")}</textarea>
      <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn small" onclick="compileTheme(${i},'${esc(t.name).replace(/'/g, "\\'")}')">✨ Work out the logic from this</button>
        <button class="btn small" onclick="saveTheme('${esc(t.name).replace(/'/g, "\\'")}',${i})">Save</button>
        <button class="btn small" onclick="retireTheme('${esc(t.name).replace(/'/g, "\\'")}')" title="stop using this theme (nothing is deleted)">Retire</button>
        <span id="tm-${i}" class="tcard-msg"></span>
      </div>
      ${c ? `<div class="tcomp">
        <div class="tcomp-k">What that description becomes</div>
        ${c.why ? `<div class="tcomp-why">${esc(c.why)}</div>` : ""}
        <div class="tcomp-r"><span class="tk">Searches fired</span><div class="tv">
          <input id="tt-${i}" value="${esc((d.terms ?? c.terms ?? t.terms ?? []).join(", "))}" placeholder="the phrases sent to YouTube / Reddit">
          <div class="tcomp-n">These are the exact queries the sweep runs. Edit freely — they're yours.</div></div></div>
        ${c.question ? `<div class="tcomp-r"><span class="tk">The question in their head</span><div class="tv">${esc(c.question)}</div></div>` : ""}
        ${(c.registers || []).length ? `<div class="tcomp-r"><span class="tk">Usual feeling</span><div class="tv">${(c.registers || []).map((r) => `<span class="rcp-term">${esc(r)}</span>`).join("")}</div></div>` : ""}
        ${(c.on_theme || []).length ? `<div class="tcomp-r"><span class="tk">Counts as on-theme</span><div class="tv">${(c.on_theme || []).map((r) => `<span class="rcp-term">${esc(r)}</span>`).join("")}</div></div>` : ""}
        ${(c.off_theme || []).length ? `<div class="tcomp-r"><span class="tk">Must NOT be collected</span><div class="tv">${(c.off_theme || []).map((r) => `<span class="rcp-term">${esc(r)}</span>`).join("")}</div></div>` : ""}
      </div>` : `<div class="tcomp-empty">Not worked out yet — describe it above, then press <b>✨ Work out the logic from this</b>. RayDar will suggest the searches to fire; you confirm before anything saves.
        ${(t.terms || []).length ? `<div class="tcomp-n" style="margin-top:6px">Currently searching: ${(t.terms || []).map(esc).join(" · ")}</div>` : ""}</div>`}
    </div>`;
  };
  return `<div class="tset">
    <p class="tset-i">These are Talent500's own themes, in Talent500's words. Write what each one <b>is</b> — RayDar turns your description into the searches it fires, where the idea gets routed, and what to ignore. You confirm everything before it saves.</p>
    ${active.map(card).join("")}
    <div class="tcard tcard-new">
      <div class="tcard-h">
        <input id="tn-new" placeholder="+ a new theme">
        <select id="tf-new">${seriesOpts(null)}</select>
        <input id="tw-new" value="1" style="width:56px;text-align:center">
      </div>
      <label class="fld">Describe it in your own words</label>
      <textarea id="td-new" rows="2" placeholder="what is this theme about?"></textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn small" onclick="addTheme()">Add theme</button></div>
    </div>
    ${retired.length ? `<details class="tretired"><summary>${retired.length} retired theme${retired.length === 1 ? "" : "s"} — kept for the record, not swept</summary>
      <div class="tcomp-n" style="padding:8px 0">${retired.map((t) => esc(t.name)).join(" · ")}</div></details>` : ""}
  </div>`;
}
window.compileTheme = async (i, name) => {
  const msg = $(`#tm-${i}`), description = $(`#td-${i}`)?.value.trim();
  if (!description) return rdAlert("Describe it first", "Write a sentence or two about what this theme is, then press again.");
  if (msg) msg.textContent = "working it out…";
  const j = await (await fetch("/api/wh/theme/compile", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: $(`#tn-${i}`)?.value.trim() || name, description, franchise: $(`#tf-${i}`)?.value }) })).json();
  if (j.error) { if (msg) msg.textContent = ""; return rdAlert("Couldn't work it out", j.error); }
  TDRAFT[name] = { description, franchise: $(`#tf-${i}`)?.value, compiled: j.compiled, terms: j.compiled?.terms || [] };
  if (msg) msg.textContent = j.mode === "ai" ? "✓ suggested — check it, then Save" : "✓ starting point (no AI enabled) — edit, then Save";
  renderHunger();
};
window.saveTheme = async (oldName, i) => {
  const d = TDRAFT[oldName] || {};
  const body = { old_name: oldName, name: $(`#tn-${i}`)?.value.trim(), description: $(`#td-${i}`)?.value.trim(),
    franchise: $(`#tf-${i}`)?.value, strategic_weight: $(`#tw-${i}`)?.value.trim(),
    terms: $(`#tt-${i}`)?.value ?? (d.terms || []).join(", "), compiled: d.compiled || null };
  if (!body.name) return;
  await fetch("/api/wh/theme/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  delete TDRAFT[oldName];
  await loadThemes(); await refreshTopics();
};
window.addTheme = async () => {
  const name = $("#tn-new")?.value.trim(); if (!name) return;
  await fetch("/api/wh/theme/save", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: $("#td-new")?.value.trim(), franchise: $("#tf-new")?.value, strategic_weight: $("#tw-new")?.value.trim() }) });
  await loadThemes(); await refreshTopics();
};
window.retireTheme = async (name) => {
  await fetch(`/api/wh/theme/${encodeURIComponent(name)}/active`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: false }) });
  await loadThemes(); await refreshTopics();
};

// ---- (legacy) compact concept editor — kept for reference ------------------
function conceptEditorLegacy() {
  const rows = ALL_TOPICS.filter((t) => t.name !== "Emerging").map((t, i) => `
    <div class="cedit">
      <input id="cn-${i}" value="${esc(t.name)}" placeholder="concept" style="font-weight:600">
      <div class="ct-cell"><input id="ct-${i}" value="${esc((t.terms || []).join(", "))}" placeholder="search terms → YouTube/Reddit queries (comma-separated)"><button class="sugg" title="AI: suggest search terms (you confirm before saving)" onclick="suggestTerms(${i},'${esc(t.name).replace(/'/g, "\\'")}')">✨</button></div>
      <input id="cf-${i}" value="${esc(t.franchise || "")}" placeholder="1Up franchise" title="franchise">
      <input id="cw-${i}" value="${esc(t.strategic_weight || 1)}" title="strategic weight" style="text-align:center">
      <button class="btn small" onclick="saveConcept('${esc(t.name).replace(/'/g, "\\'")}',${i})">Save</button>
      <button class="btn small" onclick="delConcept('${esc(t.name).replace(/'/g, "\\'")}')" title="remove">${ic("x", 12)}</button>
    </div>`).join("");
  return `<div class="cedit-wrap">
    <div class="cedit cedit-h"><span>concept</span><span>search terms (what it covers)</span><span>franchise</span><span>wt</span><span></span><span></span></div>
    ${rows}
    <div class="cedit">
      <input id="cn-new" placeholder="+ new concept" style="font-weight:600">
      <div class="ct-cell"><input id="ct-new" placeholder="search terms, comma-separated"><button class="sugg" title="AI: suggest search terms" onclick="suggestTermsNew()">✨</button></div>
      <input id="cf-new" placeholder="franchise">
      <input id="cw-new" value="1" style="text-align:center">
      <button class="btn small" onclick="addConcept()">Add</button><span></span>
    </div></div>`;
}
window.toggleConcepts = async () => {
  EDIT_CONCEPTS = !EDIT_CONCEPTS;
  if (EDIT_CONCEPTS) await loadThemes();   // never render the editor off a stale cache
  renderHunger();
};
// AI "suggest terms" — proposes queries, APPENDS to the field; you edit + Save (stays your config)
async function _suggestInto(name, el, btn) {
  if (!name) return rdAlert("Name the concept first", "Type a concept name, then click ✨.");
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    const j = await (await fetch("/api/wh/topic/suggest-terms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).json();
    const terms = j.terms || [];
    if (terms.length && el) { const cur = el.value.trim(); el.value = cur ? cur + ", " + terms.join(", ") : terms.join(", "); el.focus(); }
    else rdAlert("No suggestions", j.error || "Add a keyed AI model in Admin, or type terms manually.");
  } catch { rdAlert("Suggest failed", "Try again."); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "✨"; } }
}
window.suggestTerms = (i, name) => _suggestInto(($(`#cn-${i}`)?.value.trim() || name), $(`#ct-${i}`), event?.currentTarget);
window.suggestTermsNew = () => _suggestInto($("#cn-new")?.value.trim(), $("#ct-new"), event?.currentTarget);
async function refreshTopics() { ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || []; renderHunger(); }
window.saveConcept = async (oldName, i) => {
  const body = { old_name: oldName, name: $(`#cn-${i}`).value.trim(), terms: $(`#ct-${i}`).value, franchise: $(`#cf-${i}`).value.trim(), strategic_weight: $(`#cw-${i}`).value.trim() };
  if (!body.name) return;
  await fetch("/api/wh/topic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await refreshTopics();
};
window.addConcept = async () => {
  const name = $("#cn-new").value.trim(); if (!name) return;
  await fetch("/api/wh/topic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, terms: $("#ct-new").value, franchise: $("#cf-new").value.trim() || "Emerging", strategic_weight: $("#cw-new").value.trim() || 1 }) });
  await refreshTopics();
};
window.delConcept = async (name) => { await fetch(`/api/wh/topic/${encodeURIComponent(name)}/delete`, { method: "POST" }); await refreshTopics(); };

// TalentMind simulation — synthetic data path (prefilled filters + NLP prompt)
window.talentmindSim = async () => {
  ROUTES.talentmind = true;
  $("#tmSim").innerHTML = `<div id="tmMeter" style="margin-top:12px"></div>`;
  await meter(["Loading synthetic Talent500 pool", "Prefilling filters + NLP query", "Parsing corpora → TalentMind chips", "Reading cohort hunger"], "tmMeter", "");
  await fetch("/api/wh/seed", { method: "POST" });
  await fetch("/api/wh/clientmind/refresh-all", { method: "POST" });
  const co = await (await fetch("/api/wh/cohort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "TalentMind sim", domain: "any", nl_query: "job seekers who have stayed less than 2 years in each company" }) })).json();
  const hg = await (await fetch(`/api/wh/hunger/${co.id}`, { method: "POST" })).json();
  TM = { cohortId: co.id, members: co.members, hunger: hg.hunger };
  renderHunger();
  renderTMWriteup();
};
function renderTMWriteup() {
  const h = TM.hunger || {};
  const chips = (h.cares_about || []).concat(h.motivations || []);
  window._tmChips = chips;
  $("#tmSim").innerHTML = `
    <div style="border-top:1px solid var(--line); margin-top:12px; padding-top:12px">
      <div class="chip tag-cyan" style="cursor:default">${TM.members} talent · "stayed &lt; 2 yrs / company"</div>
      <label class="fld">TalentMind write-up</label>
      <textarea id="tmWho" rows="3">${esc(h.who || "")}</textarea>
      <label class="fld">Chips — add / remove</label>
      <div class="chips" style="margin:4px 0 8px">${chips.map((c, i) => `<span class="chip">${esc(c)}<a class="x" onclick="rmChip(${i});return false" href="#">✕</a></span>`).join("")}</div>
      <div class="row"><input id="tmNewChip" placeholder="add a chip" style="flex:1;min-width:120px"><button class="btn small" onclick="addChip()">+ chip</button></div>
      <label class="fld">Batch name</label>
      <div class="row"><input id="tmBatch" value="${esc("Batch " + fmtDT(Date.now()))}" style="flex:1;min-width:160px"><button class="btn small" onclick="saveTM()">Save</button></div>
      <div id="tmMsg" class="chip" style="border:none;background:none;padding:6px 0;color:var(--grn)"></div>
    </div>`;
}
window.addChip = () => { const v = $("#tmNewChip").value.trim(); if (!v) return; window._tmChips.push(v); syncChips(); };
window.rmChip = (i) => { window._tmChips.splice(i, 1); syncChips(); };
function syncChips() { TM.hunger.cares_about = window._tmChips; TM.hunger.motivations = []; renderTMWriteup(); }
window.saveTM = async () => {
  TM.hunger.who = $("#tmWho").value; TM.name = $("#tmBatch").value;
  await fetch(`/api/wh/hunger/${TM.cohortId}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunger: TM.hunger }) });
  $("#tmMsg").textContent = "✓ batch saved — now run the sweep";
};

// ---- STAGE 02 · SWEEP → Ideas ----------------------------------------------
// Honest ticker: name only the APIs actually live (enabled + keyed), per
// /api/wh/feed/status. Steps gate exactly like the backend — classify only
// runs with a live feed, validate only with a research key. No keys → LLM-only.
const SRC_LABEL = {
  youtube: "YouTube — search · stats · comments", reddit: "Reddit — search · comment trees",
  newsapi: "News — headlines", serpapi: "Google News (SerpApi)",
  tavily: "Tavily", serper: "Serper", perplexity: "Perplexity", exa: "Exa", brave: "Brave",
};
async function sweepSteps() {
  let st = { feed: [], research: [], mock: true };
  try { st = await (await fetch("/api/wh/feed/status")).json(); } catch { /* mock */ }
  const steps = [];
  if (st.feed?.length) {
    for (const s of st.feed) steps.push("Collecting · " + (SRC_LABEL[s] || s));
    steps.push("Classifying → topic · franchise · registers");
  } else {
    steps.push("No live feed keys — LLM-only run (add YouTube / Reddit in the Vault)");
  }
  steps.push("Signals · demand vs supply · velocity");
  if (st.research?.length) steps.push("Research · " + st.research.map((s) => SRC_LABEL[s] || s).join(" · "));
  steps.push("Writing headings + briefs");
  if (st.research?.length) steps.push("Validate · evidence + fact-check");
  steps.push("Composite ranking");
  return steps;
}
window.onProcess = async () => {
  if (!ROUTES.trend && !ROUTES.seo && !ROUTES.talentmind) { rdAlert("Arm a feed", "Tick Trend Spotting, add SEO inputs, or run the TalentMind simulation first."); return; }
  STAGE = 2; rail();
  const prompt = ($("#sweepPrompt")?.value || SWEEP_PROMPT || "").trim();
  const body = TM ? { talentmind_cohort_id: TM.cohortId, name: TM.name, prompt } : { trend_topics: ROUTES.trend ? TOPICS : [], seo: ROUTES.seo, prompt };
  const b = await (await fetch("/api/wh/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  BATCH = { id: b.id, name: b.name };
  const steps = await sweepSteps();                                          // honest: reflects live keys
  // The generation request is long-running. It used to be awaited with the error
  // swallowed ("surfaced by caller" — the caller never did), so a timeout or a
  // 500 left the spinner turning for ever with no way to tell what happened.
  // Now: a hard client-side deadline, and every failure says what it was.
  const DEADLINE = 8 * 60 * 1000;
  const gen = fetch(`/api/wh/feedstories/${BATCH.id}`, { method: "POST" })
    .then(async (r) => {
      if (!r.ok) throw new Error(`the server returned ${r.status} while writing ideas`);
      const j = await r.json().catch(() => ({}));
      if (j.error) throw new Error(j.error);
      return j;
    });
  const guard = new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), DEADLINE));
  let failed = null;
  const settled = Promise.race([gen, guard]).catch((e) => { failed = e; });
  await meter(steps, "procMeter", "◎ Signal locked", settled);
  if (failed) {
    const host = $("#procMeter");
    if (host) host.innerHTML = `<div class="ferr"><div class="ferr-r"><b>The sweep did not finish</b> — ${esc(failed.message)}.
      <span class="ferr-a">Nothing was lost: the batch is saved and any ideas already written are on Content Ideas.</span></div></div>
      <div class="process" style="margin-top:10px">
        <button class="btn small" onclick="loadIdeas().then(()=>goStage(3))">See what was written</button>
        <button class="btn small" onclick="onProcess()">Try again</button></div>`;
    renderBatchPick();
    return;
  }
  await loadIdeas();
  goStage(3); renderBatchPick();      // land on Content Ideas when the sweep finishes
};

// ---- STAGE 03 · Ideas (ranked, franchise-routed, review CRUD) --------------
async function loadIdeas() {
  const { stories } = await (await fetch(`/api/wh/feedstories/${BATCH.id}?franchise=${encodeURIComponent(FR)}`)).json();
  const { franchises } = await (await fetch("/api/wh/franchises")).json();
  try { FEED_SIGNAL = (await (await fetch(`/api/wh/feed-signal/${BATCH.id}`)).json()).feed || []; } catch { FEED_SIGNAL = []; }
  try { RECAP = await (await fetch(`/api/wh/journey/recap/${BATCH.id}`)).json(); } catch { RECAP = null; }
  renderIdeas(stories, franchises);
  rail();
}
const FR_TAG = ["tag-grn", "tag-cyan", "tag-amber", "tag-mag"];
const frIndexIn = (fr, name) => Math.max(0, (fr || []).findIndex((f) => f.name === name));

const _STORIES = {};   // id → story cache, shared by story boards / explain / copy

// Trend Spotting report — sits above the article titles; aggregates the sweep:
// which trends, which audience, what's being discussed, signals, sources.
// a valid emotional register is a short label ("Anxiety", "FOMO", "Quiet confidence").
// The LLM sometimes leaks a whole framework paragraph into this field — reject those.
function shortReg(r) {
  if (typeof r !== "string") return null;
  const t = r.trim();
  return /^[A-Za-z][A-Za-z /&+.-]{0,20}$/.test(t) ? t : null;
}

function trendReport(stories) {
  if (!stories || !stories.length) return "";
  const topics = {}, regs = {}, fr = {}, gaps = {}, srcs = new Set();
  let contra = 0, vsum = 0, gsum = 0, live = false, regDropped = 0;
  for (const s of stories) {
    topics[s.demand_topic] = (topics[s.demand_topic] || 0) + 1;
    const r = shortReg(s.emotional_register);
    if (r) regs[r] = (regs[r] || 0) + 1; else if (s.emotional_register) regDropped++;
    fr[s.franchise] = (fr[s.franchise] || 0) + 1;
    if (s.gap_type) gaps[s.gap_type] = (gaps[s.gap_type] || 0) + 1;
    const b = s.score_breakdown || {}; vsum += Number(b.velocity) || 0; gsum += Number(b.gap) || 0; if (b.live) live = true;
    (b.sources || []).forEach((x) => srcs.add(x));
    if (s.contradiction) contra++;
  }
  const n = stories.length;
  const audParts = GUARD ? [GUARD.region, GUARD.language, GUARD.audience].filter(Boolean) : [];
  const sortEnt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const chip = (label, count) => `<span class="tsr-chip"><span class="t">${esc(label)}</span>${count != null ? `<b>${count}</b>` : ""}</span>`;
  const tile = (v, l) => `<div class="tsr-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;

  const audBlock = `<div class="tsr-block"><div class="tsr-k">${ic("target", 12)} Audience</div><div class="tsr-chips">
    ${audParts.length ? audParts.map((p) => chip(p)).join("") : chip("—")}
    <span class="tsr-chip mut"><span class="t">${BATCH && BATCH.cohortId ? "cohort set" : "no cohort · nil"}</span></span></div></div>`;

  const conceptBlock = `<div class="tsr-block span2"><div class="tsr-k">${ic("pin", 12)} Concepts on the radar <span class="n">${Object.keys(topics).length}</span></div>
    <div class="tsr-chips">${sortEnt(topics).map(([t, c]) => chip(t, c)).join("")}</div></div>`;

  const regBlock = `<div class="tsr-block"><div class="tsr-k">${ic("bolt", 12)} What's being discussed</div>
    <div class="tsr-chips">${sortEnt(regs).length ? sortEnt(regs).map(([r, c]) => chip(r, c)).join("") : chip("—")}</div>
    ${regDropped ? `<div class="tsr-note" style="color:var(--dim2)">${regDropped} idea${regDropped === 1 ? "" : "s"} had no clean register label</div>` : ""}</div>`;

  const signalBlock = `<div class="tsr-block"><div class="tsr-k">${ic("monitor", 12)} Signals <span class="n">${live ? "live feed" : "config"}</span></div>
    <div class="tsr-tiles">${tile((gsum / n).toFixed(2), "avg gap")}${tile((vsum / n).toFixed(2), "velocity")}${tile(n, "ideas")}</div>
    <div class="tsr-chips" style="margin-top:9px">${sortEnt(gaps).length ? sortEnt(gaps).map(([g, c]) => chip(g, c)).join("") : chip("—")}</div></div>`;

  const routeBlock = `<div class="tsr-block"><div class="tsr-k">${ic("target", 12)} Routed to <span class="n">${Object.keys(fr).length}</span></div>
    <div class="tsr-chips">${sortEnt(fr).map(([f, c]) => chip(f, c)).join("")}</div>
    <div class="tsr-note">${contra} contradiction${contra === 1 ? "" : "s"} flagged for human review</div></div>`;

  const srcBlock = `<div class="tsr-block"><div class="tsr-k">${ic("external", 12)} Sources</div>
    <div class="tsr-chips">${srcs.size ? [...srcs].map((x) => `<span class="src">${esc(x)}</span>`).join("") : `<span class="src src-llm">LLM only — add feed / research keys in the Vault</span>`}</div></div>`;

  const topReg = sortEnt(regs)[0];
  const hi = `<b>${Object.keys(topics).length}</b> concepts · <b>${n}</b> ideas${topReg ? ` · ${esc(topReg[0])} leads` : ""} · avg gap <b>${(gsum / n).toFixed(2)}</b> · ${live ? "live feed" : "config"}`;
  return `<details class="tsr" open>
    <summary class="tsr-top"><span class="ic-wrap">${ic("target", 15)}</span><span class="tsr-title">Trend Spotting report</span><span class="tsr-hi">${hi}</span><span class="tsr-chev">▾</span></summary>
    <div class="tsr-grid">${audBlock}${conceptBlock}${regBlock}${signalBlock}${routeBlock}${srcBlock}</div>
  </details>`;
}

// ---- RECAP · "what actually went into this sweep" -------------------------
// Sits above the results. Answers, in one place: which concepts were armed,
// which search terms those concepts fired, what SEO research was in play, what
// you typed in the brief, which APIs were queried and what came back. Built
// from what was PERSISTED at sweep time (/journey/recap), so re-opening an old
// batch recaps THAT batch — not whatever is currently ticked on screen.
// Plain-English scoring explainer. The four numbers on every idea are opaque
// unless someone says, in words, what each one measured and why it came out
// where it did — so this reads the ACTUAL averages off this sweep's ideas and
// narrates them, rather than describing the formula in the abstract.
function scoreExplainer(stories) {
  const n = (stories || []).length; if (!n) return "";
  const avg = (k) => (stories.reduce((s, x) => s + (Number(x.score_breakdown?.[k]) || 0), 0) / n);
  const w = stories[0]?.score_breakdown?.weights || { gap: .35, velocity: .25, strategic: .20, historical: .20 };
  const band = (v, lo, hi, low, mid, high) => v < lo ? low : v < hi ? mid : high;
  const g = avg("gap"), v = avg("velocity"), st = avg("strategic"), h = avg("historical");
  const row = (label, val, weight, text) => `<div class="sx-r">
    <div class="sx-k">${label} <span class="sx-v">${val.toFixed(2)}</span></div><div>${text} <span style="color:var(--dim2)">Counts for ${Math.round(weight * 100)}% of the final score.</span></div></div>`;
  return `<div class="tsr-block span2 sx">
    <div class="tsr-k">${ic("bolt", 12)} Why these ideas scored what they did</div>
    ${row("Gap", g, w.gap, band(g, .35, .7,
      "<b>Low.</b> There is already plenty of content answering these questions — the audience is being served, so a new piece has to be better, not just present.",
      "<b>Moderate.</b> More is being asked than answered, but the space is not empty. Worth publishing with a distinct angle.",
      "<b>High.</b> People are asking far more than anyone is answering. This is open ground."))}
    ${row("Velocity", v, w.velocity, band(v, .3, .7,
      "<b>Slow.</b> The conversation is steady rather than spiking — evergreen, not urgent.",
      "<b>Building.</b> Views are accumulating at a healthy rate. There is momentum without a stampede.",
      "<b>Hot.</b> The top item is moving very fast — publish soon or miss the wave."))}
    ${row("Strategic", st, w.strategic, `How much this theme matters to the business, set by you in the theme's weight. Not measured from the feed — this is your priority, not the internet's.${(stories[0]?.score_breakdown?.season || []).length ? ` <b>Lifted this month by ${(stories[0].score_breakdown.season).map(esc).join(", ")}.</b>` : ""}${(stories[0]?.score_breakdown?.push || []).length ? ` <b>Business push: ${(stories[0].score_breakdown.push).map(esc).join(", ")}.</b>` : ""}`)}
    ${row("Historical", h, w.historical, "How often you have accepted ideas in this sub-series before. Every Used, Saved and Rejected you mark feeds this, so the ranking tracks your taste over time.")}
    <div class="tsr-note" style="margin-top:8px">Final score = ${w.gap} × gap + ${w.velocity} × velocity + ${w.strategic} × strategic + ${w.historical} × historical. All four weights are editable in <b>Settings</b>.</div>
    ${gapAnalysis(stories)}
  </div>`;
}

// GAP ANALYSIS — the heart of it: what people are ASKING (comments) measured
// against what already ANSWERS them (content). Demand vs supply, per theme,
// with the read-out in plain words and what to do about it.
function gapAnalysis(stories) {
  const byTopic = {};
  for (const s of stories || []) {
    const b = s.score_breakdown || {}, k = s.demand_topic || "—";
    if (!byTopic[k]) byTopic[k] = { demand: 0, supply: 0, gap: 0, type: s.gap_type, n: 0 };
    const t = byTopic[k];
    t.demand = Math.max(t.demand, Number(b.demand) || 0);
    t.supply = Math.max(t.supply, Number(b.supply) || 0);
    t.gap += Number(b.gap) || 0; t.n++; t.type = s.gap_type || t.type;
  }
  const rows = Object.entries(byTopic);
  if (!rows.length) return "";
  const READ = {
    unanswered: ["Unanswered", "Far more is being asked than answered. Publish here — the questions are sitting there unclaimed."],
    stale: ["Stale", "Content exists but it is old. A fresh, current take will outrank it without needing a new angle."],
    thin: ["Thin", "Almost nothing exists on this. Either it is genuinely open ground, or the search terms are too narrow — check the terms before committing."],
    wrong: ["Being answered badly", "The existing answers are poor or misleading. Correction is the angle."],
    emerging: ["Emerging", "Small but moving fast. Early — get in before the field fills."],
  };
  return `<div class="ga">
    <div class="tsr-k" style="margin-top:4px">${ic("target", 12)} Gap analysis — what they ask vs what already answers</div>
    <div class="tsr-note" style="margin-bottom:8px">Demand is counted from real questions in YouTube and Reddit <b>comments</b>. Supply is the content already covering that theme. The gap is the ratio — a high gap means people are asking and nobody is answering.</div>
    ${rows.map(([topic, t]) => {
      const g = t.gap / Math.max(1, t.n);
      const [label, tip] = READ[t.type] || ["Measured", "Demand and supply are close — a strong angle matters more than the topic itself."];
      return `<div class="ga-r">
        <div class="ga-t">${esc(topic)}<span class="ga-b ${esc(t.type || "")}">${esc(label)}</span></div>
        <div class="ga-m"><b>${t.demand}</b> question${t.demand === 1 ? "" : "s"} asked · <b>${t.supply}</b> piece${t.supply === 1 ? "" : "s"} of content already there · gap <b>${g.toFixed(2)}</b></div>
        <div class="ga-w">${esc(tip)}</div>
      </div>`;
    }).join("")}
    ${(RECAP?.feed?.comments_read) ? `<div class="tsr-note">Read from <b>${RECAP.feed.comments_read}</b> comments across <b>${RECAP.feed.collected || 0}</b> collected items this sweep.</div>` : ""}
  </div>`;
}

function recapBlock(stories) {
  const r = RECAP; if (!r) return "";
  const chip = (label, count) => `<span class="tsr-chip"><span class="t">${esc(label)}</span>${count != null ? `<b>${count}</b>` : ""}</span>`;
  const mut = (label) => `<span class="tsr-chip mut"><span class="t">${esc(label)}</span></span>`;
  const tile = (v, l) => `<div class="tsr-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const rt = r.routes || {}, f = r.feed || {}, g = r.guardrails || {};

  const routeBlock = `<div class="tsr-block"><div class="tsr-k">${ic("bolt", 12)} Feeds armed</div>
    <div class="tsr-chips">
      ${rt.trend ? chip("Trend Spotting") : mut("Trend Spotting · off")}
      ${rt.seo ? chip("SEO Inputs") : mut("SEO Inputs · off")}
      ${rt.talentmind ? chip("TalentMind") : mut("TalentMind · off")}
      ${rt.prompt ? chip("Your brief") : mut("no brief typed")}
    </div></div>`;

  // the concepts AND the literal queries they fired — the "YouTube requests"
  const conceptBlock = `<div class="tsr-block span2"><div class="tsr-k">${ic("pin", 12)} Concepts armed <span class="n">${(r.concepts || []).length}</span></div>
    ${(r.concepts || []).length ? (r.concepts || []).map((c) => `<div class="rcp-row">
        <div class="rcp-c">${esc(c.name)}${c.franchise ? `<span class="rcp-fr">→ ${esc(c.franchise)}</span>` : ""}</div>
        <div class="rcp-t">${(c.terms || []).length ? (c.terms || []).map((t) => `<span class="rcp-term">${esc(t)}</span>`).join("") : `<span class="rcp-term mut">no search terms set — add them in ⚙ edit concepts</span>`}</div>
      </div>`).join("") : `<div class="tsr-note">no concepts recorded for this batch</div>`}
    <div class="tsr-note">These terms are the exact queries fired at YouTube / Reddit.</div></div>`;

  const seoBlock = `<div class="tsr-block span2"><div class="tsr-k">${ic("box", 12)} SEO research in play <span class="n">${(r.seo || []).length}</span></div>
    ${(r.seo || []).length ? (r.seo || []).map((s) => `<div class="rcp-row">
        <div class="rcp-c">${esc(s.filename || s.kind || "paste")}${s.shape_id ? `<span class="rcp-fr">${esc(s.shape_id)}</span>` : ""}${s.rows ? `<span class="rcp-fr">${s.rows} rows</span>` : ""}</div>
        <div class="rcp-t"><span class="rcp-prev">${esc(String(s.preview || "").replace(/\s+/g, " ").slice(0, 180))}${(s.preview || "").length > 180 ? "…" : ""}</span></div>
      </div>`).join("") : `<div class="tsr-note">nothing pasted or uploaded — the sweep ran on concepts alone</div>`}</div>`;

  const briefBlock = `<div class="tsr-block span2"><div class="tsr-k">${ic("pin", 12)} Your brief</div>
    <div class="rcp-brief">${r.brief ? esc(r.brief) : `<span class="mut">nothing added — the "anything more to add?" box was left empty</span>`}</div></div>`;

  const srcEntries = Object.entries(f.sources || {});
  const feedBlock = `<div class="tsr-block span2"><div class="tsr-k">${ic("monitor", 12)} What the feed returned</div>
    <div class="tsr-chips">${srcEntries.length ? srcEntries.map(([s, c]) => chip(s, c)).join("") : mut("no live feed — LLM-only run")}</div>
    ${(f.errors || []).length ? `<div class="ferr">${(f.errors || []).map((e) => `<div class="ferr-r"><b>${esc(e.source)}</b> — ${esc(e.reason)}${e.reason === "out of quota" || e.reason === "key rejected" ? ` · <span class="ferr-a">check the key in Admin → Integrations</span>` : ""}</div>`).join("")}</div>` : ""}
    <div class="tsr-tiles" style="margin-top:9px">
      ${tile(f.collected ?? "—", "collected")}${tile(f.kept ?? "—", "kept")}${tile(f.dropped ?? "—", "filtered")}${tile(f.repeats ?? "—", "repeats")}
      ${tile(f.terms_fired ?? "—", "terms fired")}${tile(f.comments_read ?? "—", "comments read")}${tile(f.questions_found ?? "—", "questions")}</div>
    ${Object.keys(f.dropped_reasons || {}).length ? `<div class="tsr-chips" style="margin-top:9px">${Object.entries(f.dropped_reasons).map(([k, c]) => mut(`${k} · ${c}`)).join("")}</div>` : ""}
    ${(f.top_terms || []).length ? `<div class="tsr-note">terms that actually returned items: ${(f.top_terms || []).map(esc).join(" · ")}</div>` : ""}</div>`;

  const guardBlock = `<div class="tsr-block"><div class="tsr-k">${ic("target", 12)} Guardrails enforced</div>
    <div class="tsr-chips">${[g.audience, g.region, g.currency, (g.languages || []).join("/")].filter(Boolean).map((x) => chip(x)).join("") || mut("defaults")}</div>
    <div class="tsr-note">Items outside the allowed languages were dropped at collection, not just discouraged.</div></div>`;

  const outBlock = `<div class="tsr-block"><div class="tsr-k">${ic("box", 12)} Out</div>
    <div class="tsr-tiles">${tile(r.output?.ideas ?? 0, "ideas")}${tile((r.concepts || []).length, "concepts")}</div></div>`;

  const hi = `${(r.concepts || []).length} concepts · ${(r.seo || []).length} research input${(r.seo || []).length === 1 ? "" : "s"} · ${f.collected ?? 0} items collected · ${r.output?.ideas ?? 0} ideas`;
  return `<details class="tsr rcp" open>
    <summary class="tsr-top"><span class="ic-wrap">${ic("box", 15)}</span><span class="tsr-title">What went into this sweep</span><span class="tsr-hi">${hi}</span><span class="tsr-chev">▾</span></summary>
    <div class="tsr-grid">${routeBlock}${outBlock}${conceptBlock}${seoBlock}${briefBlock}${feedBlock}${guardBlock}${scoreExplainer(stories)}</div>
  </details>`;
}

// ---- STORY BOARDS · group a concept's 3 angles into one board -------------
// Each board = one demand concept: a lead idea (strongest angle) + alternatives.
// Three nested "why" layers: why this concept · why this angle · why this story.
const ANGLE_META = {
  "core": { cls: "angle-core", why: "the direct, safe lead — it answers the question head-on and carries the lowest contradiction risk." },
  "contrarian": { cls: "angle-contrarian", why: "flips a popular but shaky belief for a higher engagement ceiling — more contradiction risk, so the claim must be verified before publishing." },
  "insider-data": { cls: "angle-insider-data", why: "an authority play built on real numbers — strongest when a dataset or TalentMind cohort backs it (flagged when none exists yet)." },
};
const angleMeta = (s) => ANGLE_META[s.angle] || { cls: "", why: "a distinct take on the same concept." };
let TOPIC_Q = {}, LEAD_OVERRIDE = {}, _RENDER = { stories: null, franchises: [] };

function angleWhy(s) {
  const m = angleMeta(s);
  return `<b>${esc(s.angle || "angle")}</b> — ${m.why} Register “${esc(shortReg(s.emotional_register) || "—")}”, routed to <b>${esc(s.franchise)}</b>${s.one_up ? ` · 1Up ${esc(s.one_up)}` : ""}.${s.contradiction ? ` Flags a contradiction against ${esc(s.contradiction_of || "popular belief")} — we propose, we never assert.` : ""}`;
}
function conceptWhy(board) {
  const lead = board.lead, b = lead.score_breakdown || {}, n = board.all.length;
  const aud = GUARD ? [GUARD.region, GUARD.language, GUARD.audience].filter(Boolean).join(" · ") : "—";
  return `Picked because <b>demand</b> — ${b.demand ?? 0} audience questions — outweighs <b>supply</b> — ${b.supply ?? 0} existing items${lead.gap_type ? ` — a <b>${esc(lead.gap_type)}</b> gap` : ""}. Signal is ${b.live ? "<b>live feed</b>" : "config fallback (add YouTube / Reddit keys for a live signal)"}${b.velocity !== undefined ? ` · velocity <b>${(Number(b.velocity) || 0).toFixed(2)}</b>` : ""}. Audience: <b>${esc(aud)}</b>, from your guardrails. ${n} angle${n === 1 ? "" : "s"} generated for this concept through the gated RayDar pipelines.`;
}
function storyReason(s) {
  const g = s.topic_guide || {}, brd = s.score_breakdown || {}, w = brd.weights || {};
  const bar = (l, v) => `<div class="sbar"><span>${l}</span><span class="track2"><span class="fill2" style="width:${Math.round((Number(v) || 0) * 100)}%"></span></span><span>${(Number(v) || 0).toFixed(2)}</span></div>`;
  return `${g.take ? `<div class="why"><b>Take:</b> ${esc(g.take)}</div>${(g.beats || []).length ? `<ul>${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}` : ""}
    <div class="why"><b>Why now:</b> ${esc(s.why_now || "—")}</div>
    ${s.why_relevant ? `<div class="why"><b>Why relevant:</b> ${esc(s.why_relevant)}</div>` : ""}
    <div class="why"><b>Evidence:</b> ${esc(s.evidence || "—")}</div>
    ${s.contradiction ? `<div class="why"><b>Contradicts:</b> ${esc(s.contradiction_of || "popular belief")}</div>` : ""}
    <div class="g-l" style="margin-top:10px;font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim2)">Composite ${(Number(s.score) * 100).toFixed(0)}${w.gap ? ` · weights ${w.gap}·${w.velocity}·${w.strategic}·${w.historical}` : ""}</div>
    ${bar("gap", brd.gap)}${bar("velocity", brd.velocity)}${bar("strategic", brd.strategic)}${bar("historical", brd.historical)}
    ${brd.live !== undefined ? `<div class="why" style="font-family:var(--mono);font-size:10.5px;color:var(--dim2)">signal: ${brd.live ? "live feed" : "config fallback"} · demand ${brd.demand ?? 0} Qs · supply ${brd.supply ?? 0} items</div>` : ""}`;
}
// box-in-box: the actual sources we pulled, each opens in a new window
function sourcesBox(s) {
  const refs = (s.source_refs || []).filter((r) => r && r.url);
  return `<div class="srcbox">
    <div class="srcbox-h">${ic("external")} Sources gathered${refs.length ? ` · ${refs.length}` : ""}</div>
    ${refs.length ? refs.map((r) => `<a class="srclink" href="${esc(r.url)}" target="_blank" rel="noopener">
        <span class="stag${r.via_seo ? " seo" : ""}">${r.via_seo ? "✨ SEO" : esc(r.source || "web")}</span>
        <span class="stt">${esc(r.title || r.url)}${r.via_seo ? ` <span class="svia">via “${esc(r.via_seo)}”</span>` : ""}</span>
        <span class="sgo">open ↗</span></a>`).join("")
      : `<div class="srcbox-empty">LLM only — no external sources for this idea yet. Add YouTube / Reddit / Tavily / Serper keys in the Vault to ground it with links.</div>`}
  </div>`;
}
function ideaChips(s, franchises) {
  const tag = FR_TAG[frIndexIn(franchises, s.franchise) % FR_TAG.length];
  return `<span class="chip ${tag}">${ic("target")} ${esc(s.franchise)}</span>
    ${s.one_up ? `<span class="chip">${esc(s.one_up)}</span>` : ""}
    ${shortReg(s.emotional_register) ? `<span class="chip">${esc(shortReg(s.emotional_register))}</span>` : ""}
    ${s.platform ? `<span class="chip">${ic("monitor")} ${esc(s.platform)}</span>` : ""}`;
}
function ideaActs(s) {
  return `<div class="acts">
    <button class="btn small" onclick="idea(${s.id},'used')">${ic("check")} Used</button>
    <button class="btn small" onclick="idea(${s.id},'saved')">${ic("save")} Save</button>
    <button class="btn small" onclick="rejectIdea(${s.id})">${ic("x")} Reject</button>
    <button class="btn small" onclick="editIdea(${s.id},'${esc(s.heading).replace(/'/g, "\\'")}')">${ic("edit")} Edit</button>
    <label class="build"><input type="checkbox" ${s.selected ? "checked" : ""} onchange="idea(${s.id},'select')"> build</label>
  </div>`;
}
// full provenance: the grey box-in-box that walks every pipeline step for THIS
// idea — the actual parameters used, what the LLM produced, how it was checked.
function pipelineTrace(s) {
  const b = s.score_breakdown || {}, w = b.weights || {}, g = s.topic_guide || {};
  const topic = (ALL_TOPICS || []).find((t) => t.name === s.demand_topic) || {};
  const terms = topic.terms ? (Array.isArray(topic.terms) ? topic.terms.join(", ") : String(topic.terms)) : "—";
  const aud = GUARD ? [GUARD.region, GUARD.language, GUARD.audience].filter(Boolean).join(" · ") : "—";
  const srcs = b.sources || [];
  const refs = (s.source_refs || []).filter((r) => r && r.url);
  const pct = (Number(s.score) * 100).toFixed(0);
  const part = (v, wt) => ((Number(v) || 0) * (Number(wt) || 0)).toFixed(3);
  const reg = shortReg(s.emotional_register);
  const step = (n, name, pipe, rows) => `<div class="tstep">
    <div class="tstep-top"><span class="tstep-n">${n}</span><span class="tstep-name">${name}</span>${pipe ? `<span class="tstep-pipe">${esc(pipe)}</span>` : ""}</div>
    ${rows.filter(([, v]) => v).map(([l, v]) => `<div class="tstep-row"><span class="tl">${l}</span><span class="tv">${v}</span></div>`).join("")}
  </div>`;
  return `<div class="trace">
    ${step(1, "Hunger — the demand concept", "Trend Spotting", [
      ["Audience", esc(aud)],
      ["Concept", esc(s.demand_topic) + (topic.question ? ` — “${esc(topic.question)}”` : "")],
      ["Why picked", `an active demand concept on the radar${topic.strategic_weight ? ` · strategic weight ${esc(String(topic.strategic_weight))}` : ""}`],
    ])}
    ${step(2, "Collect — sweep the feed", "youtube · reddit · news · research", [
      ["Search terms", esc(terms)],
      ["Channels", srcs.length ? srcs.map((x) => `<span class="src">${esc(x)}</span>`).join(" ") : `<span class="src src-llm">none live — config fallback</span>`],
      ["Pulled", refs.length ? `${refs.length} source${refs.length === 1 ? "" : "s"} with links (see step 6)` : "no external items — LLM-only run"],
    ])}
    ${step(3, "Classify — route + label", "raydar-classify", [
      ["Franchise", esc(s.franchise) + (s.one_up ? ` · 1Up ${esc(s.one_up)}` : "")],
      ["Register", reg ? esc(reg) : "—"],
      ["Format", esc(s.platform || "—")],
      ["Gap type", esc(s.gap_type || "—")],
    ])}
    ${step(4, "Signals — demand vs supply", "topicSignals()", [
      ["Demand", `${b.demand ?? 0} audience questions`],
      ["Supply", `${b.supply ?? 0} existing items`],
      ["Velocity", `${(Number(b.velocity) || 0).toFixed(2)} · views ÷ day, normalised`],
      ["Gap", `${(Number(b.gap) || 0).toFixed(2)} · signal <b>${b.live ? "live feed" : "config fallback"}</b>`],
    ])}
    ${step(5, "Ideate — the LLM writes the brief", `feedstory-generate · ${esc(s.angle || "core")} angle`, [
      ["Guardrails", "India / English brief prepended · propose, never assert"],
      ["Heading", `“${esc(s.heading)}”`],
      ["Angle taken", g.take ? esc(g.take) : esc(s.summary || "—")],
      ["Beats", (g.beats || []).length ? `<ul class="tbeats">${g.beats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""],
    ])}
    ${step(6, "Validate — evidence + fact-check", "raydar-contradiction · research APIs", [
      ["Evidence", esc(s.evidence || "—")],
      ["Sources cited", refs.length ? refs.map((r) => `<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source || "src")} ↗</a>`).join(" ") : `<span class="src src-llm">none — add research keys to ground with citations</span>`],
      ["Contradiction", s.contradiction ? `flags a claim against ${esc(s.contradiction_of || "popular belief")} — raised for a human to verify, never asserted` : "none flagged"],
    ])}
    ${step(7, "Rank — composite score", "raydar-rank", [
      ["Weights", w.gap ? `gap ${w.gap} · velocity ${w.velocity} · strategic ${w.strategic} · historical ${w.historical}` : "gap .35 · velocity .25 · strategic .20 · historical .20"],
      ["Contributions", `gap ${part(b.gap, w.gap ?? .35)} + velocity ${part(b.velocity, w.velocity ?? .25)} + strategic ${part(b.strategic, w.strategic ?? .20)} + historical ${part(b.historical, w.historical ?? .20)}`],
      ["Composite", `<b>${pct}</b> / 100`],
    ])}
  </div>`;
}
// the key deliverable, boxed: the catchy optimized title + the headline (with copy).
// title comes from topic_guide.title on fresh sweeps; falls back to the headline.
function deliverableBox(s) {
  const g = s.topic_guide || {};
  const title = (g.title && g.title.trim() && g.title.trim() !== s.heading) ? g.title.trim() : null;
  const row = (label, val, which, big) => `<div class="deliv-row"><span class="dl">${label}</span>
    <div class="dtop"><span class="dv${big ? "" : " title"}">${esc(val)}</span><button class="cpy" onclick="event.stopPropagation();copyIdea(${s.id},'${which}',this)">copy</button></div></div>`;
  return `<div class="deliv"><div class="deliv-k">${ic("target", 12)} The deliverable</div>
    ${title ? row("Title · optimized", title, "title", false) : ""}
    ${row("Headline", s.heading, "headline", true)}</div>`;
}
window.copyIdea = (id, which, btn) => {
  const s = _STORIES[id]; if (!s) return;
  const g = s.topic_guide || {};
  const txt = which === "title" ? (g.title || s.heading) : s.heading;
  (navigator.clipboard?.writeText(txt) || Promise.resolve()).then(() => { if (btn) { btn.textContent = "copied"; setTimeout(() => (btn.textContent = "copy"), 1200); } });
};
// fact-check confidence badge — score + why (+ any published fact-check reviews).
// Reads score_breakdown.fact_check; shows on every idea on the results page.
function factCheckBadge(s) {
  const f = (s.score_breakdown || {}).fact_check;
  if (!f) return "";
  const cls = f.score >= 80 ? "fc-good" : f.score >= 60 ? "fc-ok" : f.score >= 40 ? "fc-warn" : "fc-bad";
  const revs = (f.reviews || []).length
    ? `<div class="fc-revs">${f.reviews.map((r) => `<a class="fc-rev" href="${esc(r.url || "#")}" target="_blank" rel="noopener">${esc(r.publisher || "source")}: “${esc(r.rating || "")}” ↗</a>`).join("")}</div>` : "";
  return `<div class="factcheck ${cls}">
    <div class="fc-top"><span class="fc-score">✓ Fact-check ${f.score}<span class="fc-out">/100</span></span><span class="fc-label">${esc(f.label || "")}</span></div>
    ${f.why ? `<div class="fc-why">${esc(f.why)}</div>` : ""}${revs}</div>`;
}
function leadIdea(s, franchises) {
  const m = angleMeta(s);
  return `<div class="lead">
    <div class="idea-topline">
      <span class="chip ${m.cls}" style="cursor:default">${esc(s.angle || "core")}</span>
      ${ideaChips(s, franchises)}
      <span class="idea-score">score ${(Number(s.score) * 100).toFixed(0)}</span>
    </div>
    ${deliverableBox(s)}
    ${factCheckBadge(s)}
    <div class="why-pair">
      <details class="whyx"><summary><span class="q">e</span> why this angle</summary><div class="whyx-b">${angleWhy(s)}</div></details>
      <details class="whyx"><summary><span class="q">e</span> why this story</summary><div class="whyx-b">${storyReason(s)}</div></details>
      <details class="whyx"><summary><span class="q">e</span> how RayDar built this — step by step</summary>${pipelineTrace(s)}</details>
    </div>
    ${sourcesBox(s)}
    ${ideaActs(s)}
  </div>`;
}
function altIdea(s, franchises, topicKey) {
  const m = angleMeta(s);
  return `<details class="alt" id="card-${s.id}">
    <summary>
      <span class="caret">▸</span>
      <span class="chip ${m.cls}" style="cursor:default">${esc(s.angle || "angle")}</span>
      <span class="ah">${esc(s.heading)}</span>
      <span class="alt-score">score ${(Number(s.score) * 100).toFixed(0)}</span>
      <button class="mklead" onclick="event.preventDefault();event.stopPropagation();promoteLead('${topicKey}',${s.id})" title="Make this the lead idea">↑ make lead</button>
    </summary>
    <div class="alt-body">
      <div style="margin-top:12px">${deliverableBox(s)}</div>
      ${factCheckBadge(s)}
      <div class="chips">${ideaChips(s, franchises)}</div>
      <details class="whyx" open><summary><span class="q">e</span> why this angle</summary><div class="whyx-b">${angleWhy(s)}</div></details>
      <details class="whyx"><summary><span class="q">e</span> why this story</summary><div class="whyx-b">${storyReason(s)}</div></details>
      <details class="whyx"><summary><span class="q">e</span> how RayDar built this — step by step</summary>${pipelineTrace(s)}</details>
      ${sourcesBox(s)}
      ${ideaActs(s)}
    </div>
  </details>`;
}
function storyBoard(board, i, franchises) {
  const lead = board.lead, fb = lead.feedback, q = TOPIC_Q[board.topic];
  return `<article class="board ${fb || ""}" id="board-${board.key}">
    <div class="board-top">
      <span class="board-rank">#${i + 1}<span class="pct">${(Number(lead.score) * 100).toFixed(0)}</span></span>
      <span class="exp" title="Explainable AI — the maths behind the lead idea" onclick="explainIdea(${lead.id})">e</span>
      ${lead.gap_type ? `<span class="chip tag-cyan" style="cursor:default">${esc(lead.gap_type)}</span>` : ""}
      ${board.all.some((x) => x.contradiction) ? `<span class="chip flag" style="cursor:default">${ic("bolt")} contradiction</span>` : ""}
      ${fb ? `<span class="chip ${fb === "used" ? "tag-grn" : fb === "saved" ? "tag-amber" : "tag-mag"}" style="cursor:default">${esc(fb)}</span>` : ""}
      <span class="board-kind" style="margin-left:auto">Story board · ${board.all.length} angle${board.all.length === 1 ? "" : "s"}</span>
    </div>
    <h3 class="board-q">${esc(board.topic)}</h3>
    ${q ? `<div class="board-qq"><b>Concept</b> ${esc(q)}</div>` : ""}
    <p class="board-sum"><span class="lede">Summary</span>${esc(lead.summary || "")}</p>
    <details class="whyx"><summary><span class="q">e</span> why this concept</summary><div class="whyx-b">${conceptWhy(board)}</div></details>

    <div class="lead-label">Lead idea · ${esc(lead.angle || "core")} angle</div>
    ${leadIdea(lead, franchises)}

    ${board.alts.length ? `<div class="alts-label">Alternatives · ${board.alts.length} other angle${board.alts.length === 1 ? "" : "s"}</div>
      ${board.alts.map((a) => altIdea(a, franchises, board.key)).join("")}` : ""}
  </article>`;
}
function groupBoards(stories) {
  const map = new Map();
  for (const s of stories) { _STORIES[s.id] = s; const k = s.demand_topic || "—"; if (!map.has(k)) map.set(k, []); map.get(k).push(s); }
  const boards = [];
  for (const [topic, arr] of map) {
    arr.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const key = String(topic).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    let lead = arr[0];
    const ov = LEAD_OVERRIDE[key];
    if (ov) { const f = arr.find((x) => x.id === ov); if (f) lead = f; }
    boards.push({ topic, key, all: arr, lead, alts: arr.filter((x) => x.id !== lead.id) });
  }
  boards.sort((a, b) => (Number(b.lead.score) || 0) - (Number(a.lead.score) || 0));
  return boards;
}
window.promoteLead = (key, id) => { LEAD_OVERRIDE[key] = id; renderIdeas(_RENDER.stories, _RENDER.franchises); };

// results-page "top videos that scored high" block — the live feed snapshot,
// ranked by velocity, each row links out to the real YouTube video / Reddit post.
let FEED_SIGNAL = null;
const _srcIcon = (s) => s === "youtube" ? "▶️" : s === "reddit" ? "👽" : s === "news" ? "📰" : "🌐";
const _nfmt = (n) => Number(n || 0).toLocaleString();
const _compact = (n) => { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n); };
function feedSignalBlock() {
  const d = Array.isArray(FEED_SIGNAL) ? { kept: FEED_SIGNAL, dropped: [], stats: null } : (FEED_SIGNAL || {});
  const kept = d.kept || [], dropped = d.dropped || [], repeats = d.repeats || [], st = d.stats;
  if (!kept.length && !dropped.length && !repeats.length) return "";
  const why = (v) => {
    const b = [];
    if (v.views) b.push(`${_nfmt(v.views)} views${v.ageDays ? ` in ${v.ageDays}d` : ""}`);
    if (v.velocity) b.push(`velocity ${v.velocity.toFixed(2)}`);
    if (v.questions) b.push(`${v.questions} question-comment${v.questions === 1 ? "" : "s"}`);
    else if (v.comments) b.push(`${v.comments} comments`);
    return b.join(" · ") || "collected signal";
  };
  const grp = (v) => v.topic === "__seo__" ? "seo" : (v.source || "other");
  const keptRow = (v, i) => `<a class="fsig-row" data-g="${grp(v)}" href="${esc(v.url)}" target="_blank" rel="noopener" title="open on ${esc(v.source)} ↗">
    <span class="fsig-rank">#${i + 1}</span><span class="fsig-src">${_srcIcon(v.source)}</span>
    <span class="fsig-main"><span class="fsig-title">${esc(v.title || "(untitled)")}</span><span class="fsig-why">${esc(why(v))}${v.topic === "__seo__" && v.term ? ` · <span class="fsig-match">from your SEO “${esc(v.term)}”</span>` : v.match ? ` · <span class="fsig-match">matches “${esc(v.match)}”</span>` : ""}</span></span>
    <span class="fsig-vel"><span class="fsig-bar"><span style="width:${Math.round((v.velocity || 0) * 100)}%"></span></span><b>${(v.velocity || 0).toFixed(2)}</b></span>
    <span class="fsig-ext">↗</span></a>`;
  const dropRow = (v) => `<a class="fsig-row drop" href="${esc(v.url)}" target="_blank" rel="noopener" title="open ↗">
    <span class="fsig-src">${_srcIcon(v.source)}</span>
    <span class="fsig-main"><span class="fsig-title">${esc(v.title || "(untitled)")}</span><span class="fsig-why">${_nfmt(v.views)} views · dropped — ${esc(v.reason || "off-topic")}</span></span>
    <span class="fsig-ext">↗</span></a>`;
  const statsStrip = st ? `<div class="fsig-stats">
    ${st.collected != null ? `<span class="fst"><b>${st.collected}</b> items swept</span>` : ""}
    ${st.terms ? `<span class="fst"><b>${st.terms}</b> search terms</span>` : ""}
    ${Object.entries(st.sources || {}).map(([s, n]) => `<span class="fst">${_srcIcon(s)} <b>${n}</b></span>`).join("")}
    ${st.views_analysed ? `<span class="fst"><b>${_compact(st.views_analysed)}</b> views analysed</span>` : ""}
    ${st.questions ? `<span class="fst"><b>${st.questions}</b> question-comments mined</span>` : ""}
    ${st.kept != null ? `<span class="fst on"><b>${st.kept}</b> on-topic</span>` : ""}
    ${st.dropped ? `<span class="fst off"><b>${st.dropped}</b> filtered</span>` : ""}
    ${st.repeats ? `<span class="fst off"><b>${st.repeats}</b> repeats hidden</span>` : ""}
  </div>` : "";
  const droppedBlock = dropped.length ? `<details class="fsig-dropped" open><summary>▸ ${dropped.length} filtered out — see what &amp; why (Shorts · memes · language · off-topic)</summary>${dropped.map(dropRow).join("")}</details>` : "";
  // items seen in an EARLIER sweep — hidden by default, never removed (first sighting stays the record)
  const repeatRow = (v) => `<a class="fsig-row drop" href="${esc(v.url)}" target="_blank" rel="noopener" title="open ↗">
    <span class="fsig-src">${_srcIcon(v.source)}</span>
    <span class="fsig-main"><span class="fsig-title">${esc(v.title || "(untitled)")}</span><span class="fsig-why">${_nfmt(v.views)} views · already surfaced in an earlier sweep</span></span>
    <span class="fsig-ext">↗</span></a>`;
  const repeatsBlock = repeats.length ? `<details class="fsig-dropped" open><summary>▸ ${repeats.length} repeat${repeats.length === 1 ? "" : "s"} from earlier sweeps — hidden, not removed</summary>${repeats.map(repeatRow).join("")}</details>` : "";
  // tabs by source (YouTube · Reddit · SEO), only when more than one group is present
  const TAB_META = { youtube: { i: "▶️", l: "YouTube" }, reddit: { i: "👽", l: "Reddit" }, seo: { i: "✨", l: "SEO" }, other: { i: "🌐", l: "Other" } };
  const counts = kept.reduce((m, v) => { const g = grp(v); m[g] = (m[g] || 0) + 1; return m; }, {});
  const order = ["youtube", "reddit", "seo", "other"].filter((g) => counts[g]);
  const tabs = order.length > 1 ? `<div class="fsig-tabs">
    <button class="ft on" onclick="fsigTab(this,'all')">All <b>${kept.length}</b></button>
    ${order.map((g) => `<button class="ft" onclick="fsigTab(this,'${g}')">${TAB_META[g].i} ${TAB_META[g].l} <b>${counts[g]}</b></button>`).join("")}
  </div>` : "";
  return `<details class="fsig" open>
    <summary><span class="fsig-k">◎ Signal — top ${kept.some((f) => f.source === "youtube") ? "videos" : "items"} that scored high</span><span class="fsig-n">${kept.length}</span></summary>
    ${statsStrip}
    <div class="fsig-note">Ranked by velocity (views ÷ days) — the live demand signal behind these ideas.${counts.seo ? " The <b>SEO</b> tab is what your uploaded keywords pulled in." : ""} Click any to open ↗</div>
    ${tabs}
    <div class="fsig-rows" data-tab="all">${kept.map(keptRow).join("")}</div>
    ${repeatsBlock}${droppedBlock}</details>`;
}
window.fsigTab = (btn, t) => {
  const wrap = btn.closest(".fsig"); if (!wrap) return;
  wrap.querySelectorAll(".fsig-tabs .ft").forEach((b) => b.classList.toggle("on", b === btn));
  const rows = wrap.querySelector(".fsig-rows"); if (rows) rows.dataset.tab = t;
};
function renderIdeas(stories, franchises) {
  const host = $("#stageIdeas");
  if (!stories) { host.innerHTML = `<p class="intro"><b>IDEAS</b> appear here once the sweep completes — each concept becomes a <b>story board</b>: a lead idea plus alternative angles, all ranked by signal strength.</p><div class="empty">// awaiting sweep //</div>`; return; }
  _RENDER = { stories, franchises };
  TOPIC_Q = Object.fromEntries((ALL_TOPICS || []).map((t) => [t.name, t.question]));
  // ONCE YOU'VE JUDGED SOMETHING IT LEAVES THE LIST. The working list only
  // holds what still needs a decision, so it gets SHORTER as you work instead
  // of longer. Judged ideas aren't hidden or lost — they drop into a "done"
  // drawer right below, and they're always in the Library.
  // client-side idea filters — theme, feeling, gap type, and sort order
  const keep = (s) => (IDEA_TH === "all" || s.demand_topic === IDEA_TH)
    && (IDEA_RG === "all" || shortReg(s.emotional_register) === IDEA_RG)
    && (IDEA_GP === "all" || s.gap_type === IDEA_GP);
  const all = stories.filter(keep);
  const pending = all.filter((s) => !s.feedback);
  const done = all.filter((s) => s.feedback);
  let shown = SHOW_DONE ? all : pending;
  if (IDEA_SORT === "theme") shown = [...shown].sort((a, b) => String(a.demand_topic).localeCompare(String(b.demand_topic)) || (b.score - a.score));
  else if (IDEA_SORT === "new") shown = [...shown].sort((a, b) => b.id - a.id);
  const boards = groupBoards(shown);
  const doneBoards = groupBoards(done);
  const themes = [...new Set(stories.map((s) => s.demand_topic).filter(Boolean))].sort();
  const regs = [...new Set(stories.map((s) => shortReg(s.emotional_register)).filter(Boolean))].sort();
  const f = (label, cur, opts, fn, hint) => `<label class="lf" title="${esc(hint || "")}"><span class="lf-k">${label}</span>
    <select onchange="${fn}(this.value)">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const filter = `<div class="ih">
      <div class="ih-top">
        <div><h2 class="ih-t">Content ideas</h2>
          <div class="ih-s">${esc(BATCH?.name || "this batch")}${RECAP?.brief ? ` · “${esc(String(RECAP.brief).slice(0, 60))}”` : ""}</div></div>
        <a class="gateslink" href="#" onclick="goStage(2);return false" title="the evidence behind these ideas">◈ See the sweep evidence</a>
      </div>
      <div class="lib-filters" style="margin:0">
        ${f("1Up series", FR, [["all", "all series"], ...(franchises || []).map((x) => [x.name, x.name])], "setFR", "Which 1Up sub-series it routes to")}
        ${f("Theme", IDEA_TH, [["all", "all themes"], ...themes.map((t) => [t, t])], "setIdeaTh", "The demand concept it came from")}
        ${regs.length ? f("Feeling", IDEA_RG, [["all", "any feeling"], ...regs.map((r) => [r, r])], "setIdeaRg", "The emotional register it hits") : ""}
        ${f("Gap", IDEA_GP, [["all", "any gap"], ["unanswered", "unanswered"], ["stale", "stale"], ["thin", "thin"], ["emerging", "emerging"]], "setIdeaGp", "Why there is room for this")}
        ${f("Sort", IDEA_SORT, [["score", "strongest first"], ["theme", "by theme"], ["new", "newest first"]], "setIdeaSort", "How the boards are ordered")}
        <span class="lf-n">${pending.length} to judge${done.length ? ` · ${done.length} done` : ""}</span>
        ${[FR, IDEA_TH, IDEA_RG, IDEA_GP].some((x) => x !== "all") ? `<button class="btn small" onclick="clearIdeaFilters()">Clear</button>` : ""}
        ${done.length ? `<button class="btn small" onclick="toggleDone()">${SHOW_DONE ? "Hide done" : `Show all (${stories.length})`}</button>` : ""}
      </div>
    </div>`;
  const doneDrawer = (!SHOW_DONE && done.length) ? `<details class="donedrawer">
      <summary>${done.length} idea${done.length === 1 ? "" : "s"} you've already judged — ${["used", "saved", "rejected"].map((k) => `${done.filter((s) => s.feedback === k).length} ${k}`).join(" · ")}</summary>
      <div class="boards" style="margin-top:12px">${doneBoards.map((b, i) => storyBoard(b, i, franchises)).join("")}</div>
    </details>` : "";
  const emptyMsg = pending.length === 0 && done.length
    ? `<div class="empty">// all judged — nothing left in this batch //</div>`
    : `<div class="empty">// no ideas${FR !== "all" ? " for " + esc(FR) : ""} //</div>`;
  host.innerHTML = `<p class="intro"><b>CONTENT IDEAS</b> — each concept becomes a story board: a title, the angle, and the justification behind it. Mark each one <b>Used</b>, <b>Save</b> or <b>Reject</b> and it drops out of this list into the done drawer below, so the list shrinks as you go. Everything stays findable in the <b>Library</b>.</p>` +
    filter + (boards.length ? `<div class="boards">${boards.map((b, i) => storyBoard(b, i, franchises)).join("")}</div>` : emptyMsg) + doneDrawer;
  renderSweepReport();     // keep step 2 in sync with the same data
}

// ---- STEP 02 · SWEEP — the evidence, not the ideas -------------------------
// Everything that explains HOW the sweep ran lives here: what went in, the
// trend-spotting report, and the signal (top videos, SEO terms, Reddit).
// The ideas themselves live on step 3, so neither page is a wall.
function renderSweepReport() {
  const host = $("#stageSweep"); if (!host) return;
  const stories = _RENDER?.stories;
  if (!stories || !stories.length) {
    host.innerHTML = `<p class="intro"><b>SWEEP</b> — what RayDar collected, how it read it, and the evidence behind every idea.</p>
      <div class="empty">// run a sweep from Demand Setting to see the evidence //</div>`;
    return;
  }
  host.innerHTML = `<p class="intro"><b>SWEEP</b> — the evidence behind this batch: what went in, what the feed returned, and how each theme scored. The ideas themselves are on <b>Content Ideas</b>.</p>`
    + recapBlock(stories) + trendReport(stories) + feedSignalBlock()
    + `<div class="process" style="margin-top:18px"><button class="sweep-btn" onclick="goStage(3)">◎ See the content ideas →</button></div>`;
}
window.toggleDone = () => { SHOW_DONE = !SHOW_DONE; loadIdeas(); };
window.setIdeaTh = (v) => { IDEA_TH = v; loadIdeas(); };
window.setIdeaRg = (v) => { IDEA_RG = v; loadIdeas(); };
window.setIdeaGp = (v) => { IDEA_GP = v; loadIdeas(); };
window.setIdeaSort = (v) => { IDEA_SORT = v; loadIdeas(); };
window.clearIdeaFilters = () => { FR = IDEA_TH = IDEA_RG = IDEA_GP = "all"; loadIdeas(); };

// The bridge from Journey 1 to Journey 2. Ideas on their own stop here; this is
// how a batch becomes briefed, owned, dated work. Without a door this obvious
// nobody finds the Journey tab, because nothing on the results page points at it.
function journeyCTA(stories) {
  if (!JOURNEY_ON) return "";
  const enrolled = (stories || []).filter((s) => s.stage).length;
  return `<div class="jcta">
    <div class="jcta-t">${enrolled ? "This batch is already in the journey" : "Turn these ideas into actual work"}</div>
    <div class="jcta-s">${enrolled
      ? `${enrolled} topic${enrolled === 1 ? " is" : "s are"} being tracked through the six stations — shortlist, research, brief, writer, published.`
      : "Ideas stop here. The journey takes them the rest of the way: you shortlist, SEO drops their research in, RayDar builds the brief, you put a writer and a date on it — every step logged."}</div>
    <button class="sweep-btn jcta-b" onclick="setView('journey')">${enrolled ? "◎ Open the journey" : "◎ Start the journey with this batch"} →</button>
  </div>`;
}
window.setFR = (v) => { FR = v; loadIdeas(); };
function refreshCurrent() { if (VIEW === "library") loadLibrary(); else loadIdeas(); }
window.idea = async (id, action) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); refreshCurrent(); };
window.rejectIdea = (id) => rdPrompt("Reject idea", "Reason — off-brand · not interesting · already covered · wrong timing", "not interesting", async (reason) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rejected", reason }) }); refreshCurrent(); });
window.editIdea = (id, heading) => rdPrompt("Edit heading", "", heading, async (h) => { if (!h) return; await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", heading: h }) }); refreshCurrent(); });


// Purge old sweeps. Two-step by design: it always PREVIEWS first and names what
// would go, and it can never remove a batch holding an idea you accepted.
window.purgeBatches = async () => {
  const m = $("#purgeMode")?.value || "30";
  const body = m === "nuke" ? { force: true } : m === "all" ? {} : m.startsWith("keep") ? { keep_last: Number(m.slice(4)) } : { keep_days: Number(m) };
  const p = await (await fetch("/api/wh/batches/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, preview: true }) })).json();
  if (!p.would_delete) return rdAlert("Nothing to purge", m === "nuke" ? "There are no batches to delete." : "No batch matches that rule — or the ones that do all hold ideas you marked Used or Saved, which are never deleted.");
  const names = (p.batches || []).slice(0, 8).map((b) => `· ${b.name} (${b.ideas} ideas)`).join("\n");
  rdConfirm(`Delete ${p.would_delete} batch${p.would_delete === 1 ? "" : "es"}?`,
    `${names}${p.batches.length > 8 ? `\n· …and ${p.batches.length - 8} more` : ""}\n\n${p.remaining} batch${p.remaining === 1 ? "" : "es"} will remain. ${m === "nuke" ? "NOTHING is protected — this includes every idea you marked Used or Saved, and every sweep in the Library." : "Sweeps holding a Used or Saved idea are protected and not in this list."} This cannot be undone.`,
    async () => {
      if (m === "nuke") {
        const typed = await new Promise((ok) => rdPrompt("Type DELETE to confirm", `This erases all ${p.would_delete} sweeps and every idea in them, including accepted work. There is no undo.`, "", ok));
        if (String(typed || "").trim().toUpperCase() !== "DELETE") return rdAlert("Cancelled", "Nothing was deleted.");
      }
      const r = await (await fetch("/api/wh/batches/purge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, preview: false }) })).json();
      rdAlert("Purged", `${r.deleted} batch${r.deleted === 1 ? "" : "es"} deleted · ${r.remaining} remaining.${r.forgot ? ` Also cleared ${r.forgot} remembered item${r.forgot === 1 ? "" : "s"}, so the next sweep starts genuinely fresh — nothing will be marked as a repeat.` : ""}`);
      if (BATCH && (r.batches || []).some((b) => b.id === BATCH.id)) { BATCH = null; RECAP = null; renderIdeas(null); }
      BATCHES_CACHE = []; renderBatches(); renderBatchPick();
    });
};
// a confirm dialog that states the consequence before it happens
function rdConfirm(title, msg, onYes) {
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="box" style="width:min(520px,100%)"><h3>${esc(title)}</h3>
    <p style="white-space:pre-wrap;font-size:12.5px;line-height:1.6;color:var(--dim)">${esc(msg)}</p>
    <div class="row" style="justify-content:flex-end;margin-top:14px;gap:8px">
      <button class="btn" data-x>Cancel</button>
      <button class="btn" data-ok style="border-color:var(--red);color:var(--red)">Delete</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector("[data-ok]").onclick = () => { close(); onYes(); };
}
// ---- Batches view ----------------------------------------------------------
async function renderBatches() {
  const { batches } = await (await fetch("/api/wh/batches")).json();
  $("#view-batches").innerHTML = `<p class="intro"><b>BATCHES</b> — every sweep you've run, newest first. Open one to revisit its ranked ideas.</p>
    <div class="lib-filters" style="margin-bottom:14px">
      <label class="lf"><span class="lf-k">Tidy up</span>
        <select id="purgeMode">
          <option value="30">older than 30 days</option>
          <option value="14">older than 14 days</option>
          <option value="7">older than 7 days</option>
          <option value="keep20">keep only the newest 20</option>
          <option value="keep10">keep only the newest 10</option>
          <option value="all">every batch (keeps accepted work)</option>
          <option value="nuke">EVERYTHING — including accepted work</option>
        </select></label>
      <button class="btn small" onclick="purgeBatches()">Purge old batches…</button>
      <span class="lf-n">${batches.length} batch${batches.length === 1 ? "" : "es"} · sweeps holding a <b>Used</b> or <b>Saved</b> idea are never deleted</span>
    </div>` +
    (batches.length ? batches.map((b) => `<div class="batch-row" onclick="openBatch(${b.id},'${esc(b.name).replace(/'/g, "\\'")}')">
      <span class="bn">${esc(b.name)}${b.description ? `<span class="bd">${esc(b.description)}</span>` : ""}</span>
      <span class="bm">${esc(b.source)}</span>
      <span class="bm">${b.story_count || 0} ideas</span>
      <span class="chip ${b.status === "swept" ? "tag-grn" : ""}" style="cursor:default">${esc(b.status)}</span>
      <span class="bm">${fmtDT(b.created_at)}</span>
    </div>`).join("") : `<div class="empty">// no batches yet — run a sweep //</div>`);
}
window.openBatch = async (id, name) => { BATCH = { id, name }; FR = "all"; setView("sweep"); await loadIdeas(); toIdeas(); renderBatchPick(); };

// batches dropdown on the sweep page — jump straight to any saved batch's ideas
// Batch picker — the option text now carries the AUTO-WRITTEN description, so
// you can tell "Batch 01-08 17:44" from "Batch 01-08 19:26" without opening both.
let BATCHES_CACHE = [];
function batchOptions(selectedId) {
  return `<option value="">— pick a batch —</option>` + (BATCHES_CACHE || []).map((b) =>
    `<option value="${b.id}" data-n="${esc(b.name)}" ${selectedId === b.id ? "selected" : ""}>${esc(b.name)} · ${b.story_count || 0} ideas${b.description ? ` — ${esc(String(b.description).slice(0, 70))}` : ""}</option>`).join("");
}
async function loadBatches(force) {
  if (force || !BATCHES_CACHE.length) { try { BATCHES_CACHE = (await (await fetch("/api/wh/batches")).json()).batches || []; } catch { BATCHES_CACHE = []; } }
  return BATCHES_CACHE;
}
async function renderBatchPick() {
  const host = $("#batchpick"); if (!host) return;
  await loadBatches(true);
  host.innerHTML = `
    <button class="sweep-btn newsweep-btn" onclick="startNewSweep()">◎ New sweep</button>
    <label class="bp"><span class="bp-k">or reopen a batch</span>
      <select onchange="if(this.value)openBatch(+this.value, this.selectedOptions[0].dataset.n)">${batchOptions(BATCH?.id)}</select>
    </label>`;
}
// clears the current batch and drops you back on the Hunger screen, armed
window.startNewSweep = () => {
  BATCH = null; TOPICS = []; ROUTES = { trend: false, seo: false, talentmind: false }; TM = null;
  SWEEP_PROMPT = ""; RECAP = null; STAGE = 1;
  setView("sweep"); $("#track").classList.remove("at-ideas");
  renderHunger(); renderIdeas(null); renderBatchPick(); rail();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ---- Library view ----------------------------------------------------------
// Library reuses the EXACT Ideas story-board styling — one rich board per story
// (deliverable box · why-chips · pipeline trace · sources), plus its batch tag.
function libraryBoard(s, i, franchises) {
  _STORIES[s.id] = s;
  const fb = s.feedback;
  return `<article class="board ${fb || ""}" id="board-lib-${s.id}">
    <div class="board-top">
      <span class="board-rank">#${i + 1}<span class="pct">${(Number(s.score) * 100).toFixed(0)}</span></span>
      <span class="exp" title="Explainable AI — the maths behind this idea" onclick="explainIdea(${s.id})">e</span>
      ${s.gap_type ? `<span class="chip tag-cyan" style="cursor:default">${esc(s.gap_type)}</span>` : ""}
      ${s.contradiction ? `<span class="chip flag" style="cursor:default">${ic("bolt")} contradiction</span>` : ""}
      ${fb ? `<span class="chip ${fb === "used" ? "tag-grn" : fb === "saved" ? "tag-amber" : "tag-mag"}" style="cursor:default">${esc(fb)}</span>` : `<span class="chip" style="cursor:default;border-style:dashed;color:var(--dim2)">not judged yet</span>`}
      ${s.reject_reason ? `<span class="chip tag-mag" style="cursor:default" title="the reason given when this was rejected">${esc(s.reject_reason)}</span>` : ""}
      ${s.selected ? `<span class="chip tag-grn" style="cursor:default" title="ticked to build">▸ to build</span>` : ""}
      ${s.batch_name ? `<span class="chip" style="cursor:default;margin-left:auto">${ic("box")} ${esc(s.batch_name)}</span>` : ""}
    </div>
    <h3 class="board-q">${esc(s.demand_topic)}</h3>
    <p class="board-sum"><span class="lede">Summary</span>${esc(s.summary || "")}</p>
    <div class="lead-label">${esc(s.angle || "core")} angle</div>
    ${leadIdea(s, franchises)}
  </article>`;
}
// ---- LIBRARY — where every decision has to end up being findable ----------
// Marking an idea Used / Saved / Rejected is only worth doing if you can get
// back to it. These filters are that downstream: by outcome (including the ones
// nobody has judged yet), by WHY it was rejected, by where it has reached in
// the journey, and by which sweep it came from.
let LIB_FR = "all", LIB_FB = "all", LIB_ST = "all", LIB_RS = "all", LIB_BA = "all", LIB_BATCHES = [];
const REJECT_REASONS = ["off-brand", "not interesting", "already covered", "wrong timing"];
const JSTAGE_LABEL = { radar: "01 Radar", shortlist: "02 Shortlist", dump: "03 Dump", brief: "04 Brief", assign: "05 Assign", live: "06 Live" };
async function loadLibrary() {
  const qs = new URLSearchParams();
  if (LIB_FR !== "all") qs.set("franchise", LIB_FR);
  if (LIB_FB !== "all") qs.set("feedback", LIB_FB);
  if (LIB_ST !== "all") qs.set("stage", LIB_ST);
  if (LIB_RS !== "all") qs.set("reason", LIB_RS);
  if (LIB_BA !== "all") qs.set("batch", LIB_BA);
  const { stories } = await (await fetch(`/api/wh/library?${qs}`)).json();
  if (!LIB_BATCHES.length) { try { LIB_BATCHES = (await (await fetch("/api/wh/batches")).json()).batches || []; } catch { LIB_BATCHES = []; } }
  const sel = (label, cur, opts, fn, title) => `<label class="lf" title="${esc(title || "")}"><span class="lf-k">${label}</span>
    <select onchange="${fn}(this.value)">${opts.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const filters = `<div class="lib-filters">
      ${sel("Outcome", LIB_FB, [["all", "all"], ["used", "used"], ["saved", "saved"], ["rejected", "rejected"], ["unmarked", "not judged yet"]], "setLibFB", "What you marked it in the action bar")}
      ${LIB_FB === "rejected" ? sel("Why rejected", LIB_RS, [["all", "any reason"], ...REJECT_REASONS.map((r) => [r, r])], "setLibRS", "The reason given when it was rejected") : ""}
      ${sel("Series", LIB_FR, [["all", "all"], ...FRANCHISES.map((f) => [f.name, f.name])], "setLibFR", "Which 1Up sub-series it routes to")}
      ${sel("Sweep", LIB_BA, [["all", "all"], ...LIB_BATCHES.map((b) => [String(b.id), b.name])], "setLibBA", "Which sweep produced it")}
      <span class="lf-n">${stories.length} idea${stories.length === 1 ? "" : "s"}</span>
      ${[LIB_FB, LIB_ST, LIB_FR, LIB_BA, LIB_RS].some((x) => x !== "all") ? `<button class="btn small" onclick="clearLibFilters()">Clear filters</button>` : ""}
    </div>`;
  $("#view-library").innerHTML = `<p class="intro"><b>LIBRARY</b> — every idea ever generated, across every sweep. Nothing you mark is lost: filter by what you decided, why you rejected it, or how far it got. Click a story to expand the reasoning.</p>` +
    filters + (stories.length ? `<div class="boards">${stories.map((s, i) => libraryBoard(s, i, FRANCHISES)).join("")}</div>` : `<div class="empty">// nothing matches these filters //</div>`);
}
window.setLibFR = (v) => { LIB_FR = v; loadLibrary(); };
window.setLibFB = (v) => { LIB_FB = v; if (v !== "rejected") LIB_RS = "all"; loadLibrary(); };
window.setLibST = (v) => { LIB_ST = v; loadLibrary(); };
window.setLibRS = (v) => { LIB_RS = v; loadLibrary(); };
window.setLibBA = (v) => { LIB_BA = v; loadLibrary(); };
window.clearLibFilters = () => { LIB_FR = LIB_FB = LIB_ST = LIB_RS = LIB_BA = "all"; loadLibrary(); };

// ==========================================================================
// JOURNEY — the gated, high-involvement lane. Runs ALONGSIDE the express
// sweep (New Sweep is untouched); same batch, same stories, six owned
// stations with a human gate between each.
//
//   01 Radar → 02 Shortlist → 03 Dump → 04 Brief → 05 Assign → 06 Live
//
// Explainable-AI principle, applied per station: every one carries WHY it
// exists, WHAT it does, what the MACHINE decides vs what YOU decide, and the
// GATE you have to close. Copy is served from the server handbook
// (/journey/stations) so screen and docs can't drift apart.
// ==========================================================================
let JSTATIONS = [], JOPEN = "shortlist", JSEL = new Set(), JCHIPS = {};
// preset chips come from wh_journey_chip, NOT from a hard-coded array — so the
// team can add a verdict, a season or a dump kind in the DB without a deploy.
const chipsOf = (kind, fallback = []) => (JCHIPS[kind] || []).length ? JCHIPS[kind].map((c) => c.value) : fallback;
async function loadJChips() {
  try {
    const { chips } = await (await fetch("/api/wh/journey/chips")).json();
    JCHIPS = (chips || []).reduce((a, c) => ((a[c.kind] = a[c.kind] || []).push(c), a), {});
  } catch { JCHIPS = {}; }
}

async function renderJourney() {
  const host = $("#view-journey");
  await loadBatches(!BATCH);
  // The journey starts HERE too — you shouldn't have to go back to New Sweep to
  // begin one. Same three feeds, plus a batch picker to reopen an old sweep.
  const opener = `<div class="jopen">
    <div class="jopen-r">
      <button class="sweep-btn" onclick="startNewSweep()">◎ Start a new sweep</button>
      <label class="bp"><span class="bp-k">or run the journey on an existing batch</span>
        <select onchange="if(this.value)openBatchInJourney(+this.value, this.selectedOptions[0].dataset.n)">${batchOptions(BATCH?.id)}</select>
      </label>
    </div>
    <details class="jopen-f"><summary>Arm the feeds — Trend Spotting · SEO Inputs · TalentMind</summary>
      <div class="jopen-fb">The three feeds live on the <b>New Sweep</b> screen, because a journey always starts from a sweep. Press <b>Start a new sweep</b> above to arm them, then come back here.</div>
      <div class="jopen-g">
        <div class="jopen-c"><b>Feed 01 · Trend Spotting</b><span>Pick the themes. Each fires its own search terms at YouTube and Reddit.</span></div>
        <div class="jopen-c"><b>Feed 02 · SEO Inputs</b><span>Paste or upload keyword research to steer the sweep before it runs.</span></div>
        <div class="jopen-c"><b>Feed 03 · TalentMind</b><span>Demand read from the talent themselves. Simulation only for now.</span></div>
      </div>
    </details>
  </div>`;
  if (!BATCH) {
    host.innerHTML = `<p class="intro"><b>JOURNEY</b> — the slower, tracked lane: six owned stations with a human gate between each. Every act is journalled, so you can always see who moved what, and when.</p>`
      + opener + `<div class="empty">// pick a batch above to walk it through the six stations //</div>`;
    return;
  }
  if (!JSTATIONS.length) { try { JSTATIONS = (await (await fetch("/api/wh/journey/stations")).json()).stations || []; } catch { JSTATIONS = []; } }
  if (!Object.keys(JCHIPS).length) await loadJChips();
  try { JOURNEY = await (await fetch(`/api/wh/journey/${BATCH.id}`)).json(); } catch { JOURNEY = null; }
  if (!JOURNEY) { host.innerHTML = `<div class="empty">// could not load the journey //</div>`; return; }

  const { stories = [], candidates = [], dumps = [], counts = {} } = JOURNEY;
  host.innerHTML = `
    <p class="intro"><b>JOURNEY</b> — the same batch as the sweep, walked slowly. Six stations, each owned by a team, each with a gate you close by hand. Open any station to read <b>why it exists</b> and <b>what it does</b>.</p>
    ${opener}
    <div class="jn-head">
      <span class="chip tag-grn" style="cursor:default">${ic("box")} ${esc(BATCH.name || "batch")}</span>
      ${JOURNEY.batch?.description ? `<span class="chip" style="cursor:default;color:var(--dim)">${esc(JOURNEY.batch.description)}</span>` : ""}
      <span class="chip" style="border:none;background:none;padding:0;color:var(--dim2)">${candidates.length} candidates · ${stories.length} in the journey · ${dumps.length} research dump${dumps.length === 1 ? "" : "s"}</span>
    </div>
    ${nextAction({ stories, candidates, dumps, counts })}
    ${JSTATIONS.map((st) => station(st, { stories, candidates, dumps, counts })).join("")}`;
}

// ---- "YOU ARE HERE" — one sentence, one button, no decisions to make ------
// Written for someone who has never used the tool and does not care how it
// works. It looks at the board, finds the single next thing that needs doing,
// says it in plain words, and puts the button right there.
function nextAction(d) {
  const at = (id) => d.stories.filter((s) => s.stage === id);
  const unsure = d.dumps.filter((x) => x.status === "confirm").length;
  const readyToBrief = at("dump").filter((s) => s.dumps > 0);
  let step;
  if (!d.candidates.length && !d.stories.length)
    step = { n: "Start here", say: "Nothing's in this journey yet. Run a sweep first, then come back — the topics it finds will be waiting at station 01.", btn: ["Go to New Sweep", "setView('sweep')"] };
  else if (d.candidates.length && !at("shortlist").length && !at("dump").length)
    step = { n: "Step 1 of 6", say: `The radar found ${d.candidates.length} possible topic${d.candidates.length === 1 ? "" : "s"}. Pull the good ones through so you can go through them properly. Nothing gets committed by doing this.`, btn: ["Promote the top candidates", "jPromote()"] };
  else if (at("shortlist").length)
    step = { n: "Step 2 of 6", say: `${at("shortlist").length} topic${at("shortlist").length === 1 ? " is" : "s are"} waiting for your yes or no. Go down the list and press Keep, Refresh, Merge, Park or Kill on each one. Only Keep and Refresh carry on.`, btn: ["Take me to the list", "jGo('shortlist')"] };
  else if (unsure)
    step = { n: "Step 3 of 6", say: `${unsure} research file${unsure === 1 ? "" : "s"} came in but RayDar wasn't sure which topic ${unsure === 1 ? "it belongs" : "they belong"} to. Pick the right one from the dropdown — that's all it needs.`, btn: ["Show me", "jGo('dump')"] };
  else if (at("dump").length && !readyToBrief.length)
    step = { n: "Step 3 of 6", say: `${at("dump").length} topic${at("dump").length === 1 ? "" : "s"} need SEO's research. Paste an export or drop the file in — Ahrefs, Semrush, Search Console, anything. It doesn't need tidying up first.`, btn: ["Drop research in", "jGo('dump')"] };
  else if (readyToBrief.length)
    step = { n: "Step 4 of 6", say: `${readyToBrief.length} topic${readyToBrief.length === 1 ? " has" : "s have"} research attached. Build the brief and RayDar turns it into keywords, questions and a meta description a writer can just pick up.`, btn: ["Build the brief", "jGo('dump')"] };
  else if (at("brief").length)
    step = { n: "Step 4 of 6", say: `${at("brief").length} brief${at("brief").length === 1 ? " is" : "s are"} ready to read. Have a look, change anything you don't like, then approve it to hand it to Content.`, btn: ["Read the brief", "jGo('brief')"] };
  else if (at("assign").length)
    step = { n: "Step 5 of 6", say: `${at("assign").length} approved brief${at("assign").length === 1 ? "" : "s"} with nobody's name on ${at("assign").length === 1 ? "it" : "them"} yet. Put a writer and a date against ${at("assign").length === 1 ? "it" : "each"}.`, btn: ["Assign a writer", "jGo('assign')"] };
  else if (at("live").length)
    step = { n: "Done", say: `${at("live").length} piece${at("live").length === 1 ? "" : "s"} published from this batch. Add the clicks from Search Console when you have them and next month's sweep gets smarter.`, btn: ["See what's live", "jGo('live')"] };
  else
    step = { n: "All clear", say: "Nothing needs you right now on this batch.", btn: null };
  return `<div class="jnext">
    <div class="jnext-n">${esc(step.n)}</div>
    <div class="jnext-s">${esc(step.say)}</div>
    ${step.btn ? `<button class="jv keep jnext-b" onclick="${step.btn[1]}">${esc(step.btn[0])} →</button>` : ""}
  </div>`;
}
// open a batch straight into the journey, without bouncing via the sweep tab
window.openBatchInJourney = async (id, name) => {
  BATCH = { id, name }; RECAP = null; JOPEN = "shortlist"; JSEL.clear();
  await renderJourney(); renderBatchPick();
  window.scrollTo({ top: 0, behavior: "smooth" });
};
window.jGo = (id) => {
  JOPEN = id; renderJourney();
  setTimeout(() => document.querySelector(`.jny[data-st="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
};

// one station: the explainable panel + whatever that station lets you DO
function station(st, data) {
  const n = st.id === "radar" ? data.candidates.length : (data.counts[st.id] || 0);
  const body = {
    radar: () => stRadar(data), shortlist: () => stShortlist(data), dump: () => stDump(data),
    brief: () => stBrief(data), assign: () => stAssign(data), live: () => stLive(data),
  }[st.id]?.() || "";
  return `<details class="jny ${JOPEN === st.id ? "on" : ""}" data-st="${st.id}" ${JOPEN === st.id ? "open" : ""} ontoggle="jToggle('${st.id}',this.open)">
    <summary class="jny-top">
      <span class="jny-n">${st.n}</span>
      <span><span class="jny-t">${esc(st.title)}</span> <span class="jny-s">— ${esc(st.short)}</span></span>
      <span class="jny-owner">${esc(st.owner)}</span>
      <span class="jny-count"><b>${n}</b> ${st.id === "radar" ? "candidates" : "topics"}<span class="tsr-chev">▾</span></span>
    </summary>
    <div class="jny-body">
      ${body}
      ${(st.steps || []).length ? `<details class="jhow-w"><summary>How do I use this step?</summary>
        <div class="jhow">
          <ol class="jhow-l">${(st.steps || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
          ${st.you_get ? `<div class="jhow-g"><b>You'll end up with:</b> ${esc(st.you_get)}</div>` : ""}
          ${st.then ? `<div class="jhow-t">${esc(st.then)}</div>` : ""}
        </div></details>` : ""}
      <details class="jwhy-w"><summary>Why does this step exist? What is the AI doing?</summary>
      <div class="jwhy">
        <div class="jwhy-r"><div class="jwhy-k">Why</div><div>${esc(st.why)}</div></div>
        <div class="jwhy-r"><div class="jwhy-k">What</div><div>${esc(st.does)}</div></div>
        <div class="jwhy-r"><div class="jwhy-k">The AI</div><div>${esc(st.ai)}</div></div>
        <div class="jwhy-r gate"><div class="jwhy-k">You</div><div>${esc(st.human)}</div></div>
        ${(st.pipelines || []).length ? `<div class="jwhy-p">runs through${(st.pipelines || []).map((p) => `<span class="pp">${esc(p)}</span>`).join("")}· gated + model-swappable in Admin</div>` : `<div class="jwhy-p">no model call at this station</div>`}
      </div></details>
    </div></details>`;
}
window.jToggle = (id, open) => { if (open) JOPEN = id; };

// ---- 01 Radar — the candidates the sweep produced, not yet enrolled -------
function stRadar(d) {
  if (!d.candidates.length) return `<div class="empty">// no un-enrolled candidates — run a sweep, or they're all in the journey already //</div>`;
  return `<div class="jrow-a" style="margin-bottom:4px">
      <button class="jv keep" onclick="jPromote()">▸ Auto-promote the top candidates</button>
      <button class="jv" onclick="jPromoteSel()">Promote ticked (${JSEL.size})</button>
    </div>
    <div class="tsr-note" style="margin-bottom:6px">Auto-promote uses the score floor + top-N set in Settings → journey. Nothing is written until you press it.</div>
    ${d.candidates.map((c) => `<div class="jrow">
      <input type="checkbox" ${JSEL.has(c.id) ? "checked" : ""} onchange="jSel(${c.id},this.checked)">
      <div class="jrow-h">${esc(c.heading || "untitled")}
        <div class="jrow-m">${c.demand_topic ? `<span>${esc(c.demand_topic)}</span>` : ""}${c.franchise ? `<span>→ ${esc(c.franchise)}</span>` : ""}${c.gap_type ? `<span class="chip tag-cyan" style="cursor:default">${esc(c.gap_type)}</span>` : ""}<span>score ${(Number(c.score) || 0).toFixed(2)}</span></div>
      </div></div>`).join("")}`;
}

// ---- 02 Shortlist — verdicts, bulk actions, add-your-own ------------------
function stShortlist(d) {
  const rows = d.stories.filter((s) => s.stage === "shortlist");
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const V = chipsOf("verdict", ["keep", "refresh", "merge", "park", "kill"]).map((v) => [v, cap(v)]);
  return `<div class="jrow-a" style="margin-bottom:8px">
      ${V.map(([v, l]) => `<button class="jv ${v}" onclick="jVerdictSel('${v}')">${l} ticked (${JSEL.size})</button>`).join("")}
      <button class="jv" onclick="jAddTopic()">+ Add a topic the radar missed</button>
    </div>
    ${rows.length ? rows.map((s) => `<div class="jrow">
      <input type="checkbox" ${JSEL.has(s.id) ? "checked" : ""} onchange="jSel(${s.id},this.checked)">
      <div class="jrow-h">${esc(s.heading || "untitled")}
        <div class="jrow-m">${s.demand_topic ? `<span>${esc(s.demand_topic)}</span>` : ""}${s.franchise ? `<span>→ ${esc(s.franchise)}</span>` : ""}<span>score ${(Number(s.score) || 0).toFixed(2)}</span>${s.events ? `<a href="#" onclick="jTimeline(${s.id});return false">${s.events} event${s.events === 1 ? "" : "s"}</a>` : ""}</div>
      </div>
      <div class="jrow-a">${V.map(([v, l]) => `<button class="jv ${v}" onclick="jVerdict(${s.id},'${v}')">${l}</button>`).join("")}</div>
    </div>`).join("") : `<div class="empty">// nothing shortlisted — promote candidates from Radar //</div>`}`;
}

// ---- 03 Dump — SEO drops research; RayDar reads it, never researches ------
function stDump(d) {
  const rows = d.stories.filter((s) => s.stage === "dump");
  const KINDS = chipsOf("dumpkind", ["Keyword export", "GSC export", "SERP snapshot", "Competitor audit", "PAA / questions", "Trend report"]);
  return `<div class="jdz">
      <textarea id="jDumpText" rows="3" placeholder="paste an export — keywords, GSC rows, a SERP snapshot, a PAA list…"></textarea>
      <div class="jrow-a" style="justify-content:center">
        <select class="jn-sel" id="jDumpKind">${KINDS.map((k) => `<option>${esc(k)}</option>`).join("")}</select>
        <button class="jv keep" onclick="jDump()">Read this dump</button>
        <label class="jv" style="cursor:pointer">⤒ Excel · CSV · PDF · DOCX<input type="file" accept=".xlsx,.xls,.csv,.ods,.pdf,.docx" style="display:none" onchange="jDumpFile(this.files[0])"></label>
      </div>
      <div class="tsr-note" style="margin-top:8px">A format RayDar recognises is parsed by rules — instant, no model call, no cost. A new format costs one call, then it's free forever.</div>
      <div id="jDumpMeter"></div>
    </div>
    ${d.dumps.length ? `<div style="margin-top:6px">${d.dumps.map((x) => `<div class="jdump">
        <span class="st ${esc(x.status)}">${esc(x.status)}</span>
        <b>${esc(x.filename || x.kind || "paste")}</b>
        <span class="det">${x.rows} row${x.rows === 1 ? "" : "s"}${x.shape_id ? ` · shape ${esc(x.shape_id)}` : " · shape learned"}${x.confidence != null ? ` · match ${(Number(x.confidence) * 100).toFixed(0)}%` : ""}</span>
        ${x.status === "confirm" ? `<select class="jn-sel" onchange="jAttach(${x.id},this.value)">
            <option value="">— attach to a topic —</option>
            ${rows.map((s) => `<option value="${s.id}">${esc((s.heading || "").slice(0, 60))}</option>`).join("")}
          </select>` : `<span class="det">→ ${esc((rows.find((s) => s.id === x.story_id)?.heading || "attached").slice(0, 50))}</span>`}
      </div>`).join("")}</div>` : ""}
    <div style="margin-top:10px">${rows.length ? `<div class="tsr-note" style="margin-bottom:4px">Topics waiting on research — each one gets a <b>Build the brief →</b> button once you've dropped something in.</div>` : ""}${rows.length ? rows.map((s) => `<div class="jrow">
      <div class="jrow-h">${esc(s.heading || "untitled")}
        <div class="jrow-m"><span>${s.dumps || 0} dump${s.dumps === 1 ? "" : "s"} attached</span>${s.verdict ? `<span class="chip tag-cyan" style="cursor:default">${esc(s.verdict)}</span>` : ""}<a href="#" onclick="jTimeline(${s.id});return false">timeline</a></div>
      </div>
      <div class="jrow-a"><button class="jv ${s.dumps ? "keep" : ""}" onclick="jBrief(${s.id})" ${s.dumps ? "" : 'title="drop some research in above first — the brief is built from it"'}>Build the brief →</button></div>
    </div>`).join("") : `<div class="empty">// nothing waiting on research — keep something at Shortlist first //</div>`}</div>`;
}

// ---- 04 Brief — the artifact Content is waiting for -----------------------
function stBrief(d) {
  const rows = d.stories.filter((s) => s.stage === "brief");
  if (!rows.length) return `<div class="empty">// no briefs yet — build one from a topic at Dump //</div>`;
  // every field is an INPUT — the brief is genuinely editable before approval,
  // and Save writes it back through /journey/story/:id/brief/save.
  const L = (id, path, k, v, arr) => `<div class="jbrief-r"><div class="jbrief-k">${k}</div>
    <div><input id="bf-${id}-${path}" data-arr="${arr ? 1 : 0}" value="${esc(Array.isArray(v) ? v.join(" · ") : (v ?? ""))}" placeholder="${arr ? "separate with ·" : "—"}"></div></div>`;
  return rows.map((s) => {
    const b = s.brief || {};
    return `<div class="jrow" style="align-items:flex-start"><div class="jrow-h" style="min-width:100%">
      ${esc(s.heading || "untitled")}
      <div class="jrow-m"><span>built from ${b._rows || 0} dumped rows</span>${b._sources?.length ? `<span>${esc(b._sources.join(", "))}</span>` : ""}${b._built ? `<span class="chip tag-amber" style="cursor:default">${esc(b._built)}</span>` : ""}<a href="#" onclick="jTimeline(${s.id});return false">timeline</a></div>
      <div class="jbrief">
        ${L(s.id, "primary_keyword", "Primary keyword", b.primary_keyword)}
        ${L(s.id, "secondary_keywords", "Secondary", b.secondary_keywords, 1)}
        ${L(s.id, "search_intent", "Search intent", b.search_intent)}
        ${L(s.id, "faqs", "FAQs", b.faqs, 1)}
        ${L(s.id, "paa", "People also ask", b.paa, 1)}
        ${L(s.id, "ai_overview", "AI Overview", b.ai_overview)}
        ${L(s.id, "related_searches", "Related searches", b.related_searches, 1)}
        ${L(s.id, "competitor_gaps", "Competitor gaps", b.competitor_gaps, 1)}
        ${L(s.id, "must_cover", "Must cover", b.must_cover, 1)}
        ${L(s.id, "metadata.title", "Meta title", b.metadata?.title)}
        ${L(s.id, "metadata.description", "Meta description", b.metadata?.description)}
        ${L(s.id, "metadata.slug", "Slug", b.metadata?.slug)}
        ${L(s.id, "internal_links", "Internal links", b.internal_links, 1)}
      </div>
      <div class="jrow-a" style="margin-top:9px">
        <button class="jv" onclick="jBriefSave(${s.id})">Save my edits</button>
        <button class="jv keep" onclick="jApprove(${s.id})">✓ Approve — release to Content</button>
        <button class="jv" onclick="jBrief(${s.id})">↻ Rebuild from the dump</button>
        <span id="bmsg-${s.id}" class="tcard-msg"></span>
      </div></div></div>`;
  }).join("");
}

// ---- 05 Assign — the only station with a clock ---------------------------
function stAssign(d) {
  const rows = d.stories.filter((s) => s.stage === "assign");
  if (!rows.length) return `<div class="empty">// nothing approved yet — approve a brief at station 04 //</div>`;
  return rows.map((s) => `<div class="jrow">
    <div class="jrow-h">${esc(s.heading || "untitled")}
      <div class="jrow-m">${s.assignee ? `<span class="chip tag-grn" style="cursor:default">${esc(s.assignee)}</span>` : `<span>unassigned</span>`}${s.due_at ? `<span>due ${fmtDT(s.due_at).split(" ·")[0]}</span>` : ""}${s.brief_at ? `<span>approved ${fmtDT(s.brief_at)}</span>` : ""}<a href="#" onclick="jTimeline(${s.id});return false">timeline</a></div>
    </div>
    <div class="jrow-a">
      <button class="jv" onclick="jAssign(${s.id})">${s.assignee ? "Reassign" : "Assign a writer"}</button>
      <button class="jv keep" onclick="jPublish(${s.id})">It's live →</button>
    </div></div>`).join("");
}

// ---- 06 Live — the loop that makes the ranking actually learn -------------
function stLive(d) {
  const rows = d.stories.filter((s) => s.stage === "live");
  if (!rows.length) return `<div class="empty">// nothing published from this batch yet //</div>`;
  return rows.map((s) => `<div class="jrow">
    <div class="jrow-h">${esc(s.heading || "untitled")}
      <div class="jrow-m">${s.published_url ? `<a href="${esc(s.published_url)}" target="_blank" rel="noopener">${esc(String(s.published_url).slice(0, 60))}</a>` : ""}<a href="#" onclick="jTimeline(${s.id});return false">timeline</a></div>
    </div></div>`).join("");
}

// ---- actions --------------------------------------------------------------
const jPost = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());
// ticking a box PERSISTS (wh_feed_story.selected) — it survives a refresh and
// is visible in the Library as "to build". Not client-only state.
window.jSel = async (id, on) => {
  if (on) JSEL.add(id); else JSEL.delete(id);
  await jPost("/api/wh/journey/select", { ids: [id], on: !!on });
  renderJourney();
};
window.jPromote = async () => { const r = await jPost(`/api/wh/journey/${BATCH.id}/promote`); rdAlert("Promoted", `${r.promoted || 0} candidate${r.promoted === 1 ? "" : "s"} moved into Shortlist. Nothing was written to any of them yet — they're waiting on your verdict.`); JSEL.clear(); JOPEN = "shortlist"; renderJourney(); };
window.jPromoteSel = async () => { if (!JSEL.size) return rdAlert("Nothing ticked", "Tick the candidates you want, then press again."); await jPost(`/api/wh/journey/${BATCH.id}/promote`, { ids: [...JSEL] }); JSEL.clear(); JOPEN = "shortlist"; renderJourney(); };
window.jVerdict = async (id, v) => { await jPost("/api/wh/journey/verdict", { ids: [id], verdict: v }); renderJourney(); };
window.jVerdictSel = async (v) => { if (!JSEL.size) return rdAlert("Nothing ticked", "Tick the topics you want to " + v + ", then press again."); await jPost("/api/wh/journey/verdict", { ids: [...JSEL], verdict: v }); JSEL.clear(); renderJourney(); };
window.jAddTopic = () => rdPrompt("Add a topic", "Something the radar never saw — it enters at Shortlist with your name on it.", "", async (h) => { if (!h) return; await jPost(`/api/wh/journey/${BATCH.id}/topic`, { heading: h }); renderJourney(); });
window.jDump = async () => {
  const content = $("#jDumpText")?.value.trim(); if (!content) return rdAlert("Nothing to read", "Paste an export first, or use the file button.");
  await meter(["Detecting the export shape", "Reading typed rows", "Matching to a shortlisted topic"], "jDumpMeter", "◎ Dump read");
  const r = await jPost(`/api/wh/journey/${BATCH.id}/dump`, { content, kind: $("#jDumpKind")?.value });
  jDumpDone(r);
};
window.jDumpFile = async (file) => {
  if (!file) return;
  await meter(["Extracting the file", "Detecting the export shape", "Reading typed rows", "Matching to a shortlisted topic"], "jDumpMeter", "◎ Dump read");
  const fd = new FormData(); fd.append("file", file); fd.append("kind", $("#jDumpKind")?.value || "");
  try { jDumpDone(await (await fetch(`/api/wh/journey/${BATCH.id}/dump-file`, { method: "POST", body: fd })).json()); }
  catch { rdAlert("Could not read that file", "Try an .xlsx, .csv or .pdf export."); }
};
function jDumpDone(r) {
  if (r.error) return rdAlert("Dump failed", r.error);
  const how = r.mode === "deterministic" ? `Recognised as a known format (${r.shape_id}) — parsed by rules, no model call, no cost.`
    : r.learned ? `New format — read once by the model and saved as "${r.shape_id}". The next file like this is free.`
    : r.mode === "ai" ? "Read by the model."
    : "No model available — kept the phrases so nothing was lost.";
  rdAlert("Dump read", `${(r.rows || []).length} row${(r.rows || []).length === 1 ? "" : "s"} pulled. ${how} ${r.attached ? `Attached to "${r.match?.heading || "a topic"}" (${Math.round((r.match?.confidence || 0) * 100)}% match).` : "Not confident which topic it belongs to — pick one below rather than let it guess."}`);
  if ($("#jDumpText")) $("#jDumpText").value = "";
  renderJourney();
}
window.jAttach = async (id, storyId) => { if (!storyId) return; await jPost(`/api/wh/journey/dump/${id}/attach`, { story_id: Number(storyId) }); renderJourney(); };
window.jBrief = async (id) => {
  const r = await jPost(`/api/wh/journey/story/${id}/brief`);
  if (r.error) return rdAlert("Can't build the brief yet", r.error);
  JOPEN = "brief"; renderJourney();
};
// read every brief field back off the screen and persist it. Approving saves
// first, so you can never approve a version different from the one you're
// looking at.
function briefFromScreen(id) {
  const src = (JOURNEY?.stories || []).find((s) => s.id === id)?.brief || {};
  const out = { ...src, metadata: { ...(src.metadata || {}) } };
  document.querySelectorAll(`[id^="bf-${id}-"]`).forEach((el) => {
    const path = el.id.slice(`bf-${id}-`.length);
    const v = el.dataset.arr === "1"
      ? el.value.split("·").map((x) => x.trim()).filter(Boolean)
      : (el.value.trim() || null);
    if (path.startsWith("metadata.")) out.metadata[path.slice(9)] = v;
    else out[path] = v;
  });
  return out;
}
window.jBriefSave = async (id) => {
  await jPost(`/api/wh/journey/story/${id}/brief/save`, { brief: briefFromScreen(id) });
  const m = $(`#bmsg-${id}`); if (m) m.textContent = "✓ saved";
  await renderJourney();
};
window.jApprove = async (id) => {
  await jPost(`/api/wh/journey/story/${id}/brief/save`, { brief: briefFromScreen(id) });  // never approve stale text
  await jPost(`/api/wh/journey/story/${id}/approve`);
  JOPEN = "assign"; renderJourney();
};
window.jAssign = (id) => rdPrompt("Assign a writer", "Who's writing this?", "", async (who) => {
  if (!who) return;
  rdPrompt("Due date", "YYYY-MM-DD (leave blank for none)", "", async (due) => {
    await jPost(`/api/wh/journey/story/${id}/assign`, { assignee: who, due_at: due || null }); renderJourney();
  });
});
window.jPublish = (id) => rdPrompt("It's live", "Paste the published URL — it goes into the own-content index so future sweeps flag it as already covered.", "", async (url) => {
  if (!url) return; await jPost(`/api/wh/journey/story/${id}/publish`, { url }); JOPEN = "live"; renderJourney();
});
// the audit timeline — reads straight off the append-only event table
window.jTimeline = async (id) => {
  const { events } = await (await fetch(`/api/wh/journey/story/${id}/events`)).json();
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="box" style="width:min(560px,100%)">
    <h3 style="margin:0 0 4px">Timeline</h3>
    <p style="font-size:12px;color:var(--dim);margin:0 0 10px">Every act on this topic, oldest first. Append-only — nothing here can be edited or removed.</p>
    <div class="jtl">${(events || []).length ? events.map((e) => `<div class="jtl-e">
      <b>${esc(e.action)}</b>${e.from_stage || e.to_stage ? ` · ${esc(e.from_stage || "—")} → ${esc(e.to_stage || "—")}` : ""}
      ${e.field ? ` · ${esc(e.field)}${e.before_val ? ` <s>${esc(e.before_val)}</s>` : ""}${e.after_val ? ` → ${esc(e.after_val)}` : ""}` : ""}
      ${e.note ? `<br><span style="color:var(--dim2)">${esc(e.note)}</span>` : ""}
      <br><span class="t">${esc(e.actor)} · ${fmtDT(e.at)}</span></div>`).join("") : `<div class="jtl-e">no events yet</div>`}</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-ok>Close</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-ok]").onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
};

// ---- radar sweep meter ------------------------------------------------------
async function meter(steps, hostId, doneMsg, waitFor) {
  const host = document.getElementById(hostId); if (!host) return;
  host.innerHTML = `<div class="meter"><div class="bar"><div class="fill" id="mf-${hostId}"></div></div><div class="now" id="mn-${hostId}"></div><div id="ml-${hostId}"></div></div>`;
  const fill = $(`#mf-${hostId}`), now = $(`#mn-${hostId}`), list = $(`#ml-${hostId}`);
  for (let i = 0; i < steps.length; i++) {
    now.textContent = "◎ " + steps[i]; fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${hostId}-${i}">· ${esc(steps[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 480));
    const el = $(`#ms-${hostId}-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
  }
  // real AI work — keep the rotating Pot logo running until it resolves
  if (waitFor) {
    fill.style.width = "100%"; fill.classList.add("indet");
    now.innerHTML = `<img class="potspin" src="/brand/assets/logos/pot.png" alt="">Generating ideas…`;
    try { await waitFor; } catch { /* surfaced by caller */ }
    fill.classList.remove("indet");
  }
  if (doneMsg) now.textContent = doneMsg;
}

// ---- own modal helpers (replaces q.js) -------------------------------------
// ---- Explainable AI — the (e) popup: why this idea was suggested -----------
window.explainIdea = (id) => {
  const s = _STORIES[id]; if (!s) return;
  const b = s.score_breakdown || {}, w = b.weights || { gap: .35, velocity: .25, strategic: .20, historical: .20 };
  const pct = (Number(s.score) * 100).toFixed(0);
  const contrib = (label, v, wt) => {
    const val = Number(v) || 0, part = val * (Number(wt) || 0);
    return `<div class="sbar"><span>${label} ×${wt}</span><span class="track2"><span class="fill2" style="width:${Math.round(part / (Number(s.score) || 1) * 100)}%"></span></span><span>${part.toFixed(3)}</span></div>`;
  };
  const cohort = s.why_cohort && String(s.why_cohort).trim()
    ? esc(s.why_cohort)
    : `<span style="color:var(--dim2)">nil · coming soon — run a TalentMind cohort to ground this to real job seekers</span>`;
  const signal = b.live ? `<b style="color:var(--grn)">live feed</b>` : `<b style="color:var(--dim2)">config fallback</b> (add YouTube/Reddit keys for live signal)`;
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="box" style="width:min(520px,100%)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span class="exp" style="cursor:default">e</span><h3 style="margin:0">Why this was suggested</h3></div>
    <p style="font-size:12.5px;color:var(--dim);margin:0 0 10px">"${esc(s.heading)}"</p>
    <div class="g-l">Composite score = ${pct} · gap ${w.gap} + velocity ${w.velocity} + strategic ${w.strategic} + historical ${w.historical}</div>
    ${contrib("gap", b.gap, w.gap)}${contrib("velocity", b.velocity, w.velocity)}${contrib("strategic", b.strategic, w.strategic)}${contrib("historical", b.historical, w.historical)}
    <div class="why" style="margin-top:10px"><b>Signal:</b> ${signal} · demand ${b.demand ?? 0} questions · supply ${b.supply ?? 0} items · gap type <b>${esc(s.gap_type || "—")}</b></div>
    <div class="why"><b>Sources:</b> ${(b.sources && b.sources.length) ? b.sources.map((sc) => `<span class="src">${esc(sc)}</span>`).join("") : `<span class="src src-llm">LLM only — add YouTube / Reddit / Tavily / Serper keys for grounded sources</span>`}</div>
    <div class="why"><b>Why now:</b> ${esc(s.why_now || "—")}</div>
    <div class="why"><b>Why relevant:</b> ${esc(s.why_relevant || "—")}</div>
    <div class="why"><b>Cohort fit:</b> ${cohort}</div>
    ${s.contradiction ? `<div class="why"><b>Contradiction:</b> pushes against ${esc(s.contradiction_of || "popular belief")}</div>` : ""}
    <div class="why" style="color:var(--dim2);font-size:11px;margin-top:8px">Routed to <b>${esc(s.franchise)}</b> · register ${esc(s.emotional_register || "—")} · generated through the gated RayDar pipelines.</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-ok>Close</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-ok]").onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
};

function rdAlert(title, msg) {
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="box"><h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-ok>OK</button></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-ok]").onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
}
function rdPrompt(title, label, value, onOk) {
  const ov = document.createElement("div"); ov.className = "ov";
  ov.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${label ? `<p>${esc(label)}</p>` : ""}<input id="rdp" value="${esc(value || "")}"><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Cancel</button><button class="btn" data-ok style="border-color:var(--grn-dim);color:var(--grn)">OK</button></div></div>`;
  document.body.appendChild(ov);
  const inp = ov.querySelector("#rdp"); inp.focus(); inp.select();
  const close = () => ov.remove();
  ov.querySelector("[data-x]").onclick = close; ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector("[data-ok]").onclick = () => { const v = inp.value; close(); onOk(v); };
  inp.onkeydown = (e) => { if (e.key === "Enter") ov.querySelector("[data-ok]").click(); if (e.key === "Escape") close(); };
}

init();
