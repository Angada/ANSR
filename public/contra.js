// Contra — contract review. Areas: Archetypes (Maker · Library) · Contracts
// (Review · Reviewed). Phase 1+ : Archetype Maker (multi-step propose) and the
// Archetype Library with plain-English review rules (type → Enter → chip).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

let AREA = "archetypes";
let SUB = { archetypes: "maker", contracts: "review" };
let ARCH = null;          // the archetype currently open in the editor
let EDIT_IN = null;       // "maker" | "library" — where the editor is shown
let ARCHES = [];          // library list
let BATCH = null;         // current review batch { batch, reviews:[...] }
let CFILES = [];          // dropped File objects, index-aligned with BATCH.reviews
let RVOPEN = null;        // opened reviewed contract { review, changes }
let RVTAB = "report";     // report | timeline
let ASK_LAST = null, ASK_BOXKEY = null;   // Ask Contract: last Q&A + focused box
const VIEWS = { maker: "#view-maker", library: "#view-library", review: "#view-review", reviewed: "#view-reviewed" };
function meterHtml(msg) { return `<div class="meter"><div class="now"><img class="potspin" src="/brand/assets/logos/pot.png" alt="">${esc(msg)}</div><div class="track"><div class="fill indet"></div></div></div>`; }

function renderNav() {
  const saved = ARCHES.filter((a) => a.status === "saved").length;
  $("#mainnav").innerHTML = [["archetypes", "Archetypes"], ["contracts", "Contracts"]]
    .map(([k, l]) => `<button class="${AREA === k ? "on" : ""}" onclick="setArea('${k}')">${l}</button>`).join("");
  const subs = AREA === "archetypes"
    ? [["maker", "Archetype Maker", ARCHES.length], ["library", "Archetype Library", ARCHES.length]]
    : [["review", "Review", saved], ["reviewed", "Reviewed", 0]];
  $("#subnav").innerHTML = subs.map(([k, l, n]) => `<button class="${SUB[AREA] === k ? "on" : ""}" onclick="setSub('${k}')">${l}${n ? `<span class="count">${n}</span>` : ""}</button>`).join("");
}
window.setArea = (a) => { AREA = a; setSub(SUB[a]); };
window.setSub = (s) => { SUB[AREA] = s; renderNav(); Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $(VIEWS[s]).hidden = false; renderView(s); };
function renderView(s) { ({ maker: renderMaker, library: renderLibrary, review: renderReview, reviewed: renderReviewed }[s])(); }
function rerenderEditor(focusI) { (EDIT_IN === "library" ? renderLibrary : renderMaker)(); if (focusI != null) { const el = document.querySelectorAll(".rinput")[focusI]; el && el.focus(); } }

async function init() {
  await loadArches();
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
      <select id="verpick" onchange="loadVersion(this.value)">${vers.map((v) => `<option value="${v.version}" ${v.version === (ARCH._viewing || ARCH.version) ? "selected" : ""}>v${v.version}${v.version === ARCH.version ? " · current" : ""} · ${new Date(v.created_at).toLocaleDateString()}</option>`).join("")}</select>` : "";
  const meta = `<div class="arch-meta">
      <div class="arch-meta-row"><label class="metalbl">Name</label><input id="archname" value="${esc(ARCH.name)}" oninput="onName(this.value)" placeholder="e.g. MSA — India GCC"></div>
      <div class="arch-meta-row"><label class="metalbl">Description</label><textarea id="archdesc" rows="2" oninput="onDesc(this.value)" placeholder="What this contract type is for — with examples (e.g. master services for GCC build-and-operate; Acme, Northwind).">${esc(ARCH.description || "")}</textarea></div>
      <div class="arch-meta-row2">
        <span class="metastamp">${saved ? `${vers.length ? `Version <b>v${ARCH.version}</b> · ` : ""}created ${ARCH.created_at ? new Date(ARCH.created_at).toLocaleDateString() : "—"}` : "draft · not yet saved"}</span>
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
  const proc = $("#proc");
  proc.innerHTML = `<div class="meter"><div class="now"><img class="potspin" src="/brand/assets/logos/pot.png" alt="">Reading the contract · proposing sections · suggesting rules — up to a minute…</div><div class="track"><div class="fill indet"></div></div></div>`;
  const fd = new FormData(); fd.append("file", file);
  try {
    const r = await fetch("/api/contra/archetype/propose", { method: "POST", body: fd });
    const j = await r.json();
    proc.innerHTML = "";
    if (!r.ok) return rdAlert("Couldn't read that", j.error || "Try a different file.");
    ARCH = { id: j.id, name: j.name, status: "draft", sections: j.sections || [], global_rules: [] };
    EDIT_IN = "maker";
    await loadArches(); renderNav(); renderMaker();
    if (j.mode !== "ai") rdAlert("Starter outline (no LLM key)", "Contra returned a generic starter. Point the Contra pipelines at a keyed model in AI Skills & Pipelines for a real read.");
  } catch (e) { proc.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
};

// ---- Archetype Library (open → add rules → save) ---------------------------
function renderLibrary() {
  const host = $("#view-library");
  if (ARCH && EDIT_IN === "library") {
    host.innerHTML = `<span class="backlnk" onclick="closeEditor()">‹ back to library</span>` + sectionEditor();
    return;
  }
  const rows = ARCHES.map((a) => `<div class="arch-row">
      <div style="flex:1;min-width:180px">
        <div class="an">${esc(a.name)}${a.status === "saved" ? `<span class="vtag">v${a.version || 1}</span>` : ""}</div>
        ${a.description ? `<div class="adesc">${esc(a.description)}</div>` : ""}
      </div>
      <span class="chip ${a.status}">${a.status}</span>
      <span class="am">${a.sections} sections</span>
      <span class="am">${a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
      <button class="btn small" onclick="editArch(${a.id})">Open &amp; add rules</button>
      <button class="btn small" onclick="delArch(${a.id},'${esc(a.name).replace(/'/g, "\\'")}')">✕</button>
    </div>`).join("");
  host.innerHTML = `<p class="intro"><b>ARCHETYPE LIBRARY</b> — your saved contract types. Open one to add <b>review rules</b> in plain English (type a rule, press <b>Enter</b> → it becomes a chip). Rules save into the archetype and apply on every review.</p>`
    + (ARCHES.length ? rows : `<div class="empty">// no archetypes yet — make one in the Archetype Maker //</div>`);
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
    return `<div class="crow"><div class="crow-h"><span class="cn">${esc(rv.contract_name)}</span>
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
  const proc = $("#cproc"); proc.innerHTML = meterHtml("Reading & detecting archetypes…");
  CFILES = [...files];
  const fd = new FormData(); CFILES.forEach((f) => fd.append("files", f));
  try {
    const r = await fetch("/api/contra/batch", { method: "POST", body: fd });
    const j = await r.json(); proc.innerHTML = "";
    if (!r.ok) return rdAlert("Couldn't read that", j.error || "");
    BATCH = j; renderReview();
  } catch (e) { proc.innerHTML = ""; rdAlert("Upload failed", String(e.message || e)); }
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
  const proc = $("#cproc"); proc.innerHTML = meterHtml(`Reviewing ${esc(rv.contract_name)} — sections · rules · findings…`);
  try {
    const r = await fetch(`/api/contra/review/${rv.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archetype_ids: rv.selected }) });
    const j = await r.json(); proc.innerHTML = "";
    if (!r.ok) return rdAlert("Review failed", j.error || "");
    rv.status = "done"; rv.issue_count = j.review.issue_count;
    renderReview(); openReviewed(rv.id);
  } catch (e) { proc.innerHTML = ""; rdAlert("Review failed", String(e.message || e)); }
};
window.createFromFile = (i) => { const f = CFILES[i]; if (!f) return rdAlert("No file", "Re-drop the contract."); setArea("archetypes"); setSub("maker"); uploadSample(f); };

// ---- Contracts · Reviewed (report · timeline) ------------------------------
function renderReviewed() {
  const host = $("#view-reviewed");
  if (!RVOPEN) {
    host.innerHTML = `<p class="intro"><b>REVIEWED</b> — open a reviewed contract from the Review tab to see its legal report, findings and change timeline.</p><div class="empty">// run a review first //</div>`;
    return;
  }
  const tabs = `<div class="rvtabs">
      <span class="rvtab ${RVTAB === "report" ? "on" : ""}" onclick="setRvTab('report')">Legal report</span>
      <span class="rvtab ${RVTAB === "timeline" ? "on" : ""}" onclick="setRvTab('timeline')">Timeline</span>
      <span class="rvtab" onclick="downloadDocx(${RVOPEN.review.id})">⤓ Word (.docx)</span>
      <span class="backlnk" style="margin-left:auto;margin-bottom:0" onclick="closeReviewed()">‹ back to review</span></div>`;
  host.innerHTML = tabs + (RVTAB === "report" ? reportView(RVOPEN.review) : timelineView(RVOPEN.changes || []));
}
window.setRvTab = (t) => { RVTAB = t; renderReviewed(); };
window.closeReviewed = () => { RVOPEN = null; setSub("review"); };
window.openReviewed = async (id) => {
  RVOPEN = await (await fetch(`/api/contra/review/${id}`)).json();
  RVTAB = "report"; AREA = "contracts"; SUB.contracts = "reviewed"; renderNav();
  Object.values(VIEWS).forEach((v) => ($(v).hidden = true)); $("#view-reviewed").hidden = false;
  renderReviewed(); window.scrollTo({ top: 0, behavior: "smooth" });
};
const VCLASS = { present: "v-present", non_standard: "v-non_standard", risky: "v-risky", missing: "v-missing" };
function refs(arr) { return (arr || []).map((x) => `<span class="ref">${esc(x)}</span>`).join(" "); }
function reportView(r) {
  const rep = r.report || {};
  const verdicts = rep.verdicts || [], checks = rep.rule_checks || [], findings = rep.findings || [];
  const rc = checks.length ? `<div class="rlbl">Your rule checks</div>${checks.map((c) => `<div class="rcheck rc-${c.result || "check"}"><span class="rcbadge" style="color:${c.result === "breach" ? "#C0392B" : c.result === "pass" ? "#2E7D4F" : "#8a6d1f"}">${String(c.result || "check").toUpperCase()}</span><span>${esc(c.rule || c.section_key || "")} — ${esc(c.note || c.found || "")} ${refs(c.refs)}</span></div>`).join("")}` : "";
  const fnd = findings.length ? `<div class="fband"><div style="font-weight:700;font-size:13.5px;color:#8a5410;margin-bottom:9px">⚠ Whole-contract findings</div>${findings.map((f) => `<div class="fitem"><b style="color:#141414">${esc(String(f.kind || "finding").replace(/_/g, " "))}</b> — ${esc(f.note || "")} ${refs(f.refs)}</div>`).join("")}</div>` : "";
  const boxes = verdicts.length ? `<div class="rlbl" style="margin-top:14px">Section review</div><div class="grid">${verdicts.map((v) => `<div class="rbox"><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600;font-size:14px">${esc(String(v.key || "").replace(/_/g, " "))}</span><span class="vchip ${VCLASS[v.verdict] || "v-non_standard"}" style="margin-left:auto">${String(v.verdict || "").replace(/_/g, " ").toUpperCase()}</span></div><div class="q">${esc(v.note || "—")} ${refs(v.evidence_refs)}</div>
      <div class="rbox-acts"><button class="lnk" onclick="actBox(${r.id},'accept','${esc(v.key)}')">✓ Accept</button><button class="lnk" onclick="askBox('${esc(v.key)}')">✦ Ask</button><button class="lnk" onclick="commentBox(${r.id},'${esc(v.key)}')">💬 Comment</button></div></div>`).join("")}</div>` : "";
  const summary = rep.summary ? `<div class="rlbl">Summary</div><p style="margin:0 0 16px;font-size:13.5px;color:var(--dim);line-height:1.6">${esc(rep.summary)}</p>` : "";
  const ask = `<div class="askbox">
      <div class="askbox-h">✦ Ask Contract <span class="askbox-s">grounded in the clauses · cites the §§ · saved to the timeline</span></div>
      ${ASK_LAST ? `<div class="askbox-a"><div class="askbox-q">${esc(ASK_LAST.q)}${ASK_LAST.box_key ? ` · ${esc(ASK_LAST.box_key)}` : ""}</div><div class="askbox-ans">${esc(ASK_LAST.a)}</div></div>` : ""}
      <div class="askbox-in"><input id="askin" placeholder="ask anything about this contract…" onkeydown="askKey(event)"><button class="btn btn--org small" onclick="doAsk()">Ask ▸</button></div></div>`;
  return `<div class="report-doc"><div class="rd-head"><div class="rd-emb">Q</div>
      <div style="flex:1"><div class="rd-title">Contract Review</div>
        <div class="rd-ref">Ref: ${esc(r.contract_name)} · ${esc((rep.archetypes || []).join(" + "))} · ${new Date(rep.generated_at || Date.now()).toLocaleDateString()} · contra-review</div></div>
      ${r.issue_count ? `<span class="chip" style="color:var(--red);background:#FBECEB;border-color:#F0CFCF">${r.issue_count} issues</span>` : `<span class="chip saved">clean</span>`}</div>
    <div style="padding:16px 24px 22px">${ask}${summary}${rc}${fnd}${boxes}
      <div style="margin-top:18px;padding-top:12px;border-top:1px solid var(--line);font-family:var(--mono);font-size:10px;color:#A79F93;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><span>Prepared by Contra</span><span>an AI product by The Kettle Black</span></div>
    </div></div>`;
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
      <div style="font-size:12.5px;color:var(--dim);margin-top:4px;line-height:1.5">${esc(c.body || "")}${c.reasoning ? ` — ${esc(c.reasoning)}` : ""} ${refs(c.refs)}</div>
      <div class="tl-stamp">${c.created_at ? new Date(c.created_at).toLocaleString() : ""}</div></div>`;
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
