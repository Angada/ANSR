// RayDar — Talent Trend Radar. Standalone (no app.css / no q.js).
// Journey moves LEFT → RIGHT: [01 Hunger] → 02 Sweep(process) → [03 Ideas].
// Step 1 HUNGER = pick/combine 3 routes (Trend Spotting chips · SEO paste ·
// TalentMind sim) → Process → Step 3 ranked, franchise-routed Ideas.
// Talent = job seeker; TalentMind = parsed profile+chips. AI via gated
// pipelines with mock fallback. All endpoints preserved from the prior build.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

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

// ---- journey rail (horizontal) ---------------------------------------------
const STATIONS = [
  { t: "Hunger", s: "demand in" },
  { t: "Sweep", s: "collect · classify · rank" },
  { t: "Ideas", s: "routed to 1Up" },
];
function rail() {
  $("#rail").innerHTML = STATIONS.map((n, i) => {
    const idx = i + 1;
    const cls = "stn" + (idx === STAGE ? " on" : "") + (idx < STAGE ? " done" : "");
    const goto = idx === 1 ? `onclick="toHunger()"` : idx === 3 && BATCH ? `onclick="toIdeas()"` : "";
    const node = `<div class="${cls}" ${goto}>
      <div class="no">${idx < STAGE ? "✓" : String(idx).padStart(2, "0")}</div>
      <div class="meta"><span class="t">${n.t}</span><span class="s">${n.s}</span></div></div>`;
    const link = i < STATIONS.length - 1 ? `<div class="link ${idx < STAGE ? "lit" : ""}"></div>` : "";
    return node + link;
  }).join("");
}
window.toHunger = () => { STAGE = 1; $("#track").classList.remove("at-ideas"); rail(); };
window.toIdeas = () => { STAGE = 3; $("#track").classList.add("at-ideas"); rail(); };

// ---- sub-nav: New Sweep / Batches / Library --------------------------------
function renderSubnav() {
  $("#subnav").innerHTML = [["sweep", "New Sweep"], ["batches", "Batches"], ["library", "Library"]]
    .map(([k, l]) => `<button class="${VIEW === k ? "on" : ""}" onclick="setView('${k}')">${l}</button>`).join("");
}
window.setView = (v) => {
  VIEW = v; renderSubnav();
  $("#view-sweep").hidden = v !== "sweep";
  $("#view-batches").hidden = v !== "batches";
  $("#view-library").hidden = v !== "library";
  if (v === "batches") renderBatches();
  if (v === "library") loadLibrary();
};

async function init() {
  renderSubnav(); rail(); renderBatchPick();
  ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || [];
  FRANCHISES = ((await (await fetch("/api/wh/franchises")).json()).franchises) || [];
  try { GUARD = (((await (await fetch("/api/wh/rules")).json()).rules || {}).guardrails || {}).collection || {}; } catch { GUARD = {}; }
  renderHunger();
  renderIdeas(null);
}

// ---- STAGE 01 · HUNGER (3 combinable routes) -------------------------------
async function renderHunger() {
  const seo = (await (await fetch("/api/wh/seo")).json()).inputs || [];
  const trendChips = ALL_TOPICS.filter((t) => t.name !== "Emerging").map((t) =>
    `<span class="chip pick ${TOPICS.includes(t.name) ? "on" : ""}" onclick="toggleTopic('${esc(t.name).replace(/'/g, "\\'")}')" title="→ ${esc(t.franchise)}">${TOPICS.includes(t.name) ? "✓ " : ""}${esc(t.name)}</span>`).join("");
  const seoChips = seo.length
    ? seo.map((s) => `<span class="chip">${esc(s.kind)} · ${esc((s.content || "").slice(0, 20))}…<a class="x" onclick="delSeo(${s.id});return false" href="#">✕</a></span>`).join("")
    : `<span class="chip" style="border-style:dashed">no research pasted</span>`;

  $("#stageHunger").innerHTML = `
    <p class="intro"><b>HUNGER</b> — where does demand come from? Arm one or more feeds, then run the sweep. Demand can come from what's <b>trending</b>, from your <b>SEO</b> research, or from the <b>talent</b> themselves.</p>
    <div class="routes">

      <div class="mod ${ROUTES.trend ? "sel" : ""}">
        <span class="idx">Feed 01</span>
        <h3><span class="tick" onclick="route('trend')">✓</span> Trend Spotting
          <a class="ceditlink" onclick="toggleConcepts()">${EDIT_CONCEPTS ? "done" : "⚙ edit concepts"}</a></h3>
        <p class="desc">Pick the demand concepts — the domains job seekers hunger for. Each concept carries the <b>search terms</b> we fire at YouTube/Reddit and routes to a 1Up franchise.</p>
        ${EDIT_CONCEPTS ? conceptEditor() : `<div class="chips">${trendChips}</div>`}
      </div>

      <div class="mod ${ROUTES.seo ? "sel" : ""}">
        <span class="idx">Feed 02</span>
        <h3><span class="tick" onclick="route('seo')">✓</span> SEO Inputs</h3>
        <p class="desc">Paste raw research — keyword lists, GSC queries, competitor gaps, trend exports.</p>
        <textarea id="seoText" rows="3" placeholder="paste raw research…"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn small" onclick="addSeo()">+ Add</button></div>
        <div class="chips" style="margin-top:10px">${seoChips}</div>
      </div>

      <div class="mod soon ${TM ? "sel" : ""}">
        <span class="idx">Feed 03</span>
        <h3>TalentMind ${TM ? `<span class="chip tag-grn" style="cursor:default">sim active</span>` : `<span class="badge-soon">soon · needs T500 + parse AI</span>`}</h3>
        <p class="desc">Demand seeded from the talent themselves — parse each job seeker's corpus into chips, cohort them, read their hunger.</p>
        ${TM ? "" : `<button class="btn small" onclick="talentmindSim()">${ic("play")} Run simulation</button>`}
        <div id="tmSim"></div>
      </div>

    </div>

    <div class="sweepbox">
      <span class="idx">Your brief</span>
      <textarea id="sweepPrompt" rows="2" placeholder="anything more to add in your sweep?" oninput="setSweepPrompt(this.value)">${esc(SWEEP_PROMPT)}</textarea>
    </div>
    <div class="process"><button class="sweep-btn" onclick="onProcess()">◎ Run the sweep</button></div>
    <div id="procMeter"></div>`;
  rail();
}
window.setSweepPrompt = (v) => { SWEEP_PROMPT = v; };
window.route = (k) => { ROUTES[k] = !ROUTES[k]; renderHunger(); };
window.toggleTopic = (name) => { ROUTES.trend = true; TOPICS = TOPICS.includes(name) ? TOPICS.filter((t) => t !== name) : [...TOPICS, name]; renderHunger(); };
window.addSeo = async () => { const content = $("#seoText")?.value.trim(); if (!content) return; ROUTES.seo = true; await fetch("/api/wh/seo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "keywords", content }) }); renderHunger(); };
window.delSeo = async (id) => { await fetch(`/api/wh/seo/${id}/delete`, { method: "POST" }); renderHunger(); };

// ---- Trend Spotting concept editor — edit terms, add/remove concepts, save --
function conceptEditor() {
  const rows = ALL_TOPICS.filter((t) => t.name !== "Emerging").map((t, i) => `
    <div class="cedit">
      <input id="cn-${i}" value="${esc(t.name)}" placeholder="concept" style="font-weight:600">
      <input id="ct-${i}" value="${esc((t.terms || []).join(", "))}" placeholder="search terms → YouTube/Reddit queries (comma-separated)">
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
      <input id="ct-new" placeholder="search terms, comma-separated">
      <input id="cf-new" placeholder="franchise">
      <input id="cw-new" value="1" style="text-align:center">
      <button class="btn small" onclick="addConcept()">Add</button><span></span>
    </div></div>`;
}
window.toggleConcepts = () => { EDIT_CONCEPTS = !EDIT_CONCEPTS; renderHunger(); };
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
      <div class="row"><input id="tmBatch" value="${esc("Batch " + new Date().toLocaleString())}" style="flex:1;min-width:160px"><button class="btn small" onclick="saveTM()">Save</button></div>
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
  const gen = fetch(`/api/wh/feedstories/${BATCH.id}`, { method: "POST" });   // kick off the real AI work
  await meter(steps, "procMeter", "◎ Signal locked", gen);
  await loadIdeas();
  STAGE = 3; toIdeas(); renderBatchPick();
};

// ---- STAGE 03 · Ideas (ranked, franchise-routed, review CRUD) --------------
async function loadIdeas() {
  const { stories } = await (await fetch(`/api/wh/feedstories/${BATCH.id}?franchise=${encodeURIComponent(FR)}`)).json();
  const { franchises } = await (await fetch("/api/wh/franchises")).json();
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
  return `<details class="tsr">
    <summary class="tsr-top"><span class="ic-wrap">${ic("target", 15)}</span><span class="tsr-title">Trend Spotting report</span><span class="tsr-hi">${hi}</span><span class="tsr-chev">▾</span></summary>
    <div class="tsr-grid">${audBlock}${conceptBlock}${regBlock}${signalBlock}${routeBlock}${srcBlock}</div>
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
        <span class="stag">${esc(r.source || "web")}</span>
        <span class="stt">${esc(r.title || r.url)}</span>
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
function leadIdea(s, franchises) {
  const m = angleMeta(s);
  return `<div class="lead">
    <div class="idea-topline">
      <span class="chip ${m.cls}" style="cursor:default">${esc(s.angle || "core")}</span>
      ${ideaChips(s, franchises)}
      <span class="idea-score">score ${(Number(s.score) * 100).toFixed(0)}</span>
    </div>
    ${deliverableBox(s)}
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

function renderIdeas(stories, franchises) {
  const host = $("#stageIdeas");
  if (!stories) { host.innerHTML = `<p class="intro"><b>IDEAS</b> appear here once the sweep completes — each concept becomes a <b>story board</b>: a lead idea plus alternative angles, all ranked by signal strength.</p><div class="empty">// awaiting sweep //</div>`; return; }
  _RENDER = { stories, franchises };
  TOPIC_Q = Object.fromEntries((ALL_TOPICS || []).map((t) => [t.name, t.question]));
  const boards = groupBoards(stories);
  const filter = `<div class="ideas-head">
      <span class="chip tag-grn" style="cursor:default">${ic("box")} ${esc(BATCH?.name || "batch")}</span>
      <span class="chip" style="border:none;background:none;padding:0">franchise</span>
      <select onchange="setFR(this.value)"><option value="all" ${FR === "all" ? "selected" : ""}>all</option>${(franchises || []).map((f) => `<option ${FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="chip" style="border:none;background:none;padding:0;color:var(--dim2)">${boards.length} concept${boards.length === 1 ? "" : "s"} · ${stories.length} angles</span>
    </div>`;
  host.innerHTML = `<p class="intro"><b>IDEAS</b> — grouped into <b>story boards</b> by concept. Each board leads with the strongest angle; open the <b>alternatives</b> or the <b>why</b> chips (concept · angle · story) to see the reasoning and the sources we pulled.</p>` +
    trendReport(stories) + filter + (boards.length ? `<div class="boards">${boards.map((b, i) => storyBoard(b, i, franchises)).join("")}</div>` : `<div class="empty">// no ideas${FR !== "all" ? " for " + esc(FR) : ""} //</div>`);
}
window.setFR = (v) => { FR = v; loadIdeas(); };
function refreshCurrent() { if (VIEW === "library") loadLibrary(); else loadIdeas(); }
window.idea = async (id, action) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); refreshCurrent(); };
window.rejectIdea = (id) => rdPrompt("Reject idea", "Reason — off-brand · not interesting · already covered · wrong timing", "not interesting", async (reason) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rejected", reason }) }); refreshCurrent(); });
window.editIdea = (id, heading) => rdPrompt("Edit heading", "", heading, async (h) => { if (!h) return; await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", heading: h }) }); refreshCurrent(); });

// ---- Batches view ----------------------------------------------------------
async function renderBatches() {
  const { batches } = await (await fetch("/api/wh/batches")).json();
  $("#view-batches").innerHTML = `<p class="intro"><b>BATCHES</b> — every sweep you've run, newest first. Open one to revisit its ranked ideas.</p>` +
    (batches.length ? batches.map((b) => `<div class="batch-row" onclick="openBatch(${b.id},'${esc(b.name).replace(/'/g, "\\'")}')">
      <span class="bn">${esc(b.name)}</span>
      <span class="bm">${esc(b.source)}</span>
      <span class="bm">${b.story_count || 0} ideas</span>
      <span class="chip ${b.status === "swept" ? "tag-grn" : ""}" style="cursor:default">${esc(b.status)}</span>
      <span class="bm">${b.created_at ? new Date(b.created_at).toLocaleString() : ""}</span>
    </div>`).join("") : `<div class="empty">// no batches yet — run a sweep //</div>`);
}
window.openBatch = async (id, name) => { BATCH = { id, name }; FR = "all"; setView("sweep"); await loadIdeas(); toIdeas(); renderBatchPick(); };

// batches dropdown on the sweep page — jump straight to any saved batch's ideas
async function renderBatchPick() {
  const host = $("#batchpick"); if (!host) return;
  const { batches } = await (await fetch("/api/wh/batches")).json();
  host.innerHTML = `batch <select onchange="if(this.value)openBatch(+this.value, this.selectedOptions[0].dataset.n)">
    <option value="">— new sweep —</option>
    ${(batches || []).map((b) => `<option value="${b.id}" data-n="${esc(b.name)}" ${BATCH && BATCH.id === b.id ? "selected" : ""}>${esc(b.name)} · ${b.story_count || 0} ideas · ${esc(b.source || "")}</option>`).join("")}
  </select>`;
}

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
      ${fb ? `<span class="chip ${fb === "used" ? "tag-grn" : fb === "saved" ? "tag-amber" : "tag-mag"}" style="cursor:default">${esc(fb)}</span>` : ""}
      ${s.batch_name ? `<span class="chip" style="cursor:default;margin-left:auto">${ic("box")} ${esc(s.batch_name)}</span>` : ""}
    </div>
    <h3 class="board-q">${esc(s.demand_topic)}</h3>
    <p class="board-sum"><span class="lede">Summary</span>${esc(s.summary || "")}</p>
    <div class="lead-label">${esc(s.angle || "core")} angle</div>
    ${leadIdea(s, franchises)}
  </article>`;
}
let LIB_FR = "all", LIB_FB = "all";
async function loadLibrary() {
  const qs = new URLSearchParams(); if (LIB_FR !== "all") qs.set("franchise", LIB_FR); if (LIB_FB !== "all") qs.set("feedback", LIB_FB);
  const { stories } = await (await fetch(`/api/wh/library?${qs}`)).json();
  const filters = `<div class="lib-filters">
      <span class="chip" style="border:none;background:none;padding:0">franchise</span>
      <select onchange="setLibFR(this.value)"><option value="all">all</option>${FRANCHISES.map((f) => `<option ${LIB_FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="chip" style="border:none;background:none;padding:0">status</span>
      <select onchange="setLibFB(this.value)">${["all", "used", "saved", "rejected"].map((x) => `<option ${LIB_FB === x ? "selected" : ""}>${x}</option>`).join("")}</select>
      <span class="chip" style="border:none;background:none;padding:0;color:var(--dim2)">${stories.length} stories</span>
    </div>`;
  $("#view-library").innerHTML = `<p class="intro"><b>LIBRARY</b> — every idea ever generated, across all batches. Click a story to expand the reasoning.</p>` +
    filters + (stories.length ? `<div class="boards">${stories.map((s, i) => libraryBoard(s, i, FRANCHISES)).join("")}</div>` : `<div class="empty">// nothing here //</div>`);
}
window.setLibFR = (v) => { LIB_FR = v; loadLibrary(); };
window.setLibFB = (v) => { LIB_FB = v; loadLibrary(); };

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
    now.innerHTML = `<img class="potspin" src="/brand/assets/logos/pot.png" alt="">Generating ideas through the LLM — this can take up to a minute…`;
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
