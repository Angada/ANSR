// RayDar (Talent Trend Radar) · Journey 1. Flow + progress meter:
// TalentMind → Cohort → Hunger → Sources → Ideas (ranked, franchise-routed).
// AI runs through gated pipelines with a mock fallback. Labels: Talent = job
// seeker; TalentMind = the parsed profile+chips.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
const STEPS = ["TalentMind", "Cohort", "Hunger", "Sources", "Ideas"];
let COHORT = null, FR = "all";

function step(done, active = -1) {
  $("#stepper").innerHTML = STEPS.map((s, i) => {
    let cls = "node"; if (i < done) cls += " done"; if (i === active) cls += " active";
    return `<div class="${cls}"><div class="dot">${i < done ? "&#10003;" : i + 1}</div><div class="lbl">${s}</div></div>`;
  }).join("");
}
async function init() { step(0); await renderTalentMind(); renderCohort(); renderHunger(null); renderSources(); renderIdeas(null); }

// ---- 1 · TalentMind --------------------------------------------------------
async function renderTalentMind() {
  const { candidates } = await (await fetch("/api/wh/candidates")).json();
  const rows = (candidates || []).map((c) => `<tr><td>${esc(c.name)}</td><td class="lbl">${esc(c.meta?.domain || "")}</td><td class="lbl">${c.meta?.years_exp || 0}y</td><td class="r">${c.chips > 0 ? `<span class="chip chip--approved">${c.chips} chips</span>` : `<span class="chip chip--draft">no mind</span>`}</td></tr>`).join("");
  $("#clientmind").innerHTML = `
    <p class="lbl" style="color:var(--ansr-gray)">Talent (job seekers) from Talent500 — mock. Build <b>TalentMind</b> → each person's whole corpus becomes rich searchable chips (munshi method). Weekly refresh + on update.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      ${(candidates || []).length ? "" : `<button class="btn" onclick="seed()">Seed mock talent</button>`}
      <button class="btn-ai" onclick="buildMinds()"><span class="tw">✨</span>Build TalentMind (all)</button>
    </div>
    <div class="scroll-x"><table class="grid"><thead><tr><th>Talent</th><th>Domain</th><th>Exp</th><th class="r">TalentMind</th></tr></thead><tbody>${rows || `<tr><td colspan=4 class=lbl>No talent — seed first.</td></tr>`}</tbody></table></div>
    <div id="cmMeter"></div>`;
}
window.seed = async () => { await fetch("/api/wh/seed", { method: "POST" }); renderTalentMind(); };
window.buildMinds = async () => { step(0, 0); await meter(["Reading talent corpora", "Extracting chips (skills · motivations · patterns)", "Writing TalentMind profiles"], "cmMeter", "✓ TalentMind built"); await fetch("/api/wh/clientmind/refresh-all", { method: "POST" }); step(1); await renderTalentMind(); };

// ---- 2 · Cohort ------------------------------------------------------------
function renderCohort() {
  $("#cohort").innerHTML = `
    <p class="lbl" style="color:var(--ansr-gray)">Build a cohort — a domain filter + an AI natural-language query (e.g. "never stayed longer than 2 years anywhere"). Saved with a name for reuse.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px">
      <div><label class="lbl">Cohort name</label><input id="coName" placeholder="e.g. Restless movers" style="min-width:170px"></div>
      <div><label class="lbl">Domain</label><select id="coDomain"><option value="any">any</option><option>Data Engineering</option><option>Product Management</option><option>AI / ML</option><option>Cloud / DevOps</option><option>Cybersecurity</option><option>UX Design</option></select></div>
      <div style="flex:1;min-width:220px"><label class="lbl">Natural-language query</label><input id="coNL" placeholder="never stayed longer than 2 years anywhere"></div>
      <button class="btn-ai" onclick="buildCohort()"><span class="tw">✨</span>Build cohort</button>
    </div><div id="coOut" class="lbl" style="margin-top:8px"></div>`;
}
window.buildCohort = async () => {
  step(1, 1);
  const body = { name: $("#coName").value || "Cohort", domain: $("#coDomain").value, nl_query: $("#coNL").value };
  const r = await (await fetch("/api/wh/cohort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  COHORT = { id: r.id, members: r.members };
  $("#coOut").innerHTML = `<span class="chip chip--approved">${r.members} talent</span> saved as <b>${esc(body.name)}</b> — now the Hunt Outcome.`;
  step(2); renderHunger(null);
};

// ---- 3 · Hunger ------------------------------------------------------------
function renderHunger(h) {
  if (!COHORT) { $("#hunger").innerHTML = `<p class="lbl" style="color:var(--ansr-gray)">Build a cohort first.</p>`; return; }
  if (!h) { $("#hunger").innerHTML = `<button class="btn-ai" onclick="genHunger()"><span class="tw">✨</span>Generate Hunt Outcome</button><div id="huMeter"></div>`; return; }
  const list = (arr) => (arr || []).map((x) => `<span class="chip">${esc(x)}</span>`).join(" ");
  $("#hunger").innerHTML = `
    <div class="band grad-soft">
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Who they are</div><textarea id="huWho" rows="2" style="margin:4px 0 10px">${esc(h.who || "")}</textarea>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Cares about</div><div class="chips">${list(h.cares_about)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Likely searches</div><div class="chips">${list(h.likely_searches)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Motivations</div><div class="chips">${list(h.motivations)}</div>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500;margin-top:8px">Demand topics</div><div class="chips">${(h.demand_topics || []).map((x) => `<span class="chip chip--approved">${esc(x)}</span>`).join(" ")}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn" onclick="saveHunger()">Save Hunt Outcome</button></div><span id="huMsg" class="lbl"></span>`;
  window._hunger = h; step(3); renderSources();
}
window.genHunger = async () => { step(2, 2); await meter(["Aggregating cohort chips", "Reading motivations + drivers", "Writing the Hunt Outcome"], "huMeter", ""); const r = await (await fetch(`/api/wh/hunger/${COHORT.id}`, { method: "POST" })).json(); renderHunger(r.hunger); };
window.saveHunger = async () => { const h = { ...(window._hunger || {}), who: $("#huWho").value }; await fetch(`/api/wh/hunger/${COHORT.id}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunger: h }) }); $("#huMsg").innerHTML = `<span style="color:var(--ansr-teal)">✓ saved</span>`; };

// ---- 4 · Sources (2 write sources + coming-soon 3rd) -----------------------
async function renderSources() {
  const st = await (await fetch("/api/wh/feed/status")).json().catch(() => ({ mock: true }));
  const seo = (await (await fetch("/api/wh/seo")).json()).inputs || [];
  const banner = st.live ? `<span class="chip chip--approved">🟢 live: ${[...(st.feed || []), ...(st.research || [])].join(", ")}</span>` : `<span class="chip chip--draft">mock — add YouTube/Reddit/Tavily keys in Admin → Integrations for live feed</span>`;
  $("#sources").innerHTML = `
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">1 · Feed collection <span class="lbl" style="font-weight:400">— YouTube + Reddit (India, English)</span></h3>
      <div>${banner}</div>
    </div>
    <div class="band">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">2 · SEO research (paste)</h3>
      <p class="lbl" style="color:var(--ansr-gray)">Paste keyword research, GSC insights, competitor or trend findings — a 2nd write source into the ideas.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div><label class="lbl">Kind</label><select id="seoKind"><option>keywords</option><option>gsc</option><option>competitor</option><option>reddit</option><option>trend</option></select></div>
        <div style="flex:1;min-width:240px"><label class="lbl">Paste</label><textarea id="seoText" rows="2" placeholder="paste research…"></textarea></div>
        <button class="btn" onclick="addSeo()">Add</button>
      </div>
      <div style="margin-top:8px">${seo.map((s) => `<span class="chip">${esc(s.kind)} · ${esc((s.content || "").slice(0, 24))}… <a href="#" onclick="delSeo(${s.id});return false" style="color:#b3261e">✕</a></span>`).join(" ") || `<span class="lbl">nothing pasted yet</span>`}</div>
    </div>
    <div class="band grad-soft">
      <h3 style="color:var(--ansr-navy);font-weight:500;margin:0 0 6px">3 · TalentMind demand <span class="chip chip--draft">coming soon</span></h3>
      <p class="lbl" style="color:var(--ansr-gray)">Demand seeded straight from TalentMind chips (audience-led) — wires in once the loop is proven.</p>
    </div>
    <div class="recal-wrap"><button class="btn-recal dirty" onclick="runRadar()">✨ Run RayDar → ranked Ideas</button></div>
    <div id="fsMeter"></div>`;
}
window.addSeo = async () => { const content = $("#seoText").value.trim(); if (!content) return; await fetch("/api/wh/seo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: $("#seoKind").value, content }) }); renderSources(); };
window.delSeo = async (id) => { await fetch(`/api/wh/seo/${id}/delete`, { method: "POST" }); renderSources(); };

// ---- 5 · Ideas (ranked, franchise-routed, review CRUD) ---------------------
window.runRadar = async () => {
  if (!COHORT) { appAlert("No cohort", "Build a cohort + Hunt Outcome first."); return; }
  step(4, 4);
  $("#stories").innerHTML = `<div id="fs2"></div>`;
  await meter(["Collecting feed (YouTube · Reddit)", "Classifying + routing to 1Up franchises", "Gap analysis + velocity", "Writing 15–20 headings + briefs", "Ranking"], "fs2", "✓ Ideas ranked");
  await fetch(`/api/wh/feedstories/${COHORT.id}`, { method: "POST" });
  step(5);
  await loadIdeas();
  document.querySelectorAll("#flow .flowstep").forEach((s, i) => { if (i < 4) s.classList.add("folded"); });
};
async function loadIdeas() {
  const { stories } = await (await fetch(`/api/wh/feedstories/${COHORT.id}?franchise=${encodeURIComponent(FR)}`)).json();
  const { franchises } = await (await fetch("/api/wh/franchises")).json();
  renderIdeas(stories, franchises);
}
function renderIdeas(stories, franchises) {
  if (!stories) { $("#stories").innerHTML = COHORT ? `<p class="lbl" style="color:var(--ansr-gray)">Run RayDar to generate ranked ideas.</p>` : `<p class="lbl" style="color:var(--ansr-gray)">Complete the journey above.</p>`; return; }
  const filter = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    <span class="lbl">Franchise</span><select id="frSel" onchange="setFR(this.value)">
      <option value="all" ${FR === "all" ? "selected" : ""}>all</option>
      ${(franchises || []).map((f) => `<option ${FR === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
    </select><span class="lbl">${stories.length} ideas · ranked by score</span></div>`;
  const cards = stories.map((s, i) => {
    const g = s.topic_guide || {}, fb = s.feedback;
    const brd = s.score_breakdown || {};
    return `<div class="band" style="margin-top:10px;border-color:${fb === "used" ? "var(--ansr-teal)" : fb === "saved" ? "var(--ansr-orange)" : fb === "rejected" ? "#d6402a" : "var(--ansr-border)"}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="chip chip--role">#${i + 1} · ${(Number(s.score) * 100).toFixed(0)}</span>
        <b style="color:var(--ansr-navy);font-size:15px;flex:1">${esc(s.heading)}</b>
        ${s.contradiction ? `<span class="chip chip--flag" title="pushes against ${esc(s.contradiction_of || "popular belief")}">⚡ contradiction</span>` : ""}
        ${fb ? `<span class="chip ${fb === "used" ? "chip--approved" : "chip--draft"}">${fb}</span>` : ""}
      </div>
      <div class="chips" style="margin:8px 0">
        <span class="chip chip--approved">🎯 ${esc(s.franchise)}</span>
        <span class="chip">📌 ${esc(s.demand_topic)}</span>
        <span class="chip">📺 ${esc(s.platform || "")}</span>
        <span class="chip">${esc(s.emotional_register)}</span>
      </div>
      <p style="margin:6px 0;font-size:14px">${esc(s.summary)}</p>
      <div class="lbl" style="color:var(--ansr-navy);font-weight:500">Topic guide</div>
      <div class="lbl">Take: ${esc(g.take || "")}</div>
      ${(g.beats || []).length ? `<ul class="findings sm">${(g.beats || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      <div class="lbl"><b style="color:var(--ansr-navy)">Evidence:</b> ${esc(s.evidence || "")}</div>
      <div class="lbl"><b style="color:var(--ansr-navy)">Why now:</b> ${esc(s.why_now)}</div>
      <div class="lbl"><b style="color:var(--ansr-navy)">Why this cohort:</b> ${esc(s.why_cohort)}</div>
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
    await new Promise((r) => setTimeout(r, 500));
    const el = $(`#ms-${hostId}-${i}`); el.className = "ms done"; el.textContent = "✓ " + steps[i];
  }
  if (doneMsg) now.innerHTML = `<span style="color:var(--ansr-teal)">${doneMsg}</span>`;
}
init();
