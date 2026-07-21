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
  renderSubnav(); rail();
  ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || [];
  FRANCHISES = ((await (await fetch("/api/wh/franchises")).json()).franchises) || [];
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

    <div class="process"><button class="sweep-btn" onclick="onProcess()">◎ Run the sweep</button></div>
    <div id="procMeter"></div>`;
  rail();
}
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
window.onProcess = async () => {
  if (!ROUTES.trend && !ROUTES.seo && !ROUTES.talentmind) { rdAlert("Arm a feed", "Tick Trend Spotting, add SEO inputs, or run the TalentMind simulation first."); return; }
  STAGE = 2; rail();
  const body = TM ? { talentmind_cohort_id: TM.cohortId, name: TM.name } : { trend_topics: ROUTES.trend ? TOPICS : [], seo: ROUTES.seo };
  const b = await (await fetch("/api/wh/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  BATCH = { id: b.id, name: b.name };
  await meter(["Collecting feed · YouTube + Reddit", "Classifying → topic · franchise · registers", "Gap analysis + velocity", "Writing headings + briefs", "Composite ranking"], "procMeter", "◎ Signal locked");
  await fetch(`/api/wh/feedstories/${BATCH.id}`, { method: "POST" });
  await loadIdeas();
  STAGE = 3; toIdeas();
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

// shared expandable story card — click to reveal the "reason why" (used by Ideas + Library)
const _STORIES = {};
function ideaCard(s, i, franchises, opts = {}) {
  _STORIES[s.id] = s;
  const g = s.topic_guide || {}, fb = s.feedback, brd = s.score_breakdown || {};
  const tag = FR_TAG[frIndexIn(franchises, s.franchise) % FR_TAG.length];
  const w = brd.weights || {};
  const bar = (label, v) => `<div class="sbar"><span>${label}</span><span class="track2"><span class="fill2" style="width:${Math.round((Number(v) || 0) * 100)}%"></span></span><span>${(Number(v) || 0).toFixed(2)}</span></div>`;
  return `<article class="card ${fb || ""}" id="card-${s.id}">
    <div class="cardhead" onclick="toggleCard(${s.id})">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span class="rank">#${i + 1}<span class="pct">${(Number(s.score) * 100).toFixed(0)}</span></span>
        <span class="exp" title="Explainable AI — why this was suggested" onclick="event.stopPropagation();explainIdea(${s.id})">e</span>
        ${s.gap_type ? `<span class="chip tag-cyan" style="cursor:default">${esc(s.gap_type)}</span>` : ""}
        ${s.contradiction ? `<span class="chip flag" title="pushes against ${esc(s.contradiction_of || "popular belief")}">${ic("bolt")} contradiction</span>` : ""}
        ${fb ? `<span class="chip ${fb === "used" ? "tag-grn" : fb === "saved" ? "tag-amber" : "tag-mag"}" style="cursor:default">${esc(fb)}</span>` : ""}
        ${opts.showBatch && s.batch_name ? `<span class="chip" style="cursor:default;margin-left:auto">${ic("box")} ${esc(s.batch_name)}</span>` : ""}
      </div>
      <h4>${esc(s.heading)}</h4>
      <div class="chips">
        <span class="chip ${tag}">${ic("target")} ${esc(s.franchise)}</span>
        <span class="chip">${ic("pin")} ${esc(s.demand_topic)}</span>
        ${s.platform ? `<span class="chip">${ic("monitor")} ${esc(s.platform)}</span>` : ""}
        ${s.emotional_register ? `<span class="chip">${esc(s.emotional_register)}</span>` : ""}
      </div>
      <p class="sum">${esc(s.summary)}</p>
      <div class="srcrow">sources: ${(brd.sources && brd.sources.length) ? brd.sources.map((sc) => `<span class="src">${esc(sc)}</span>`).join("") : `<span class="src src-llm">LLM only</span>`}</div>
      <div class="expand">▾ why this ranks — click to expand</div>
    </div>
    <div class="reason">
      <div class="g-l">Topic guide</div>
      <div style="font-size:12.5px;color:var(--dim)">${esc(g.take || "")}</div>
      ${(g.beats || []).length ? `<ul style="margin:6px 0 0;padding-left:16px;font-size:12.5px;color:var(--dim);line-height:1.5">${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      <div class="why"><b>Why now:</b> ${esc(s.why_now || "—")}</div>
      ${s.why_relevant ? `<div class="why"><b>Why relevant:</b> ${esc(s.why_relevant)}</div>` : ""}
      ${s.why_cohort ? `<div class="why"><b>Why this cohort:</b> ${esc(s.why_cohort)}</div>` : ""}
      <div class="why"><b>Evidence:</b> ${esc(s.evidence || "—")}</div>
      ${s.contradiction ? `<div class="why"><b>Contradicts:</b> ${esc(s.contradiction_of || "popular belief")}</div>` : ""}
      <div class="g-l" style="margin-top:12px">Score breakdown${w.gap ? ` · weights ${w.gap}·${w.velocity}·${w.strategic}·${w.historical}` : ""}</div>
      ${bar("gap", brd.gap)}${bar("velocity", brd.velocity)}${bar("strategic", brd.strategic)}${bar("historical", brd.historical)}
      ${brd.live !== undefined ? `<div class="why" style="font-family:var(--mono);font-size:10.5px">signal: ${brd.live ? "live feed" : "config fallback"} · demand ${brd.demand ?? 0} Qs · supply ${brd.supply ?? 0} items</div>` : ""}
      ${s.source_refs?.length ? `<div class="g-l" style="margin-top:12px">Sources</div><div class="chips">${s.source_refs.slice(0, 6).map((r) => `<a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener">${ic("external")} ${esc(r.source || "src")}</a>`).join("")}</div>` : ""}
      <div class="acts">
        <button class="btn small" onclick="idea(${s.id},'used')">${ic("check")} Used</button>
        <button class="btn small" onclick="idea(${s.id},'saved')">${ic("save")} Save</button>
        <button class="btn small" onclick="rejectIdea(${s.id})">${ic("x")} Reject</button>
        <button class="btn small" onclick="editIdea(${s.id},'${esc(s.heading).replace(/'/g, "\\'")}')">${ic("edit")} Edit</button>
        <label class="build"><input type="checkbox" ${s.selected ? "checked" : ""} onchange="idea(${s.id},'select')"> build</label>
      </div>
      ${s.reject_reason ? `<div style="font-family:var(--mono);font-size:10.5px;color:var(--red);margin-top:8px">rejected: ${esc(s.reject_reason)}</div>` : ""}
    </div>
  </article>`;
}
window.toggleCard = (id) => { document.getElementById(`card-${id}`)?.classList.toggle("open"); };

function renderIdeas(stories, franchises) {
  const host = $("#stageIdeas");
  if (!stories) { host.innerHTML = `<p class="intro"><b>IDEAS</b> appear here once the sweep completes — each a heading + brief routed to a 1Up franchise, ranked by signal strength.</p><div class="empty">// awaiting sweep //</div>`; return; }
  const filter = `<div class="ideas-head">
      <span class="chip tag-grn" style="cursor:default">${ic("box")} ${esc(BATCH?.name || "batch")}</span>
      <span class="chip" style="border:none;background:none;padding:0">franchise</span>
      <select onchange="setFR(this.value)"><option value="all" ${FR === "all" ? "selected" : ""}>all</option>${(franchises || []).map((f) => `<option ${FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="chip" style="border:none;background:none;padding:0;color:var(--dim2)">${stories.length} ideas · ranked</span>
    </div>`;
  host.innerHTML = `<p class="intro"><b>IDEAS</b> — ranked by composite signal. Click a story to expand its reasoning; then mark Used, Save, Reject, Edit, or tick <b>build</b>.</p>` +
    filter + (stories.length ? `<div class="grid">${stories.map((s, i) => ideaCard(s, i, franchises)).join("")}</div>` : `<div class="empty">// no ideas${FR !== "all" ? " for " + esc(FR) : ""} //</div>`);
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
window.openBatch = async (id, name) => { BATCH = { id, name }; FR = "all"; setView("sweep"); await loadIdeas(); toIdeas(); };

// ---- Library view ----------------------------------------------------------
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
    filters + (stories.length ? `<div class="grid">${stories.map((s, i) => ideaCard(s, i, FRANCHISES, { showBatch: true })).join("")}</div>` : `<div class="empty">// nothing here //</div>`);
}
window.setLibFR = (v) => { LIB_FR = v; loadLibrary(); };
window.setLibFB = (v) => { LIB_FB = v; loadLibrary(); };

// ---- radar sweep meter ------------------------------------------------------
async function meter(steps, hostId, doneMsg) {
  const host = document.getElementById(hostId); if (!host) return;
  host.innerHTML = `<div class="meter"><div class="bar"><div class="fill" id="mf-${hostId}"></div></div><div class="now" id="mn-${hostId}"></div><div id="ml-${hostId}"></div></div>`;
  const fill = $(`#mf-${hostId}`), now = $(`#mn-${hostId}`), list = $(`#ml-${hostId}`);
  for (let i = 0; i < steps.length; i++) {
    now.textContent = "◎ " + steps[i]; fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${hostId}-${i}">· ${esc(steps[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 480));
    const el = $(`#ms-${hostId}-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
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
