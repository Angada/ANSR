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

async function init() {
  rail();
  ALL_TOPICS = (await (await fetch("/api/wh/topics")).json()).topics || [];
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
        <h3><span class="tick" onclick="route('trend')">✓</span> Trend Spotting</h3>
        <p class="desc">Pick the demand topics — the six domains job seekers hunger for. Each routes to a 1Up franchise.</p>
        <div class="chips">${trendChips}</div>
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
        ${TM ? "" : `<button class="btn small" onclick="talentmindSim()">▶ Run simulation</button>`}
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
function renderIdeas(stories, franchises) {
  const host = $("#stageIdeas");
  if (!stories) { host.innerHTML = `<p class="intro"><b>IDEAS</b> appear here once the sweep completes — each a heading + brief routed to a 1Up franchise, ranked by signal strength.</p><div class="empty">// awaiting sweep //</div>`; return; }
  const frIndex = (name) => Math.max(0, (franchises || []).findIndex((f) => f.name === name));
  const filter = `<div class="ideas-head">
      <span class="chip tag-grn" style="cursor:default">▣ ${esc(BATCH?.name || "batch")}</span>
      <span class="chip" style="border:none;background:none;padding:0">franchise</span>
      <select onchange="setFR(this.value)"><option value="all" ${FR === "all" ? "selected" : ""}>all</option>${(franchises || []).map((f) => `<option ${FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <span class="chip" style="border:none;background:none;padding:0;color:var(--dim2)">${stories.length} ideas · ranked</span>
    </div>`;
  const cards = stories.map((s, i) => {
    const g = s.topic_guide || {}, fb = s.feedback, brd = s.score_breakdown || {};
    const tag = FR_TAG[frIndex(s.franchise) % FR_TAG.length];
    return `<article class="card ${fb || ""}">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span class="rank">#${i + 1}<span class="pct">${(Number(s.score) * 100).toFixed(0)}</span></span>
        ${s.contradiction ? `<span class="chip flag" title="pushes against ${esc(s.contradiction_of || "popular belief")}">⚡ contradiction</span>` : ""}
        ${fb ? `<span class="chip ${fb === "used" ? "tag-grn" : fb === "saved" ? "tag-amber" : "tag-mag"}" style="cursor:default">${esc(fb)}</span>` : ""}
      </div>
      <h4>${esc(s.heading)}</h4>
      <div class="chips">
        <span class="chip ${tag}">🎯 ${esc(s.franchise)}</span>
        <span class="chip">📌 ${esc(s.demand_topic)}</span>
        ${s.platform ? `<span class="chip">📺 ${esc(s.platform)}</span>` : ""}
        ${s.emotional_register ? `<span class="chip">${esc(s.emotional_register)}</span>` : ""}
      </div>
      <p class="sum">${esc(s.summary)}</p>
      <div class="guide">
        <div class="g-l">Topic guide</div>
        <div style="font-size:12.5px;color:var(--dim)">${esc(g.take || "")}</div>
        ${(g.beats || []).length ? `<ul>${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
        ${s.evidence ? `<div style="font-size:12px;color:var(--dim);margin-top:8px"><span class="g-l" style="display:inline">evidence</span> ${esc(s.evidence)}</div>` : ""}
        ${s.why_now ? `<div style="font-size:12px;color:var(--dim);margin-top:6px"><span class="g-l" style="display:inline">why now</span> ${esc(s.why_now)}</div>` : ""}
      </div>
      <div class="score">score = gap <b>${brd.gap ?? "?"}</b> · velocity <b>${brd.velocity ?? "?"}</b> · strategic <b>${brd.strategic ?? "?"}</b> · historical <b>${brd.historical ?? 0}</b></div>
      ${s.source_refs?.length ? `<div class="chips" style="margin-top:10px">${s.source_refs.slice(0, 4).map((r) => `<a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener">↗ ${esc(r.source || "src")}</a>`).join("")}</div>` : ""}
      <div class="acts">
        <button class="btn small" onclick="idea(${s.id},'used')">✓ Used</button>
        <button class="btn small" onclick="idea(${s.id},'saved')">🏦 Save</button>
        <button class="btn small" onclick="rejectIdea(${s.id})">✕ Reject</button>
        <button class="btn small" onclick="editIdea(${s.id},'${esc(s.heading).replace(/'/g, "\\'")}')">✎ Edit</button>
        <label class="build"><input type="checkbox" ${s.selected ? "checked" : ""} onchange="idea(${s.id},'select')"> build</label>
      </div>
      ${s.reject_reason ? `<div style="font-family:var(--mono);font-size:10.5px;color:var(--red);margin-top:8px">rejected: ${esc(s.reject_reason)}</div>` : ""}
    </article>`;
  }).join("");
  host.innerHTML = `<p class="intro"><b>IDEAS</b> — ranked by composite signal. Review each: mark Used, Save to the vault, Reject with a reason, Edit the heading, or tick <b>build</b>.</p>` +
    filter + (stories.length ? `<div class="grid">${cards}</div>` : `<div class="empty">// no ideas${FR !== "all" ? " for " + esc(FR) : ""} //</div>`);
}
window.setFR = (v) => { FR = v; loadIdeas(); };
window.idea = async (id, action) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); loadIdeas(); };
window.rejectIdea = (id) => rdPrompt("Reject idea", "Reason — off-brand · not interesting · already covered · wrong timing", "not interesting", async (reason) => { await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rejected", reason }) }); loadIdeas(); });
window.editIdea = (id, heading) => rdPrompt("Edit heading", "", heading, async (h) => { if (!h) return; await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", heading: h }) }); loadIdeas(); });

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
