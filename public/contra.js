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
const VIEWS = { maker: "#view-maker", library: "#view-library", review: "#view-review", reviewed: "#view-reviewed" };

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
  return `<div class="sec-head"><h3>Review outline</h3>
      <span class="chip">${ARCH.sections.length} sections · <b style="color:var(--org)">${req} required</b></span>
      <button class="btn small" onclick="addSection()" style="margin-left:auto">+ Add section</button></div>
    <div class="grid">${secs}</div>
    <div class="grules"><div class="rules-lbl">✦ archetype-wide rules · applied to the whole contract</div>
      <div class="rchips">${grules || '<span class="rnone">none — add whole-contract rules like “governing law must be Bangalore”</span>'}</div>
      <input class="rinput" id="grinput" placeholder="add a whole-contract rule, then press Enter…" onkeydown="grKey(event)"></div>
    <div class="savebar">
      <span style="font-weight:600">Archetype</span>
      <input id="archname" value="${esc(ARCH.name)}" oninput="onName(this.value)" placeholder="e.g. MSA — India GCC">
      <span class="stampnote">${saved ? "saved · edits autosave" : "timestamp auto-suffixed on save"}</span>
      <button class="btn btn--primary" style="margin-left:auto" onclick="saveArchetype()">${saved ? "Save changes ▸" : "Save archetype ▸"}</button>
      <button class="btn" onclick="${saved ? "closeEditor()" : "discardDraft()"}">${saved ? "Close" : "Discard"}</button>
    </div>`;
}

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
  try { await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, review_outline: ARCH.sections, global_rules: ARCH.global_rules || [], save: false }) }); } catch { /* keep local */ }
}
window.saveArchetype = async () => {
  if (!ARCH?.id) return;
  if (!ARCH.name?.trim()) return rdAlert("Name it first", "Give the archetype a name so Review can detect against it.");
  if (!ARCH.sections.some((s) => s.required)) return rdAlert("Mark at least one required", "Tag the sections that matter as Required.");
  ARCH.sections.forEach((s, i) => (s.order = i));
  const r = await fetch(`/api/contra/archetype/${ARCH.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ARCH.name, review_outline: ARCH.sections, global_rules: ARCH.global_rules || [], save: true }) });
  const j = await r.json();
  if (!r.ok) return rdAlert("Save failed", j.error || "");
  ARCH = null; EDIT_IN = null; await loadArches(); renderNav(); renderView(SUB[AREA]);
  rdAlert("Archetype saved", `“${esc(j.archetype.slug || j.archetype.name)}” is in your library and ready for Review.`);
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
      <span class="an">${esc(a.name)}</span>
      <span class="chip ${a.status}">${a.status}</span>
      <span class="am">${a.sections} sections</span>
      <span class="am">${a.source_doc ? esc(a.source_doc) : ""}</span>
      <button class="btn small" onclick="editArch(${a.id})">Open &amp; add rules</button>
      <button class="btn small" onclick="delArch(${a.id},'${esc(a.name).replace(/'/g, "\\'")}')">✕</button>
    </div>`).join("");
  host.innerHTML = `<p class="intro"><b>ARCHETYPE LIBRARY</b> — your saved contract types. Open one to add <b>review rules</b> in plain English (type a rule, press <b>Enter</b> → it becomes a chip). Rules save into the archetype and apply on every review.</p>`
    + (ARCHES.length ? rows : `<div class="empty">// no archetypes yet — make one in the Archetype Maker //</div>`);
}
window.editArch = async (id) => {
  const a = (await (await fetch(`/api/contra/archetype/${id}`)).json()).archetype;
  ARCH = { id: a.id, name: a.name, status: a.status, sections: a.review_outline || [], global_rules: a.global_rules || [] };
  EDIT_IN = "library"; renderLibrary(); window.scrollTo({ top: 0, behavior: "smooth" });
};
window.delArch = (id, name) => rdConfirm("Delete archetype?", `“${name}” will be removed.`, async () => { await fetch(`/api/contra/archetype/${id}`, { method: "DELETE" }); if (ARCH?.id === id) { ARCH = null; EDIT_IN = null; } await loadArches(); renderNav(); renderView(SUB[AREA]); });

// ---- Contracts (Phase 2 placeholders) --------------------------------------
function renderReview() {
  const saved = ARCHES.filter((a) => a.status === "saved");
  $("#view-review").innerHTML = `<p class="intro"><b>REVIEW</b> — drop one or many contracts; each auto-detects its archetype, then Contra runs a holistic review (section boxes + whole-contract findings) against your rules. Coming next.</p>`
    + (saved.length
      ? `<div class="drop" style="cursor:default"><span class="ic">⇊</span><div><div class="t">Coming next — Phase 2</div><div class="s">${saved.length} archetype${saved.length === 1 ? "" : "s"} ready to detect against: ${saved.map((a) => esc(a.name)).join(" · ")}</div></div></div>`
      : `<div class="empty">// save an archetype in the Archetype Maker first //</div>`);
}
function renderReviewed() {
  $("#view-reviewed").innerHTML = `<p class="intro"><b>REVIEWED</b> — the legal report, the marked-up document, and the change timeline for every reviewed contract. Coming next.</p><div class="empty">// nothing reviewed yet //</div>`;
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
