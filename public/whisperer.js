// RayDar (Talent Trend Radar). Journey: Step 1 HUNGER = pick/combine 3 routes
// (Trend Spotting chips · SEO paste · TalentMind simulation) → Process → Step 2
// ranked, franchise-routed Ideas. Labels: Talent = job seeker; TalentMind = the
// parsed profile+chips. AI runs through gated pipelines with a mock fallback.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const STEPS = ["Hunger", "Ideas"];
let ROUTES = { trend: false, seo: false, talentmind: false };
let TOPICS = [];          // selected trend-spotting demand topics
let ALL_TOPICS = [];      // the 6 (+Emerging)
let TM = null;            // TalentMind simulation: { cohortId, hunger }
let BATCH = null, FR = "all";

function step(done, active = -1) {
  $("#stepper").innerHTML = STEPS.map((s, i) => {
    let cls = "node"; if (i < done) cls += " done"; if (i === active) cls += " active";
    return `<div class="${cls}"><div class="dot">${i < done ? "&#10003;" : i + 1}</div><div class="lbl">${s}</div></div>`;
  }).join("");
}
async function init() {
  step(0, 0);
  ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || [];
  renderHunger(); renderIdeas(null);
}

// ---- Step 1 · HUNGER (3 routes, combinable) --------------------------------
async function renderHunger() {
  const seo = (await (await fetch("/api/wh/seo")).json()).inputs || [];
  const trendChips = ALL_TOPICS.filter((t) => t.name !== "Emerging").map((t) =>
    `<span class="ai-chip ${TOPICS.includes(t.name) ? "sel" : ""}" onclick="toggleTopic('${esc(t.name)}')" title="${esc(t.franchise)}">${TOPICS.includes(t.name) ? "✓ " : ""}${esc(t.name)}</span>`).join(" ");
  $("#hunger").innerHTML = `
    <p class="lbl" style="color:var(--ansr-gray)">Tick one or more routes, then Process. Demand can come from what's trending, from SEO research, or from the talent themselves.</p>

    <div class="band" style="border-color:${ROUTES.trend ? "var(--ansr-orange)" : "var(--ansr-border)"}">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" ${ROUTES.trend ? "checked" : ""} onchange="route('trend')" style="width:auto;min-height:auto">
        <b style="color:var(--ansr-navy)">Trend Spotting</b><span class="lbl">— pick demand topics (the 6 domains)</span></label>
      <div class="ai-chips" style="margin-top:8px">${trendChips}</div>
    </div>

    <div class="band" style="border-color:${ROUTES.seo ? "var(--ansr-orange)" : "var(--ansr-border)"}">
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" ${ROUTES.seo ? "checked" : ""} onchange="route('seo')" style="width:auto;min-height:auto">
        <b style="color:var(--ansr-navy)">SEO Inputs</b><span class="lbl">— paste keyword / GSC / competitor / trend research</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
        <div style="flex:1;min-width:240px"><textarea id="seoText" rows="2" placeholder="paste raw research…"></textarea></div>
        <button class="btn" onclick="addSeo()">Add</button>
      </div>
      <div style="margin-top:8px">${seo.map((s) => `<span class="chip">${esc(s.kind)} · ${esc((s.content || "").slice(0, 22))}… <a href="#" onclick="delSeo(${s.id});return false" style="color:#b3261e">✕</a></span>`).join(" ") || `<span class="lbl">nothing pasted yet</span>`}</div>
    </div>

    <div class="band grad-soft" style="opacity:${TM ? "1" : ".85"}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="color:var(--ansr-navy)">TalentMind</b>
        <span class="chip chip--draft">coming soon · needs T500 integration + parsing AI</span>
        ${TM ? `<span class="chip chip--approved">simulation active</span>` : `<button class="btn btn--ghost" onclick="talentmindSim()" style="margin-left:auto">▶ Click for simulation</button>`}
      </div>
      <p class="lbl" style="color:var(--ansr-gray);margin:6px 0 0">Demand seeded from the talent themselves — parse each job seeker's corpus into TalentMind chips, cohort them, and read their hunger.</p>
      <div id="tmSim"></div>
    </div>

    <div class="recal-wrap"><button class="btn-recal dirty" onclick="onProcess()">✨ Process → ranked Ideas</button></div>
    <div id="procMeter"></div>`;
}
window.route = (k) => { ROUTES[k] = !ROUTES[k]; renderHunger(); };
window.toggleTopic = (name) => { ROUTES.trend = true; TOPICS = TOPICS.includes(name) ? TOPICS.filter((t) => t !== name) : [...TOPICS, name]; renderHunger(); };
window.addSeo = async () => { const content = $("#seoText")?.value.trim(); if (!content) return; ROUTES.seo = true; await fetch("/api/wh/seo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "keywords", content }) }); renderHunger(); };
window.delSeo = async (id) => { await fetch(`/api/wh/seo/${id}/delete`, { method: "POST" }); renderHunger(); };

// TalentMind simulation — synthetic data path (prefilled filters + NLP prompt)
window.talentmindSim = async () => {
  ROUTES.talentmind = true;
  $("#tmSim").innerHTML = `<div id="tmMeter" style="margin-top:8px"></div>`;
  await meter(["Loading synthetic Talent500 pool", "Prefilling filters + NLP query", "Parsing corpora → TalentMind chips", "Reading cohort hunger"], "tmMeter", "");
  await fetch("/api/wh/seed", { method: "POST" });
  await fetch("/api/wh/clientmind/refresh-all", { method: "POST" });
  // prefill: job seekers who stayed < 2 years in each company
  const co = await (await fetch("/api/wh/cohort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "TalentMind sim", domain: "any", nl_query: "job seekers who have stayed less than 2 years in each company" }) })).json();
  const hg = await (await fetch(`/api/wh/hunger/${co.id}`, { method: "POST" })).json();
  TM = { cohortId: co.id, members: co.members, hunger: hg.hunger };
  renderTMWriteup();
};
function renderTMWriteup() {
  const h = TM.hunger || {};
  const chips = (h.cares_about || []).concat(h.motivations || []);
  $("#tmSim").innerHTML = `
    <div class="band" style="margin-top:10px">
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Prefilled cohort · ${TM.members} talent · NLP: "stayed &lt; 2 years in each company"</div>
      <label class="lbl" style="margin-top:8px">TalentMind write-up (edit freely)</label>
      <textarea id="tmWho" rows="3">${esc(h.who || "")}</textarea>
      <label class="lbl" style="margin-top:8px">Chips — add / remove / edit</label>
      <div id="tmChips" class="chips" style="margin:4px 0">${chips.map((c, i) => `<span class="chip">${esc(c)} <a href="#" onclick="rmChip(${i});return false" style="color:#b3261e">✕</a></span>`).join(" ")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><input id="tmNewChip" placeholder="add a chip" style="flex:1;min-width:140px"><button class="btn btn--ghost" onclick="addChip()">+ chip</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
        <div><label class="lbl">Batch name (timestamp default)</label><input id="tmBatch" value="${esc("Batch " + new Date().toLocaleString())}" style="min-width:220px"></div>
        <button class="btn" onclick="saveTM()">Save batch</button><span id="tmMsg" class="lbl"></span>
      </div>
    </div>`;
  window._tmChips = chips;
}
window.addChip = () => { const v = $("#tmNewChip").value.trim(); if (!v) return; window._tmChips.push(v); syncChips(); };
window.rmChip = (i) => { window._tmChips.splice(i, 1); syncChips(); };
function syncChips() { TM.hunger.cares_about = window._tmChips; TM.hunger.motivations = []; renderTMWriteup(); }
window.saveTM = async () => {
  TM.hunger.who = $("#tmWho").value; TM.name = $("#tmBatch").value;
  await fetch(`/api/wh/hunger/${TM.cohortId}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunger: TM.hunger }) });
  $("#tmMsg").innerHTML = `<span style="color:var(--ansr-teal)">✓ batch saved — now Process</span>`;
};

// ---- Process → Ideas -------------------------------------------------------
window.onProcess = async () => {
  if (!ROUTES.trend && !ROUTES.seo && !ROUTES.talentmind) { appAlert("Pick a route", "Tick Trend Spotting, SEO, or run the TalentMind simulation first."); return; }
  step(1, 1);
  $("#stories").innerHTML = `<div id="fs2"></div>`;
  const bodyBatch = TM ? { talentmind_cohort_id: TM.cohortId, name: TM.name } : { trend_topics: ROUTES.trend ? TOPICS : [], seo: ROUTES.seo };
  const b = await (await fetch("/api/wh/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodyBatch) })).json();
  BATCH = { id: b.id, name: b.name };
  await meter(["Collecting feed (YouTube · Reddit)", "Classifying + routing to 1Up franchises", "Gap analysis + velocity", "Writing headings + briefs", "Ranking"], "fs2", "✓ Ideas ranked");
  await fetch(`/api/wh/feedstories/${BATCH.id}`, { method: "POST" });
  step(2);
  await loadIdeas();
  document.querySelector("#flow .flowstep")?.classList.add("folded");
};

// ---- Step 2 · Ideas (ranked, franchise-routed, review CRUD) ----------------
async function loadIdeas() {
  const { stories } = await (await fetch(`/api/wh/feedstories/${BATCH.id}?franchise=${encodeURIComponent(FR)}`)).json();
  const { franchises } = await (await fetch("/api/wh/franchises")).json();
  renderIdeas(stories, franchises);
}
function renderIdeas(stories, franchises) {
  if (!stories) { $("#stories").innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Complete Hunger + Process to see ranked ideas.</p>`; return; }
  const filter = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    <span class="chip chip--role">${esc(BATCH?.name || "batch")}</span>
    <span class="lbl">Franchise</span><select id="frSel" onchange="setFR(this.value)"><option value="all" ${FR === "all" ? "selected" : ""}>all</option>${(franchises || []).map((f) => `<option ${FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
    <span class="lbl">${stories.length} ideas · ranked by score</span></div>`;
  const cards = stories.map((s, i) => {
    const g = s.topic_guide || {}, fb = s.feedback, brd = s.score_breakdown || {};
    return `<div class="band" style="margin-top:10px;border-color:${fb === "used" ? "var(--ansr-teal)" : fb === "saved" ? "var(--ansr-orange)" : fb === "rejected" ? "#d6402a" : "var(--ansr-border)"}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="chip chip--role">#${i + 1} · ${(Number(s.score) * 100).toFixed(0)}</span>
        <b style="color:var(--ansr-navy);font-size:15px;flex:1">${esc(s.heading)}</b>
        ${s.contradiction ? `<span class="chip chip--flag" title="pushes against ${esc(s.contradiction_of || "popular belief")}">⚡ contradiction</span>` : ""}
        ${fb ? `<span class="chip ${fb === "used" ? "chip--approved" : "chip--draft"}">${fb}</span>` : ""}
      </div>
      <div class="chips" style="margin:8px 0"><span class="chip chip--approved">🎯 ${esc(s.franchise)}</span><span class="chip">📌 ${esc(s.demand_topic)}</span><span class="chip">📺 ${esc(s.platform || "")}</span><span class="chip">${esc(s.emotional_register)}</span></div>
      <p style="margin:6px 0;font-size:14px">${esc(s.summary)}</p>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Topic guide</div><div class="lbl">Take: ${esc(g.take || "")}</div>
      ${(g.beats || []).length ? `<ul class="findings sm">${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      <div class="lbl"><b style="color:var(--ansr-navy)">Evidence:</b> ${esc(s.evidence || "")}</div>
      <div class="lbl"><b style="color:var(--ansr-navy)">Why now:</b> ${esc(s.why_now)}</div>
      <div class="lbl" style="color:var(--ansr-gray-mid);margin-top:4px">score = gap ${brd.gap ?? "?"} · velocity ${brd.velocity ?? "?"} · strategic ${brd.strategic ?? "?"} · historical ${brd.historical ?? 0}</div>
      ${s.source_refs?.length ? `<div class="chips" style="margin-top:6px">${s.source_refs.slice(0, 4).map((r) => `<a class="chip" href="${esc(r.url)}" target="_blank">${esc(r.source || "src")}</a>`).join("")}</div>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" onclick="idea(${s.id},'used')" style="border-color:var(--ansr-teal);color:var(--ansr-teal)">✓ Used</button>
        <button class="btn btn--ghost" onclick="idea(${s.id},'saved')">🏦 Saved</button>
        <button class="btn btn--ghost" onclick="rejectIdea(${s.id})" style="border-color:#b3261e;color:#b3261e">✕ Rejected</button>
        <button class="btn btn--ghost" onclick="editIdea(${s.id},'${esc(s.heading).replace(/'/g, "\\'")}')">✎ Edit</button>
        <label style="display:flex;align-items:center;gap:6px;margin-left:auto"><input type="checkbox" ${s.selected ? "checked" : ""} onchange="idea(${s.id},'select')" style="width:auto;min-height:auto"> build</label>
      </div>${s.reject_reason ? `<div class="lbl" style="color:#b3261e;margin-top:4px">rejected: ${esc(s.reject_reason)}</div>` : ""}
    </div>`;
  }).join("");
  $("#stories").innerHTML = filter + (stories.length ? cards : `<p class="lbl">No ideas${FR !== "all" ? " for " + esc(FR) : ""} yet.</p>`);
}
window.setFR = (v) => { FR = v; loadIdeas(); };
window.idea = async (id, action) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); loadIdeas(); };
window.rejectIdea = (id) => { appPrompt("Reject idea", "Reason (off-brand / not interesting / already covered / wrong timing)", async (reason) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rejected", reason }) }); loadIdeas(); }, { placeholder: "not interesting" }); };
window.editIdea = (id, heading) => { appPrompt("Edit heading", "", async (h) => { if (!h) return; await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", heading: h }) }); loadIdeas(); }, { value: heading }); };

// shared progress meter
async function meter(steps, hostId, doneMsg) {
  const host = document.getElementById(hostId); if (!host) return;
  host.innerHTML = `<div class="meter"><div class="meter-bar"><div class="meter-fill" id="mf-${hostId}"></div></div><div class="meter-now" id="mn-${hostId}"></div><div class="meter-list" id="ml-${hostId}"></div></div>`;
  const fill = $(`#mf-${hostId}`), now = $(`#mn-${hostId}`), list = $(`#ml-${hostId}`);
  for (let i = 0; i < steps.length; i++) {
    now.textContent = steps[i]; fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${hostId}-${i}">${esc(steps[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 480));
    const el = $(`#ms-${hostId}-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
  }
  if (doneMsg) now.innerHTML = `<span style="color:var(--ansr-teal)">${doneMsg}</span>`;
}
init();
