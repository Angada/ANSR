// Contra — contract review. Areas: Archetypes (Maker · Library) · Contracts
// (Review · Reviewed). Phase 1+ : Archetype Maker (multi-step propose) and the
// Archetype Library with plain-English review rules (type → Enter → chip).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
// India time (IST) — always show Asia/Kolkata regardless of the viewer's device
const IST = { timeZone: "Asia/Kolkata" };
const fmtDT = (ts) => ts ? new Date(ts).toLocaleString("en-IN", { ...IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "";
const fmtD = (ts) => ts ? new Date(ts).toLocaleDateString("en-IN", { ...IST, day: "2-digit", month: "short", year: "numeric" }) : "";
const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

let AREA = "contracts";
let SUB = { archetypes: "maker", contracts: "review" };
let ARCH = null;          // the archetype currently open in the editor
let EDIT_IN = null;       // "maker" | "library" — where the editor is shown
let ARCHES = [];          // library list
let BATCH = null;         // current review batch { batch, reviews:[...] }
let CFILES = [];          // dropped File objects, index-aligned with BATCH.reviews
let RVOPEN = null;        // opened reviewed contract { review, changes }
let RVTAB = "report";     // report | timeline
let ASK_LAST = null, ASK_BOXKEY = null;   // Ask Contract: last Q&A + focused box
let REVIEWS = [], REVIEWS_LOADED = false;  // Reviewed history table
// filter a table by its rows' data-k (no re-render → keeps focus). With no query
// it shows the 10 most-recent; typing searches ALL rows.
window.filterTable = (tid, v) => {
  const q = (v || "").toLowerCase().trim();
  const rows = [...document.querySelectorAll(`#${tid} tbody tr`)];
  let shown = 0;
  rows.forEach((tr) => { const m = (tr.dataset.k || "").includes(q); const show = q ? m : shown < 10; tr.style.display = show ? "" : "none"; if (show) shown++; });
  const note = document.getElementById(tid + "-note");
  if (note) note.textContent = q ? `${shown} match${shown === 1 ? "" : "es"} of ${rows.length}` : `showing ${Math.min(10, rows.length)} of ${rows.length}`;
};
const VIEWS = { maker: "#view-maker", library: "#view-library", review: "#view-review", reviewed: "#view-reviewed" };
function meterHtml(msg) { return `<div class="meter"><div class="now"><img class="potspin" src="/brand/assets/logos/pot.png" alt="">${esc(msg)}</div><div class="track"><div class="fill indet"></div></div></div>`; }
// stepped meter: ticks through the REAL pipeline steps while `promise` runs,
// rotating Pot on the active step, ✓ on the done ones. Resolves to promise's value.
async function runWithMeter(hostId, steps, promise) {
  const host = document.getElementById(hostId); if (!host) return promise;
  let i = 0;
  const render = () => { host.innerHTML = `<div class="meter"><div class="cmeter-steps">${steps.map((s, idx) => `<div class="cmstep ${idx < i ? "done" : idx === i ? "now" : ""}"><span class="cmi">${idx < i ? '<span class="ck">✓</span>' : idx === i ? '<img class="potspin" src="/brand/assets/logos/pot.png" alt="">' : '<span class="cmdot"></span>'}</span><span>${esc(s)}</span></div>`).join("")}</div><div class="track"><div class="fill" style="width:${Math.round((i / steps.length) * 100)}%"></div></div></div>`; };
  render();
  const timer = setInterval(() => { if (i < steps.length - 1) { i++; render(); } }, 1400);
  try { const r = await promise; i = steps.length; render(); return r; }
  finally { clearInterval(timer); }
}

function renderNav() {
  $("#mainnav").innerHTML = [["contracts", "Contracts"], ["archetypes", "Archetypes"]]
    .map(([k, l]) => `<button class="${AREA === k ? "on" : ""}" onclick="setArea('${k}')">${l}</button>`).join("");
  const reviewN = REVIEWS_LOADED ? REVIEWS.length : null;
  const subs = AREA === "archetypes"
    ? [["maker", "Maker", null], ["library", "Library", ARCHES.length]]
    : [["review", "Review", null], ["reviewed", "Reviewed", reviewN]];
  $("#subnav").innerHTML = subs.map(([k, l, n]) => `<button class="${SUB[AREA] === k ? "on" : ""}" onclick="setSub('${k}')">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("");
}
window.setArea = (a) => { AREA = a; setSub(SUB[a]); };
window.setSub = (s) => { SUB[AREA] = s; renderNav(); Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $(VIEWS[s]).hidden = false; renderView(s); };
function renderView(s) { ({ maker: renderMaker, library: renderLibrary, review: renderReview, reviewed: renderReviewed }[s])(); }
function rerenderEditor(focusI) { (EDIT_IN === "library" ? renderLibrary : renderMaker)(); if (focusI != null) { const el = document.querySelectorAll(".rinput")[focusI]; el && el.focus(); } }

async function init() {
  await loadArches();
  fetch("/api/contra/reviews").then((r) => r.json()).then((j) => { REVIEWS = j.reviews || []; REVIEWS_LOADED = true; renderNav(); }).catch(() => {});
  renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true));
  $(VIEWS[SUB[AREA]]).hidden = false;
  renderView(SUB[AREA]);
}
async function loadArches() { try { ARCHES = (await (await fetch("/api/contra/archetypes")).json()).archetypes || []; } catch { ARCHES = []; } }

// ---- shared section editor (used by Maker + Library) -----------------------
function sectionCard(s, i) {
  const rules = (s.rules || []).map((r) => `<span class="rchip">${esc(r.text)}<a class="x" title="remove" onclick="delRule(${i},'${r.id}')">×</a></span>`).join("");
  return `<div class="sec ${s.required ? "req" : ""}">
    <div class="sec-top"><span class="ord">${String(i + 1).padStart(2, "0")}</span><span class="lbl">${esc(s.label)}</span>
      <span class="reqtag ${s.required ? "on" : "off"}" onclick="toggleReq(${i})">${s.required ? "★ REQUIRED" : "optional"}</span></div>
    <p class="chk">${esc(s.what_to_check || "—")}</p>
    <div class="rules">
      <div class="rules-lbl">✦ review rules · applied to this section</div>
      <div class="rchips">${rules || '<span class="rnone">no rules yet — type one below</span>'}</div>
      <input class="rinput" placeholder="add a rule in plain English, then press Enter…" onkeydown="ruleKey(event,${i})">
    </div>
    <div class="sec-acts"><button class="lnk" onclick="amendSection(${i})">Amend label</button><button class="lnk del" onclick="delSection(${i})">Remove</button></div>
  </div>`;
}
function sectionEditor() {
  const secs = ARCH.sections.map((s, i) => sectionCard(s, i)).join("");
  const req = ARCH.sections.filter((s) => s.required).length;
  const grules = (ARCH.global_rules || []).map((r) => `<span class="rchip">${esc(r.text)}<a class="x" onclick="delGRule('${r.id}')">×</a></span>`).join("");
  const saved = ARCH.status === "saved";
  const vers = ARCH.versions || [];
  const verDrop = (saved && vers.length) ? `<label class="metalbl" style="width:auto;padding-top:0">View version</label>
      <select id="verpick" onchange="loadVersion(this.value)">${vers.map((v) => `<option value="${v.version}" ${v.version === (ARCH._viewing || ARCH.version) ? "selected" : ""}>v${v.version}${v.version === ARCH.version ? " · current" : ""} · ${fmtD(v.created_at)}</option>`).join("")}</select>` : "";
  const meta = `<div class="arch-meta">
      <div class="arch-meta-row"><label class="metalbl">Name</label><input id="archname" value="${esc(ARCH.name)}" oninput="onName(this.value)" placeholder="e.g. MSA — India GCC"></div>
      <div class="arch-meta-row"><label class="metalbl">Description</label><textarea id="archdesc" rows="2" oninput="onDesc(this.value)" placeholder="What this contract type is for — with examples (e.g. master services for GCC build-and-operate; Acme, Northwind).">${esc(ARCH.description || "")}</textarea></div>
      <div class="arch-meta-row2">
        <span class="metastamp">${saved ? `${vers.length ? `Version <b>v${ARCH.version}</b> · ` : ""}created ${ARCH.created_at ? fmtD(ARCH.created_at) : "—"}` : "draft · not yet saved"}</span>
        ${ARCH._viewing ? `<span class="viewnote">viewing v${ARCH._viewing} — Save to restore it as v${(ARCH.version || 1) + 1}</span>` : ""}
        <span style="margin-left:auto;display:flex;align-items:center;gap:8px">${verDrop}</span>
      </div></div>`;
  return meta + `<div class="sec-head"><h3>Review outline</h3>
      <span class="chip">${ARCH.sections.length} sections · <b style="color:var(--org)">${req} required</b></span>
      <button class="btn small" onclick="addSection()" style="margin-left:auto">+ Add section</button></div>
    <div class="grid">${secs}</div>
    <div class="grules"><div class="rules-lbl">✦ archetype-wide rules · applied to the whole contract</div>
      <div class="rchips">${grules || '<span class="rnone">none — add whole-contract rules like “governing law must be Bangalore”</span>'}</div>
      <input class="rinput" id="grinput" placeholder="add a whole-contract rule, then press Enter…" onkeydown="grKey(event)"></div>
    <div class="savebar">
      <span style="font-weight:600">${saved ? "Save changes" : "Save archetype"}</span>
      <span class="stampnote">${saved ? "each save is snapshotted as a new version" : "timestamp auto-suffixed on save"}</span>
      <button class="btn btn--primary" style="margin-left:auto" onclick="saveArchetype()">${saved ? `Save as v${(ARCH.version || 1) + 1} ▸` : "Save archetype ▸"}</button>
      <button class="btn" onclick="${saved ? "closeEditor()" : "discardDraft()"}">${saved ? "Close" : "Discard"}</button>
    </div>`;
}
window.onDesc = (v) => { ARCH.description = v; };
window.loadVersion = async (v) => {
  v = Number(v);
  if (v === ARCH.version && !ARCH._viewing) return;
  const j = await (await fetch(`/api/contra/archetype/${ARCH.id}/version/${v}`)).json();
  const s = j.version || {};
  ARCH.name = s.name || ARCH.name; ARCH.description = s.description || ""; ARCH.sections = s.review_outline || []; ARCH.global_rules = s.global_rules || [];
  ARCH._viewing = (v !== ARCH.version) ? v : null;
  rerenderEditor();
};

// rules — type + Enter → chip (multiple per section, removable)
window.ruleKey = (e, i) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value.trim(); if (v) addRule(i, v); } };
window.addRule = (i, text) => { (ARCH.sections[i].rules = ARCH.sections[i].rules || []).push({ id: rid("r"), text, created_at: new Date().toISOString() }); rerenderEditor(i); saveDraft(); };
window.delRule = (i, id) => { ARCH.sections[i].rules = (ARCH.sections[i].rules || []).filter((r) => r.id !== id); rerenderEditor(); saveDraft(); };
window.grKey = (e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value.trim(); if (v) addGRule(v); } };
window.addGRule = (text) => { (ARCH.global_rules = ARCH.global_rules || []).push({ id: rid("g"), text, created_at: new Date().toISOString() }); rerenderEditor(); document.getElementById("grinput")?.focus(); saveDraft(); };
window.delGRule = (id) => { ARCH.global_rules = (ARCH.global_rules || []).filter((r) => r.id !== id); rerenderEditor(); saveDraft(); };

window.toggleReq = (i) => { ARCH.sections[i].required = !ARCH.sections[i].required; rerenderEditor(); saveDraft(); };
window.delSection = (i) => { ARCH.sections.splice(i, 1); rerenderEditor(); saveDraft(); };
window.onName = (v) => { ARCH.name = v; };
window.addSection = () => rdForm("Add a section", [{ k: "label", label: "Section label", ph: "e.g. Data protection" }, { k: "chk", label: "What to check", ph: "what a reviewer verifies here" }], (o) => {
  if (!o.label) return;
  ARCH.sections.push({ key: o.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: o.label, what_to_check: o.chk || "", required: true, rules: [], order: ARCH.sections.length });
  rerenderEditor(); saveDraft();
});
window.amendSection = (i) => { const s = ARCH.sections[i]; rdForm("Amend section", [{ k: "label", label: "Section label", v: s.label }, { k: "chk", label: "What to check", v: s.what_to_check }], (o) => { s.label = o.label || s.label; s.what_to_check = o.chk; rerenderEditor(); saveDraft(); }); };

async function saveDraft() {
  if (!ARCH?.id) return;
  ARCH.sections.forEach((s, i) => (s.order = i));
  try { await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, description: ARCH.description || "", review_outline: ARCH.sections, global_rules: ARCH.global_rules || [], save: false }) }); } catch { /* keep local */ }
}
window.saveArchetype = async () => {
  if (!ARCH?.id) return;
  if (!ARCH.name?.trim()) return rdAlert("Name it first", "Give the archetype a name so Review can detect against it.");
  if (!ARCH.sections.some((s) => s.required)) return rdAlert("Mark at least one required", "Tag the sections that matter as Required.");
  ARCH.sections.forEach((s, i) => (s.order = i));
  const r = await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, description: ARCH.description || "", review_outline: ARCH.sections, global_rules: ARCH.global_rules || [], save: true }) });
  const j = await r.json();
  if (!r.ok) return rdAlert("Save failed", j.error || "");
  ARCH = null; EDIT_IN = null; await loadArches(); renderNav(); renderView(SUB[AREA]);
  rdAlert("Archetype saved", `“${esc(j.archetype.name)}” saved as v${j.archetype.version} — in your library and ready for Review.`);
};
window.closeEditor = () => { ARCH = null; EDIT_IN = null; renderNav(); renderView(SUB[AREA]); };
window.discardDraft = () => rdConfirm("Discard this draft?", "The proposed outline will be deleted.", async () => { if (ARCH?.id) await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "DELETE" }); ARCH = null; EDIT_IN = null; await loadArches(); renderNav(); renderView(SUB[AREA]); });

// ---- Archetype Maker (upload → multi-step propose → editor) ----------------
function renderMaker() {
  const drop = `<div class="drop" id="drop" onclick="document.getElementById('file').click()"
        ondragover="dzOver(event)" ondragenter="dzOver(event)" ondragleave="dzLeave(event)" ondrop="dzDrop(event)">
      <span class="ic">⤒</span>
      <div><div class="t">Drop a sample contract to learn its type</div>
        <div class="s">PDF or DOCX · Munshi3 vision-OCR for scans → Contra proposes the review sections and suggests rules</div></div>
      <input type="file" id="file" accept=".pdf,.docx,.doc,.txt,.md" onchange="uploadSample(this.files[0])">
    </div>`;
  const editor = (ARCH && EDIT_IN === "maker") ? sectionEditor() : "";
  $("#view-maker").innerHTML = `<p class="intro"><b>ARCHETYPE MAKER</b> — upload a sample; Contra reads it (Munshi3), proposes the review sections and suggests rules. Confirm what's required, add your own rules, and save.</p>`
    + drop + `<div id="proc"></div>` + editor;
}
window.dzOver = (e) => { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = "copy"); e.currentTarget.classList.add("over"); };
window.dzLeave = (e) => { e.currentTarget.classList.remove("over"); };
window.dzDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) uploadSample(f); };
window.uploadSample = async (file) => {
  if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  const req = (async () => { const r = await fetch("/api/contra/archetype/propose", { method: "POST", body: fd }); return { ok: r.ok, j: await r.json() }; })();
  try {
    const { ok, j } = await runWithMeter("proc", ["Reading the contract · Munshi3", "Atomizing → clause chips", "Proposing review sections", "Suggesting rules from the terms"], req);
    const p = $("#proc"); if (p) p.innerHTML = "";
    if (!ok) return rdAlert("Couldn't read that", j.error || "Try a different file.");
    ARCH = { id: j.id, name: j.name, status: "draft", sections: j.sections || [], global_rules: [] };
    EDIT_IN = "maker";
    await loadArches(); renderNav(); renderMaker();
    if (j.mode !== "ai") rdAlert("Starter outline (no LLM key)", "Contra returned a generic starter. Point the Contra pipelines at a keyed model in AI Skills & Pipelines for a real read.");
  } catch (e) { const p = $("#proc"); if (p) p.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
};

// ---- Archetype Library (open → add rules → save) ---------------------------
function renderLibrary() {
  const host = $("#view-library");
  if (ARCH && EDIT_IN === "library") {
    host.innerHTML = `<span class="backlnk" onclick="closeEditor()">‹ back to library</span>` + sectionEditor();
    return;
  }
  const rows = ARCHES.map((a) => `<tr class="clk" data-k="${esc((a.name + " " + (a.description || "") + " " + a.status).toLowerCase())}">
      <td onclick="editArch(${a.id})"><b>${esc(a.name)}</b>${a.status === "saved" ? `<span class="vtag">v${a.version || 1}</span>` : `<span class="chip draft" style="margin-left:6px">draft</span>`}</td>
      <td class="tdesc" onclick="editArch(${a.id})">${a.description ? esc(a.description) : "<span style='color:var(--dim2)'>—</span>"}</td>
      <td onclick="editArch(${a.id})">${a.sections}</td>
      <td onclick="editArch(${a.id})">${a.rules != null ? a.rules : "—"}</td>
      <td onclick="editArch(${a.id})">${fmtD(a.updated_at || a.created_at)}</td>
      <td class="tacts"><button class="btn small" onclick="editArch(${a.id})">Open</button> <button class="btn small" onclick="delArch(${a.id},'${esc(a.name).replace(/'/g, "\\'")}')">✕</button></td>
    </tr>`).join("");
  host.innerHTML = `<p class="intro"><b>ARCHETYPE LIBRARY</b> — your saved contract types. The 10 most recent show here; type to search all. Open one to edit its rules, name, and versions.</p>`
    + (ARCHES.length
      ? `<div class="cfilter"><input placeholder="filter archetypes…" oninput="filterTable('libtable',this.value)"><span class="am" id="libtable-note"></span></div>
         <table class="ctable" id="libtable"><thead><tr><th>Archetype</th><th>Description</th><th>Sections</th><th>Rules</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">// no archetypes yet — make one in the Archetype Maker //</div>`);
  if (ARCHES.length) filterTable("libtable", "");
}
window.editArch = async (id) => {
  const j = await (await fetch(`/api/contra/archetype/${id}`)).json();
  const a = j.archetype;
  ARCH = { id: a.id, name: a.name, status: a.status, description: a.description || "", version: a.version || 1, versions: j.versions || [], created_at: a.created_at, _viewing: null, sections: a.review_outline || [], global_rules: a.global_rules || [] };
  EDIT_IN = "library"; renderLibrary(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.delArch = (id, name) => rdConfirm("Delete archetype?", `“${name}” will be removed.`, async () => { await fetch(`/api/contra/archetype/${id}`, { method: "DELETE" }); if (ARCH?.id === id) { ARCH = null; EDIT_IN = null; } await loadArches(); renderNav(); renderView(SUB[AREA]); });

// ---- Contracts · Review (drop → detect → select → review) ------------------
function renderReview() {
  const host = $("#view-review");
  const saved = ARCHES.filter((a) => a.status === "saved");
  const drop = `<div class="drop" id="cdrop" onclick="document.getElementById('cfile').click()"
        ondragover="dzOver(event)" ondragenter="dzOver(event)" ondragleave="dzLeave(event)" ondrop="cDrop(event)">
      <span class="ic">⇊</span>
      <div><div class="t">Drop contracts — or select files</div>
        <div class="s">PDF / DOCX · Munshi3 vision-OCR for scans · each auto-detects its archetype</div></div>
      <input type="file" id="cfile" accept=".pdf,.docx,.doc,.txt,.md" multiple onchange="cUpload(this.files)">
    </div>`;
  let body = "";
  if (!saved.length) body = `<div class="empty">// save an archetype in the Archetype Maker first — Review detects against it //</div>`;
  else if (BATCH) body = BATCH.reviews.map((rv, i) => reviewRow(rv, i)).join("");
  host.innerHTML = `<p class="intro"><b>REVIEW</b> — drop a contract; Contra detects its type and <b>recommends archetypes</b>. Confirm or pick up to 3, then Review. Overlapping points are deduped.</p>`
    + drop + `<div id="cproc"></div>` + body;
}
function reviewRow(rv, i) {
  if (rv.status === "done") {
    return `<div class="crow"><div class="crow-h done"><span class="cn">${esc(rv.contract_name)}</span>
      <span class="chip saved">reviewed</span><span class="am">${rv.issue_count} issue${rv.issue_count === 1 ? "" : "s"}</span>
      <button class="btn small" style="margin-left:auto" onclick="openReviewed(${rv.id})">Open review ▸</button></div></div>`;
  }
  const saved = ARCHES.filter((a) => a.status === "saved");
  const detIds = (rv.detected || []).map((d) => d.archetype_id);
  if (!rv.selected) rv.selected = detIds.slice(0, 3);
  const detTop = (rv.detected || [])[0];
  const ranked = [...saved].sort((a, b) => (detIds.includes(b.id) ? 1 : 0) - (detIds.includes(a.id) ? 1 : 0));
  const chips = ranked.map((a) => {
    const on = rv.selected.includes(a.id);
    const det = (rv.detected || []).find((d) => d.archetype_id === a.id);
    const tag = det ? (det.archetype_id === detTop?.archetype_id ? "detected" : "recommended") : "";
    return `<div class="achip ${on ? "on" : ""}" onclick="toggleArch(${i},${a.id})">
      <span class="tick">${on ? "✓" : ""}</span>
      <div><div class="an">${esc(a.name)}${det ? ` <span class="detbadge">${tag} · ${Math.round((det.confidence || 0) * 100)}%</span>` : ""}</div>
        <div class="ad">${a.sections} sections${det?.why ? ` · <span class="aex">${esc(det.why)}</span>` : ""}</div></div></div>`;
  }).join("");
  const sel = rv.selected.length;
  const detName = detTop ? (saved.find((a) => a.id === detTop.archetype_id) || {}).name : null;
  return `<div class="crow">
    <div class="crow-h"><span class="cn">${esc(rv.contract_name)}</span>
      ${detName ? `<span class="detbadge">detected: ${esc(detName)} · ${Math.round((detTop.confidence || 0) * 100)}%</span>` : `<span class="chip">no confident match</span>`}</div>
    <div class="rlbl">Review against · ${sel} of 3 selected</div>
    <div style="display:flex;flex-direction:column;gap:8px">${chips}</div>
    ${sel > 1 ? `<div class="dedupnote"><b style="color:var(--txt)">Dedup:</b> overlapping sections & rules across the ${sel} archetypes are merged — reviewed once, tagged by source.</div>` : ""}
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn--org" onclick="runReview(${i})" ${sel ? "" : "disabled"}>Review ▸</button>
      <span class="createlink" onclick="createFromFile(${i})">No archetype fits? Create one from this file →</span>
    </div></div>`;
}
window.cDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); const fs = e.dataTransfer?.files; if (fs && fs.length) cUpload(fs); };
window.cUpload = async (files) => {
  if (!files || !files.length) return;
  CFILES = [...files];
  const fd = new FormData(); CFILES.forEach((f) => fd.append("files", f));
  const req = (async () => { const r = await fetch("/api/contra/batch", { method: "POST", body: fd }); return { ok: r.ok, j: await r.json() }; })();
  try {
    const { ok, j } = await runWithMeter("cproc", ["Reading the contract(s) · Munshi3", "Fingerprinting each contract", "Detecting & ranking archetypes"], req);
    const p = $("#cproc"); if (p) p.innerHTML = "";
    if (!ok) return rdAlert("Couldn't read that", j.error || "");
    BATCH = j; renderReview();
  } catch (e) { const p = $("#cproc"); if (p) p.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
};
window.toggleArch = (i, id) => {
  const rv = BATCH.reviews[i]; rv.selected = rv.selected || [];
  const k = rv.selected.indexOf(id);
  if (k >= 0) rv.selected.splice(k, 1);
  else { if (rv.selected.length >= 3) return rdAlert("Max 3", "Review against up to 3 archetypes at once."); rv.selected.push(id); }
  renderReview();
};
window.runReview = async (i) => {
  const rv = BATCH.reviews[i]; if (!rv.selected?.length) return;
  const req = (async () => { const r = await fetch(`/api/contra/review/${rv.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archetype_ids: rv.selected }) }); return { ok: r.ok, j: await r.json() }; })();
  try {
    const { ok, j } = await runWithMeter("cproc", ["Reading against the archetype", "Verdict on each section", "Checking your rules", "Whole-contract findings", "Proposing redlines", "Composing the report"], req);
    const p = $("#cproc"); if (p) p.innerHTML = "";
    if (!ok) return rdAlert("Review failed", j.error || "");
    rv.status = "done"; rv.issue_count = j.review.issue_count;
    REVIEWS_LOADED = false;   // refresh the Reviewed history
    renderReview(); openReviewed(rv.id);
  } catch (e) { const p = $("#cproc"); if (p) p.innerHTML = ""; rdAlert("Review failed", String(e.message || e)); }
};
window.createFromFile = (i) => { const f = CFILES[i]; if (!f) return rdAlert("No file", "Re-drop the contract."); setArea("archetypes"); setSub("maker"); uploadSample(f); };

// ---- Contracts · Reviewed (report · timeline) ------------------------------
function renderReviewed() {
  const host = $("#view-reviewed");
  if (RVOPEN) {
    const rv = RVOPEN.review;
    const isDocx = rv.original_ext === ".docx" && (rv.report?.redlines || []).length;
    const tabs = `<div class="rvtabs">
        <span class="rvtab ${RVTAB === "report" ? "on" : ""}" onclick="setRvTab('report')">Legal report</span>
        <span class="rvtab ${RVTAB === "timeline" ? "on" : ""}" onclick="setRvTab('timeline')">Timeline</span>
        <span class="rvtab" onclick="downloadDocx(${rv.id})" title="${isDocx ? "your original .docx with tracked-change redlines" : "review report — upload a .docx contract to get the marked-up original"}">⤓ ${isDocx ? "Marked-up .docx" : "Report (.docx)"}</span>
        <span class="backlnk" style="margin-left:auto;margin-bottom:0" onclick="closeReviewed()">‹ all reviews</span></div>`;
    host.innerHTML = contractHeader(rv) + tabs + (RVTAB === "report" ? reportView(rv) : timelineView(RVOPEN.changes || []));
    return;
  }
  // history table
  if (!REVIEWS_LOADED) {
    host.innerHTML = `<p class="intro"><b>REVIEWED</b> — every contract you've reviewed.</p><div class="empty">loading…</div>`;
    fetch("/api/contra/reviews").then((r) => r.json()).then((j) => { REVIEWS = j.reviews || []; REVIEWS_LOADED = true; if (!RVOPEN) renderReviewed(); });
    return;
  }
  const rows = REVIEWS.map((r) => `<tr class="clk" data-k="${esc((r.contract_name + " " + (r.contract_type || "") + " " + (r.party1 || "") + " " + (r.party2 || "") + " " + (r.archetype || "")).toLowerCase())}" onclick="openReviewed(${r.id})">
      <td><b>${esc(r.contract_name || "")}</b></td>
      <td>${r.contract_type ? `<span class="typebadge">${esc(r.contract_type)}</span>` : "<span style='color:var(--dim2)'>—</span>"}</td>
      <td>${esc([r.party1, r.party2].filter(Boolean).join(" ⟷ ")) || "<span style='color:var(--dim2)'>—</span>"}</td>
      <td>${esc(r.archetype || "—")}</td>
      <td>${r.issue_count ? `<span style="color:var(--red);font-weight:600">${r.issue_count}</span>` : `<span style="color:var(--grn)">clean</span>`}</td>
      <td>${fmtDT(r.created_at)}</td>
    </tr>`).join("");
  host.innerHTML = `<p class="intro"><b>REVIEWED</b> — every contract you've reviewed. The 10 most recent show here; type to search all. Click a row for its report, redlines and timeline.</p>`
    + (REVIEWS.length
      ? `<div class="cfilter"><input placeholder="filter by contract, type, party, archetype…" oninput="filterTable('revtable',this.value)"><span class="am" id="revtable-note"></span></div>
         <table class="ctable" id="revtable"><thead><tr><th>Contract</th><th>Type</th><th>Parties</th><th>Archetype</th><th>Issues</th><th>Reviewed</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">// no reviews yet — run one in the Review tab //</div>`);
  if (REVIEWS.length) filterTable("revtable", "");
}
// nice document header shown above the Reviewed tabs
function contractHeader(r) {
  const rep = r.report || {}, meta = rep.meta || {};
  const title = meta.title || r.contract_name || "Contract";
  const pa = r.party1 || rep.parties?.a, pb = r.party2 || rep.parties?.b;
  const fact = (k, v) => v ? `<span class="cfact"><span class="cfk">${k}</span>${esc(v)}</span>` : "";
  return `<div class="chead">
    <div class="chead-emb">Q</div>
    <div class="chead-body">
      <div class="chead-titlerow"><span class="chead-title">${esc(title)}</span>${meta.type ? `<span class="typebadge">${esc(meta.type)}</span>` : ""}</div>
      ${(pa || pb) ? `<div class="chead-parties">${esc(pa || "?")}<span class="vs">⟷</span>${esc(pb || "?")}</div>` : ""}
      <div class="chead-facts">
        ${fact("Effective", meta.effective_date)}${fact("Expiry", meta.expiry_date)}
        ${fact("Archetype", (rep.archetypes || []).join(" + "))}
        ${fact("Reviewed", fmtD(rep.generated_at || Date.now()))}
        ${fact("File", r.contract_name)}
      </div>
    </div>
    <span class="chead-issues ${r.issue_count ? "bad" : "ok"}">${r.issue_count ? `${r.issue_count} issue${r.issue_count === 1 ? "" : "s"}` : "clean"}</span>
  </div>`;
}
window.setRvTab = (t) => { RVTAB = t; renderReviewed(); };
window.closeReviewed = () => { RVOPEN = null; setSub("reviewed"); };
window.openReviewed = async (id) => {
  RVOPEN = await (await fetch(`/api/contra/review/${id}`)).json();
  RVTAB = "report"; AREA = "contracts"; SUB.contracts = "reviewed"; renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $("#view-reviewed").hidden = false;
  renderReviewed(); window.scrollTo({ top: 0, behavior: "smooth" });
  ensureClauseLabels(); // fill in clause topic-labels (once, cached), then re-render
};
const VCLASS = { present: "v-present", non_standard: "v-non_standard", risky: "v-risky", missing: "v-missing" };
function refs(arr) { return (arr || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" "); }
// Clause chips — each § with a short AI topic label (Indemnity, Payment terms…) so
// the legal team sees at a glance what each clause is about. Static (no jump).
// Prefix "§" unless the ref already names a section/clause/article/schedule.
const fmtClause = (x) => { const s = String(x || "").trim(); return /^(§|sec(tion)?\b|cl(ause)?\.?\b|art(icle)?\.?\b|schedule|annex|appendix|exhibit|para)/i.test(s) ? s : "§ " + s; };
function clauseChips(arr) {
  const a = (arr || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!a.length) return "";
  const L = (RVOPEN && RVOPEN.review && RVOPEN.review.report && RVOPEN.review.report.clause_labels) || {};
  return `<span class="clauses">${a.map((x) => { const lab = L[x] || L[fmtClause(x)] || ""; return `<span class="clausechip">${esc(fmtClause(x))}${lab ? `<span class="cl-lab">${esc(lab)}</span>` : ""}</span>`; }).join("")}</span>`;
}
// lazily generate the clause topic-labels once per review, then re-render the report
async function ensureClauseLabels() {
  const r = RVOPEN && RVOPEN.review; if (!r) return;
  const rep = r.report || {};
  if (rep.clause_labels && Object.keys(rep.clause_labels).length) return;
  const hasRefs = [...(rep.rule_checks || []), ...(rep.findings || [])].some((x) => (x.refs || []).length);
  if (!hasRefs) return;
  try {
    const j = await (await fetch(`/api/contra/review/${r.id}/clause-labels`, { method: "POST" })).json();
    if (j && j.labels) { r.report.clause_labels = j.labels; if (RVTAB === "report" && RVOPEN && RVOPEN.review && RVOPEN.review.id === r.id) renderReviewed(); }
  } catch { /* labels are best-effort */ }
}
const VCOLOR = { present: "#2E7D4F", non_standard: "#8a6d1f", risky: "#C77B2B", missing: "#C0392B" };
const VLABEL = { present: "Present", non_standard: "Non-std", risky: "Risky", missing: "Missing" };
function reportView(r) {
  const rep = r.report || {};
  const verdicts = rep.verdicts || [], checks = rep.rule_checks || [], findings = rep.findings || [];
  const parties = [r.party1 || rep.parties?.a, r.party2 || rep.parties?.b].filter(Boolean).join(" ⟷ ");
  const breaches = checks.filter((c) => c.result === "breach").length;
  const flagged = verdicts.filter((v) => ["risky", "missing", "non_standard"].includes(v.verdict)).length;
  const glance = `<div class="glance">
      <div class="g"><div class="gv" style="color:${r.issue_count ? "#C0392B" : "#2E7D4F"}">${r.issue_count || 0}</div><div class="gl">issues</div></div>
      <div class="g"><div class="gv">${breaches}</div><div class="gl">rule breaches</div></div>
      <div class="g"><div class="gv">${findings.length}</div><div class="gl">findings</div></div>
      <div class="g"><div class="gv">${flagged}<span style="font-size:14px;color:var(--line2)">/${verdicts.length || "—"}</span></div><div class="gl">sections flagged</div></div></div>`;
  const summary = rep.summary ? `<p class="rsummary">${esc(rep.summary)}</p>` : "";
  const rc = checks.length ? `<div class="rsec-lbl">Rule checks</div><div style="margin-bottom:22px">${checks.map((c) => `<div class="rcrow"><span class="rcp ${c.result || "check"}">${String(c.result || "check").toUpperCase()}</span><span style="flex:1">${esc(c.rule || c.section_key || "")} — ${esc(c.note || c.found || "")}</span>${clauseChips(c.refs)}</div>`).join("")}</div>` : "";
  const fnd = findings.length ? `<div class="rsec-lbl">Whole-contract findings</div><div style="margin-bottom:22px">${findings.map((f) => `<div class="frow ${f.severity === "high" ? "hi" : f.severity === "med" ? "med" : ""}"><b>${esc(String(f.kind || "finding").replace(/_/g, " "))}</b> · ${esc(f.note || "")}${clauseChips(f.refs)}</div>`).join("")}</div>` : "";
  const secs = verdicts.length ? `<div class="rsec-lbl">Section review <span style="color:var(--dim2);font-weight:400">· click to ask</span></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${verdicts.map((v) => `<div class="schip" onclick="askBox('${esc(v.key)}')"><span style="flex:1">${esc(String(v.key || "").replace(/_/g, " "))}</span><span class="sdot" style="background:${VCOLOR[v.verdict] || "#B4B2A9"}"></span><span style="font-size:11px;font-weight:600;color:${VCOLOR[v.verdict] || "#7A7266"}">${VLABEL[v.verdict] || v.verdict || ""}</span></div>`).join("")}</div>` : "";
  const doc = `<div class="report-doc">${glance}
    <div style="padding:20px 26px 24px">${summary}${rc}${fnd}${secs}
      <div style="margin-top:20px;padding-top:12px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:#A79F93;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><span>Prepared by Contra · ${esc(r.contract_name || "")}</span><span>an AI product by The Kettle Black</span></div></div></div>`;
  const ask = `<div class="askbox" style="margin-top:16px">
      <div class="askbox-h">✦ Ask Contract <span class="askbox-s">grounded in the clauses · cites the §§ · saved to the timeline</span></div>
      ${ASK_LAST ? `<div class="askbox-a"><div class="askbox-q">${esc(ASK_LAST.q)}${ASK_LAST.box_key ? ` · ${esc(ASK_LAST.box_key)}` : ""}</div><div class="askbox-ans">${esc(ASK_LAST.a)}</div></div>` : ""}
      <div class="askbox-in"><input id="askin" placeholder="ask anything about this contract…" onkeydown="askKey(event)"><button class="btn btn--org small" onclick="doAsk()">Ask ▸</button></div></div>`;
  return doc + ask;
}
window.askKey = (e) => { if (e.key === "Enter") { e.preventDefault(); doAsk(); } };
window.askBox = (key) => { ASK_BOXKEY = key; const el = document.getElementById("askin"); if (el) { el.focus(); el.placeholder = `ask about the "${key}" section…`; } };
window.doAsk = async () => {
  const el = document.getElementById("askin"); const qtext = (el?.value || "").trim(); if (!qtext) return;
  const id = RVOPEN.review.id; el.disabled = true; el.value = "asking…";
  try {
    const r = await fetch(`/api/contra/review/${id}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: qtext, box_key: ASK_BOXKEY }) });
    const j = await r.json();
    if (!r.ok) { el.disabled = false; el.value = qtext; return rdAlert("Ask failed", j.error || ""); }
    ASK_LAST = { q: qtext, a: j.answer, box_key: ASK_BOXKEY }; ASK_BOXKEY = null;
    RVOPEN = await (await fetch(`/api/contra/review/${id}`)).json();
    renderReviewed(); setTimeout(() => document.getElementById("askin")?.focus(), 60);
  } catch (e) { el.disabled = false; el.value = qtext; rdAlert("Ask failed", String(e.message || e)); }
};
window.actBox = async (id, kind, key) => {
  await fetch(`/api/contra/review/${id}/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, box_key: key }) });
  RVOPEN = await (await fetch(`/api/contra/review/${id}`)).json(); renderReviewed();
};
window.commentBox = (id, key) => rdForm(`Comment · ${key}`, [{ k: "body", label: "Your comment", ph: "e.g. check with legal on this" }], async (o) => {
  if (!o.body) return;
  await fetch(`/api/contra/review/${id}/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "comment", box_key: key, body: o.body }) });
  RVOPEN = await (await fetch(`/api/contra/review/${id}`)).json(); renderReviewed();
});
window.downloadDocx = (id) => window.open(`/api/contra/review/${id}/docx`, "_blank");
function timelineView(changes) {
  if (!changes.length) return `<div class="empty">// no timeline yet //</div>`;
  const ai = changes.filter((c) => c.actor_type === "ai").length;
  const human = changes.filter((c) => c.actor_type === "human").length;
  const qa = changes.filter((c) => c.kind === "qa").length;
  const summary = `<div class="tl-summary">${changes.length} events · ${ai} by AI · ${human} by you${qa ? ` · ${qa} Q&A` : ""} — remembered on this contract</div>`;
  return summary + `<div class="tl">${changes.map((c) => {
    const ai = c.actor_type === "ai";
    return `<div class="tl-item tl-${ai ? "ai" : "human"}"><span class="tl-dot"></span>
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><span class="tl-badge" style="color:${ai ? "#6b3fa0" : "#005465"};background:${ai ? "#F1EBFA" : "#E6EEF0"};border:1px solid ${ai ? "#DDCCF3" : "#cde"}">${ai ? "✦ AI" : "👤 Human"} · ${esc(c.actor_id || "")}</span><span style="font-size:13px;font-weight:600">${esc(String(c.kind || "").replace(/_/g, " "))}</span></div>
      <div style="font-size:12.5px;color:var(--dim);margin-top:4px;line-height:1.5">${esc(c.body || "")}${c.reasoning ? ` — ${esc(c.reasoning)}` : ""}</div>${clauseChips(c.refs)}
      <div class="tl-stamp">${fmtDT(c.created_at)}</div></div>`;
  }).join("")}</div>`;
}

// ---- modals ----------------------------------------------------------------
function _ov(inner) { const ov = document.createElement("div"); ov.className = "ov"; ov.innerHTML = `<div class="box">${inner}</div>`; document.body.appendChild(ov); const close = () => ov.remove(); ov.onclick = (e) => { if (e.target === ov) close(); }; return { ov, close }; }
function rdAlert(title, msg) { const { ov, close } = _ov(`<h3>${esc(title)}</h3>${msg ? `<p>${esc(msg)}</p>` : ""}<div class="row"><button class="btn btn--primary" data-ok>OK</button></div>`); ov.querySelector("[data-ok]").onclick = close; }
function rdConfirm(title, msg, onOk) { const { ov, close } = _ov(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--org" data-ok>Confirm</button></div>`); ov.querySelector("[data-x]").onclick = close; ov.querySelector("[data-ok]").onclick = () => { close(); onOk && onOk(); }; }
function rdForm(title, fields, onOk) {
  const body = fields.map((f) => `<label style="font-size:12.5px;color:var(--dim)">${esc(f.label)}</label><input data-k="${f.k}" placeholder="${esc(f.ph || "")}" value="${esc(f.v || "")}">`).join("");
  const { ov, close } = _ov(`<h3>${esc(title)}</h3>${body}<div class="row"><button class="btn" data-x>Cancel</button><button class="btn btn--primary" data-ok>Save</button></div>`);
  ov.querySelector("input")?.focus();
  ov.querySelector("[data-x]").onclick = close;
  ov.querySelector("[data-ok]").onclick = () => { const o = {}; ov.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); close(); onOk(o); };
}

init();
