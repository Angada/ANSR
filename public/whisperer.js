// Whisperer · Journey 1 (mock-first). Flow + progress meter across:
// ClientMind → Cohort → Hunger → Feed Stories. AI runs through gated pipelines
// (server) with a mock fallback, so it works with or without a provider key.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const STEPS = ["ClientMind", "Cohort", "Hunger", "Feed Stories"];
let COHORT = null; // {id, members}

function step(done, active = -1) {
  $("#stepper").innerHTML = STEPS.map((s, i) => {
    let cls = "node"; if (i < done) cls += " done"; if (i === active) cls += " active";
    return `<div class="${cls}"><div class="dot">${i < done ? "&#10003;" : i + 1}</div><div class="lbl">${s}</div></div>`;
  }).join("");
}

async function init() {
  step(0);
  await renderClientMind(); renderCohort(); renderHunger(null); renderStories(null);
}

// ---- 1 · ClientMind --------------------------------------------------------
async function renderClientMind() {
  const { candidates } = await (await fetch("/api/wh/candidates")).json();
  const rows = (candidates || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="lbl">${esc(c.meta?.domain || "")}</td><td class="lbl">${c.meta?.years_exp || 0}y</td><td class="r">${c.chips > 0 ? `<span class="chip chip--approved">${c.chips} chips</span>` : `<span class="chip chip--draft">no mind</span>`}</td></tr>`).join("");
  $("#clientmind").innerHTML = `
    <p class="lbl" style="color:var(--ansr-gray)">Talent500 candidates (mock). Build ClientMind → each candidate's whole corpus becomes rich searchable chips (munshi method). Weekly refresh + on update.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      ${(candidates || []).length ? "" : `<button class="btn" onclick="seed()">Seed mock candidates</button>`}
      <button class="btn-ai" onclick="buildMinds()"><span class="tw">✨</span>Build ClientMind (all)</button>
    </div>
    <div class="scroll-x"><table class="grid"><thead><tr><th>Candidate</th><th>Domain</th><th>Exp</th><th class="r">ClientMind</th></tr></thead><tbody>${rows || `<tr><td colspan=4 class=lbl>No candidates — seed first.</td></tr>`}</tbody></table></div>
    <div id="cmMeter"></div>`;
}
window.seed = async () => { await fetch("/api/wh/seed", { method: "POST" }); renderClientMind(); };
window.buildMinds = async () => {
  step(0, 0);
  await meter(["Reading candidate corpora", "Extracting chips (skills · motivations · patterns)", "Writing master profiles"], "cmMeter", "✓ ClientMind built");
  await fetch("/api/wh/clientmind/refresh-all", { method: "POST" });
  step(1); await renderClientMind();
};

// ---- 2 · Cohort ------------------------------------------------------------
function renderCohort() {
  $("#cohort").innerHTML = `
    <p class="lbl" style="color:var(--ansr-gray)">Build a cohort with a domain filter + an AI natural-language query (e.g. "never stayed longer than 2 years anywhere"). Saved with a name for reuse + targeting.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
      <div><label class="lbl">Cohort name</label><input id="coName" placeholder="e.g. Restless movers" style="min-width:180px"></div>
      <div><label class="lbl">Domain</label><select id="coDomain"><option value="any">any</option><option>Data Engineering</option><option>Product Management</option><option>AI / ML</option><option>Cloud / DevOps</option><option>Cybersecurity</option><option>UX Design</option></select></div>
      <div style="flex:1;min-width:220px"><label class="lbl">Natural-language query</label><input id="coNL" placeholder="never stayed longer than 2 years anywhere"></div>
      <button class="btn-ai" onclick="buildCohort()"><span class="tw">✨</span>Build cohort</button>
    </div>
    <div id="coOut" class="lbl" style="margin-top:8px"></div>`;
}
window.buildCohort = async () => {
  step(1, 1);
  const body = { name: $("#coName").value || "Cohort", domain: $("#coDomain").value, nl_query: $("#coNL").value };
  const r = await (await fetch("/api/wh/cohort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  COHORT = { id: r.id, members: r.members };
  $("#coOut").innerHTML = `<span class="chip chip--approved">${r.members} candidates</span> saved as <b>${esc(body.name)}</b> — now generate the Hunt Outcome.`;
  step(2); renderHunger(null);
};

// ---- 3 · Hunger (Hunt Outcome) ---------------------------------------------
function renderHunger(h) {
  if (!COHORT) { $("#hunger").innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Build a cohort first.</p>`; return; }
  if (!h) { $("#hunger").innerHTML = `<button class="btn-ai" onclick="genHunger()"><span class="tw">✨</span>Generate Hunt Outcome</button><div id="huMeter"></div>`; return; }
  const list = (arr) => (arr || []).map((x) => `<span class="chip">${esc(x)}</span>`).join(" ");
  $("#hunger").innerHTML = `
    <div class="band grad-soft">
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Who they are</div>
      <textarea id="huWho" rows="2" style="margin:4px 0 10px">${esc(h.who || "")}</textarea>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Cares about</div><div class="chips">${list(h.cares_about)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Likely searches</div><div class="chips">${list(h.likely_searches)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Motivations</div><div class="chips">${list(h.motivations)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Emotional drivers</div><div class="chips">${list(h.emotional_drivers)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Demand topics</div><div class="chips">${(h.demand_topics || []).map((x) => `<span class="chip chip--approved">${esc(x)}</span>`).join(" ")}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      <button class="btn" onclick="saveHunger()">Save Hunt Outcome</button>
      <button class="btn-ai" onclick="runWhisperer()"><span class="tw">✨</span>Run Whisperer → Feed Stories</button>
    </div><span id="huMsg" class="lbl"></span>`;
  window._hunger = h;
}
window.genHunger = async () => {
  step(2, 2);
  await meter(["Aggregating cohort chips", "Reading motivations + drivers", "Writing the Hunt Outcome"], "huMeter", "");
  const r = await (await fetch(`/api/wh/hunger/${COHORT.id}`, { method: "POST" })).json();
  renderHunger(r.hunger);
};
window.saveHunger = async () => {
  const h = { ...(window._hunger || {}), who: $("#huWho").value };
  await fetch(`/api/wh/hunger/${COHORT.id}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunger: h }) });
  $("#huMsg").innerHTML = `<span style="color:var(--ansr-teal)">✓ saved</span>`;
};

// ---- 4 · Feed Stories ------------------------------------------------------
window.runWhisperer = async () => {
  step(3, 3);
  const st = await (await fetch("/api/wh/feed/status")).json().catch(() => ({ mock: true }));
  const banner = st.live
    ? `<div class="chip chip--approved">🟢 live sources: ${[...(st.feed || []), ...(st.research || [])].join(", ")}</div>`
    : `<div class="chip chip--draft">mock data — enable YouTube/Reddit/Tavily/Serper keys in Admin → Integrations for live feed</div>`;
  $("#stories").innerHTML = `<div style="margin-bottom:8px">${banner}</div><div id="fsMeter"></div>`;
  await meter(["Collecting feed (YouTube · Reddit · Trends · News)", "Researching + validating", "Detecting trends", "Writing headings + topic guides", "Classifying + justifying"], "fsMeter", "✓ Feed Stories ready");
  await fetch(`/api/wh/feedstories/${COHORT.id}`, { method: "POST" });
  step(4);
  const { stories } = await (await fetch(`/api/wh/feedstories/${COHORT.id}`)).json();
  renderStories(stories);
  document.querySelectorAll("#flow .flowstep").forEach((s, i) => { if (i < 3) s.classList.add("folded"); });
};
function renderStories(stories) {
  if (!stories) { $("#stories").innerHTML = COHORT ? `<p class="lbl" style="color:var(--ansr-gray)">Generate the Hunt Outcome, then run Whisperer.</p>` : `<p class="lbl" style="color:var(--ansr-gray)">Complete the journey above.</p>`; return; }
  if (!stories.length) { $("#stories").innerHTML = `<p class="lbl">No stories yet.</p>`; return; }
  $("#stories").innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Each = a heading + topic guide for a writer. Approve, bank, delete, edit — and ✓ select the ones to build.</p>` +
    stories.map((s) => {
      const st = s.status, sel = s.selected;
      const g = s.topic_guide || {};
      return `<div class="band" style="margin-top:10px;border-color:${st === "approved" ? "var(--ansr-teal)" : sel ? "var(--ansr-orange)" : "var(--ansr-border)"}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="checkbox" ${sel ? "checked" : ""} onchange="storyAction(${s.id},'select')" title="select to build" style="width:auto;min-height:auto">
          <b style="color:var(--ansr-navy);font-size:15px;flex:1">${esc(s.heading)}</b>
          <span class="chip ${st === "approved" ? "chip--approved" : st === "banked" ? "chip--draft" : "chip--flag"}">${st}</span>
        </div>
        <div class="chips" style="margin:8px 0">
          <span class="chip chip--approved">📌 ${esc(s.demand_topic)}</span>
          <span class="chip">1-Up · ${esc(s.one_up)}</span>
          <span class="chip">${esc(s.emotional_framework)}</span>
          <span class="chip">${esc(s.emotional_register)}</span>
        </div>
        <p style="margin:6px 0;font-size:14px">${esc(s.summary)}</p>
        <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:6px">Topic guide</div>
        <div class="lbl" style="margin:2px 0">Take: ${esc(g.take || "")}</div>
        ${(g.beats || []).length ? `<ul class="findings sm">${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
        <div style="display:grid;grid-template-columns:1fr;gap:4px;margin-top:6px">
          <div class="lbl"><b style="color:var(--ansr-navy)">Why now:</b> ${esc(s.why_now)}</div>
          <div class="lbl"><b style="color:var(--ansr-navy)">Why relevant:</b> ${esc(s.why_relevant)}</div>
          <div class="lbl"><b style="color:var(--ansr-navy)">Why this cohort:</b> ${esc(s.why_cohort)}</div>
        </div>
        ${(s.source_refs || []).length ? `<div class="lbl" style="margin-top:6px"><b style="color:var(--ansr-navy)">Sources:</b> ${(s.source_refs || []).slice(0, 6).map((r) => `<a href="${esc(r.url)}" target="_blank" class="chip">${esc(r.source || "link")}</a>`).join(" ")}</div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn" onclick="storyAction(${s.id},'approve')" style="border-color:var(--ansr-teal);color:var(--ansr-teal)">✓ Approve</button>
          <button class="btn btn--ghost" onclick="storyAction(${s.id},'bank')">🏦 Bank</button>
          <button class="btn btn--ghost" onclick="storyAction(${s.id},'delete')" style="border-color:#b3261e;color:#b3261e">Delete</button>
        </div>
      </div>`;
    }).join("");
}
window.storyAction = async (id, action) => {
  await fetch(`/api/wh/feedstory/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  const { stories } = await (await fetch(`/api/wh/feedstories/${COHORT.id}`)).json();
  renderStories(stories);
};

// shared progress meter
async function meter(steps, hostId, doneMsg) {
  const host = document.getElementById(hostId); if (!host) return;
  host.innerHTML = `<div class="meter"><div class="meter-bar"><div class="meter-fill" id="mf-${hostId}"></div></div><div class="meter-now" id="mn-${hostId}"></div><div class="meter-list" id="ml-${hostId}"></div></div>`;
  const fill = $(`#mf-${hostId}`), now = $(`#mn-${hostId}`), list = $(`#ml-${hostId}`);
  for (let i = 0; i < steps.length; i++) {
    now.textContent = steps[i]; fill.style.width = Math.round(((i + 1) / steps.length) * 100) + "%";
    list.insertAdjacentHTML("beforeend", `<div class="ms" id="ms-${hostId}-${i}">${esc(steps[i])}…</div>`);
    await new Promise((r) => setTimeout(r, 520));
    const el = $(`#ms-${hostId}-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
  }
  if (doneMsg) now.innerHTML = `<span style="color:var(--ansr-teal)">${doneMsg}</span>`;
}

init();
